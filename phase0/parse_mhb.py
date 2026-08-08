#!/usr/bin/env python3
"""Phase 0 最小驗證：解析健康存摺醫療類 JSON，正規化後寫入 SQLite。

用法：python3 parse_mhb.py <健康存摺醫療類_YYYMMDD.JSON> [output_dir]

輸出：
  output/mhb.sqlite       正規化資料庫（encounters/medications/lab_results/...）
  output/quality_report.json  資料品質報告
每筆正規化資料都保留 source_section 與 source_index，可追溯到原始 JSON 位置。
"""
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

import fieldmap as fm

ENCOUNTER_SECTIONS = {
    "r1": ("western_outpatient", "r1.5", "r1.4", "r1.3", "r1.8", "r1.9", "r1.12", "r1.13", fm.R1),
    "r3": ("dental", "r3.5", "r3.4", "r3.3", "r3.7", "r3.8", "r3.11", "r3.12", fm.R3),
    "r9": ("tcm", "r9.5", "r9.4", "r9.3", "r9.7", "r9.8", "r9.11", "r9.12", fm.R9),
}

NO_DATA = "無資料"


def norm_date(s):
    """YYYYMMDD → YYYY-MM-DD；YYYYMM → YYYY-MM；無法解析回傳 None。"""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    if re.fullmatch(r"\d{6}", s):
        return f"{s[:4]}-{s[4:6]}"
    return None


def to_num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return s
    s = str(s).strip()
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


def is_no_data(section_list, code):
    return (
        len(section_list) == 1
        and list(section_list[0].keys()) == [code]
        and section_list[0][code] == NO_DATA
    )


def main():
    src_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).parent / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    raw = src_path.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()
    data = json.loads(raw.decode("utf-8-sig"))
    bdata = data["myhealthbank"]["bdata"]
    # 節區代碼大小寫不一致（r1..r11 小寫、R12..R14 大寫），統一小寫
    bdata = {k.lower(): v for k, v in bdata.items()}

    db_path = out_dir / "mhb.sqlite"
    db_path.unlink(missing_ok=True)
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.executescript("""
    CREATE TABLE source_documents(
        id INTEGER PRIMARY KEY, filename TEXT, sha256 TEXT,
        applied_date TEXT, masked_id TEXT, imported_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE encounters(
        id INTEGER PRIMARY KEY, doc_id INT, type TEXT, date TEXT,
        facility_name TEXT, facility_code TEXT,
        dx_code TEXT, dx_name TEXT, copay INT, nhi_points INT,
        extra_json TEXT, source_section TEXT, source_index INT);
    CREATE TABLE medications(
        id INTEGER PRIMARY KEY, doc_id INT, encounter_id INT,
        order_code TEXT, order_name TEXT, total_qty REAL, days_supply INT,
        tooth_code TEXT, tooth_name TEXT, source_section TEXT, source_index INT);
    CREATE TABLE lab_results(
        id INTEGER PRIMARY KEY, doc_id INT, visit_date TEXT, test_date TEXT,
        facility_name TEXT, order_code TEXT, order_name TEXT,
        item_name TEXT, value_text TEXT, value_numeric REAL, ref_range TEXT,
        quality_flags TEXT, source_section TEXT, source_index INT);
    CREATE TABLE reports(
        id INTEGER PRIMARY KEY, doc_id INT, visit_date TEXT, test_date TEXT,
        facility_name TEXT, order_code TEXT, order_name TEXT, report_text TEXT,
        source_section TEXT, source_index INT);
    CREATE TABLE body_measurements(
        id INTEGER PRIMARY KEY, doc_id INT, check_date TEXT,
        height_cm REAL, weight_kg REAL, bmi REAL, waist REAL,
        systolic INT, diastolic INT, extra_json TEXT,
        source_section TEXT, source_index INT);
    CREATE TABLE immunizations(
        id INTEGER PRIMARY KEY, doc_id INT, date TEXT, vaccine_name TEXT,
        facility_name TEXT, source_section TEXT, source_index INT);
    CREATE TABLE cancer_screenings(
        id INTEGER PRIMARY KEY, doc_id INT, category TEXT, item_name TEXT,
        detail_json TEXT, source_section TEXT, source_index INT);
    """)

    cur.execute(
        "INSERT INTO source_documents(filename, sha256, applied_date, masked_id) VALUES(?,?,?,?)",
        (src_path.name, sha256, norm_date(bdata.get("b1.2")), bdata.get("b1.1")),
    )
    doc_id = cur.lastrowid

    quality = {"file": src_path.name, "sha256": sha256, "sections": {}, "issues": []}

    def qsec(code, status, n_in=0, n_out=0):
        quality["sections"][code] = {
            "name": fm.SECTIONS.get(code, "?"), "status": status,
            "records_in": n_in, "records_out": n_out,
        }

    # --- 就醫事件（r1 西醫 / r3 牙醫 / r9 中醫）與其醫囑明細 ---
    for sec, (etype, dkey, fname_k, fcode_k, dxc_k, dxn_k, copay_k, pts_k, fmap) in ENCOUNTER_SECTIONS.items():
        rows = bdata.get(sec, [])
        if is_no_data(rows, sec):
            qsec(sec, "no_data")
            continue
        n_out = 0
        for i, rec in enumerate(rows):
            extra = {fmap.get(k, k): v for k, v in rec.items()
                     if k in fmap and v not in (None, "") and k not in
                     (dkey, fname_k, fcode_k, dxc_k, dxn_k, copay_k, pts_k)}
            d = norm_date(rec.get(dkey))
            rec_type = etype
            if d is None and sec == "r1" and norm_date(rec.get("r1.6")):
                # 藥局交付調劑：r1.5 就醫日期為空，以 r1.6 交付調劑日期代之
                d = norm_date(rec.get("r1.6"))
                rec_type = "pharmacy_dispensing"
            if d is None:
                quality["issues"].append(f"{sec}[{i}] 就醫日期無法解析: {rec.get(dkey)!r}")
            cur.execute(
                """INSERT INTO encounters(doc_id,type,date,facility_name,facility_code,
                   dx_code,dx_name,copay,nhi_points,extra_json,source_section,source_index)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (doc_id, rec_type, d, rec.get(fname_k), rec.get(fcode_k),
                 rec.get(dxc_k), rec.get(dxn_k), to_num(rec.get(copay_k)),
                 to_num(rec.get(pts_k)), json.dumps(extra, ensure_ascii=False), sec, i),
            )
            enc_id = cur.lastrowid
            n_out += 1
            # 巢狀醫囑：r1_1 / r3_1
            sub_key = f"{sec}_1"
            for j, med in enumerate(rec.get(sub_key, []) or []):
                cur.execute(
                    """INSERT INTO medications(doc_id,encounter_id,order_code,order_name,
                       total_qty,days_supply,tooth_code,tooth_name,source_section,source_index)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (doc_id, enc_id,
                     med.get(f"{sub_key}.1"), med.get(f"{sub_key}.2"),
                     to_num(med.get(f"{sub_key}.3")),
                     to_num(med.get(f"{sub_key}.6" if sec == "r3" else f"{sub_key}.4")),
                     med.get(f"{sub_key}.4") if sec == "r3" else None,
                     med.get(f"{sub_key}.5") if sec == "r3" else None,
                     f"{sec}>{sub_key}", j),
                )
        qsec(sec, "parsed", len(rows), n_out)

    # --- r7 檢驗檢查結果 ---
    rows = bdata.get("r7", [])
    if is_no_data(rows, "r7"):
        qsec("r7", "no_data")
    else:
        n_missing_val = 0
        for i, rec in enumerate(rows):
            vt = rec.get("r7.11")
            vnum = to_num(vt)
            flags = []
            if vt in (None, ""):
                flags.append("missing_value")
                n_missing_val += 1
            if vnum is None and vt not in (None, ""):
                flags.append("non_numeric_value")
            if rec.get("r7.12") in (None, ""):
                flags.append("missing_ref_range")
            cur.execute(
                """INSERT INTO lab_results(doc_id,visit_date,test_date,facility_name,
                   order_code,order_name,item_name,value_text,value_numeric,ref_range,
                   quality_flags,source_section,source_index)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (doc_id, norm_date(rec.get("r7.5")), norm_date(rec.get("r7.6")),
                 rec.get("r7.4"), rec.get("r7.8"), rec.get("r7.9"), rec.get("r7.10"),
                 vt, vnum, rec.get("r7.12"), ",".join(flags), "r7", i),
            )
        qsec("r7", "parsed", len(rows), len(rows))
        if n_missing_val:
            quality["issues"].append(f"r7 有 {n_missing_val} 筆結果值為空")

    # --- r8 影像或病理報告 ---
    rows = bdata.get("r8", [])
    if is_no_data(rows, "r8"):
        qsec("r8", "no_data")
    else:
        for i, rec in enumerate(rows):
            cur.execute(
                """INSERT INTO reports(doc_id,visit_date,test_date,facility_name,
                   order_code,order_name,report_text,source_section,source_index)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (doc_id, norm_date(rec.get("r8.5")), norm_date(rec.get("r8.6")),
                 rec.get("r8.4"), rec.get("r8.8"), rec.get("r8.9"),
                 rec.get("r8.10"), "r8", i),
            )
        qsec("r8", "parsed", len(rows), len(rows))

    # --- r6 預防接種 ---
    rows = bdata.get("r6", [])
    if is_no_data(rows, "r6"):
        qsec("r6", "no_data")
    else:
        for i, rec in enumerate(rows):
            cur.execute(
                "INSERT INTO immunizations(doc_id,date,vaccine_name,facility_name,source_section,source_index) VALUES(?,?,?,?,?,?)",
                (doc_id, norm_date(rec.get("r6.1")), rec.get("r6.3"), rec.get("r6.5"), "r6", i),
            )
        qsec("r6", "parsed", len(rows), len(rows))

    # --- r10 成人預防保健（身體數值）---
    rows = bdata.get("r10", [])
    if is_no_data(rows, "r10"):
        qsec("r10", "no_data")
    else:
        for i, rec in enumerate(rows):
            extra = {fm.R10.get(k, k): v for k, v in rec.items() if v not in (None, "")}
            cur.execute(
                """INSERT INTO body_measurements(doc_id,check_date,height_cm,weight_kg,bmi,
                   waist,systolic,diastolic,extra_json,source_section,source_index)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (doc_id, norm_date(rec.get("r10.5")), to_num(rec.get("r10.6")),
                 to_num(rec.get("r10.7")), to_num(rec.get("r10.8")), to_num(rec.get("r10.9")),
                 to_num(rec.get("r10.10")), to_num(rec.get("r10.11")),
                 json.dumps(extra, ensure_ascii=False), "r10", i),
            )
        qsec("r10", "parsed", len(rows), len(rows))

    # --- r11 癌症篩檢 ---
    rows = bdata.get("r11", [])
    if is_no_data(rows, "r11"):
        qsec("r11", "no_data")
    else:
        for i, rec in enumerate(rows):
            detail = rec.get("r11_1", [])
            cur.execute(
                "INSERT INTO cancer_screenings(doc_id,category,item_name,detail_json,source_section,source_index) VALUES(?,?,?,?,?,?)",
                (doc_id, rec.get("r11.1"), rec.get("r11.2"),
                 json.dumps(detail, ensure_ascii=False), "r11", i),
            )
        qsec("r11", "parsed", len(rows), len(rows))

    # --- 其餘節區（r2/r4/r5/r12/r13/r14）記錄狀態 ---
    for sec in ["r2", "r4", "r5", "r12", "r13", "r14"]:
        rows = bdata.get(sec, [])
        if is_no_data(rows, sec):
            qsec(sec, "no_data")
        elif rows:
            qsec(sec, "UNPARSED_HAS_DATA", len(rows))
            quality["issues"].append(f"{sec}（{fm.SECTIONS[sec]}）有資料但本版 parser 未處理")

    con.commit()

    # 品質摘要
    for table in ["encounters", "medications", "lab_results", "reports",
                  "immunizations", "body_measurements", "cancer_screenings"]:
        quality.setdefault("table_counts", {})[table] = cur.execute(
            f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    dmin, dmax = cur.execute("SELECT MIN(date), MAX(date) FROM encounters").fetchone()
    quality["encounter_date_range"] = [dmin, dmax]

    (out_dir / "quality_report.json").write_text(
        json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8")
    con.close()
    print(json.dumps(quality["table_counts"], ensure_ascii=False))
    print("date_range:", dmin, "~", dmax)
    print("issues:", len(quality["issues"]))
    for x in quality["issues"]:
        print("  -", x)


if __name__ == "__main__":
    main()
