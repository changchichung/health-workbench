"""嵌入資料產生器（D2 三層）：醫療類全量、活動類日聚合、明細留庫。

- 跨來源重複計數防護：計數型活動資料每日各來源加總取最大（incremental-merge spec）
- 品質旗標排除：epoch_placeholder_date / out_of_range 不進趨勢序列
- 輸出各層體積明細供 size gate 使用
- JSON 內嵌採 \\u003c 跳脫，防止 </script> 逃逸與 HTML 誤解析
"""
import json
from datetime import date

from src.knowledge.drugs import DrugLookup
from src.knowledge.labs import load_entries

TREND_EXCLUDE = "quality_flags NOT LIKE '%epoch_placeholder_date%' AND quality_flags NOT LIKE '%out_of_range%'"

# 計數型（日加總取最大）vs 量測型（日中位數）
COUNTING_TYPES = ["步數", "步行跑步距離", "騎車距離", "爬樓層數", "活動能量", "基礎能量"]
MEASURE_TYPES = ["體重", "BMI", "體脂率", "收縮壓", "舒張壓", "心率", "血氧"]


def daily_counting_series(store, type_zh):
    """計數型：每日各來源分別加總後取單日最大值（防 iPhone/Watch 雙計）。"""
    rows = store.con.execute(f"""
        WITH daily AS (
          SELECT substr(start_ts,1,10) d, source_name, SUM(COALESCE(value_normalized, value_numeric)) v
          FROM apple_records WHERE type_zh=? AND {TREND_EXCLUDE}
          GROUP BY d, source_name)
        SELECT d, MAX(v) FROM daily GROUP BY d ORDER BY d""", (type_zh,)).fetchall()
    return [[r[0], round(r[1], 1)] for r in rows if r[1] is not None]


def daily_measure_series(store, type_zh):
    """量測型：每日中位數（抗離群）。"""
    rows = store.con.execute(f"""
        SELECT substr(start_ts,1,10) d, COALESCE(value_normalized, value_numeric) v
        FROM apple_records WHERE type_zh=? AND {TREND_EXCLUDE} AND
        COALESCE(value_normalized, value_numeric) IS NOT NULL
        ORDER BY d""", (type_zh,)).fetchall()
    buckets = {}
    for d, v in rows:
        buckets.setdefault(d, []).append(v)
    return [[d, round(sorted(vs)[len(vs) // 2], 2)] for d, vs in sorted(buckets.items())]


def build_payload(store, db_path):
    """組出 dashboard 嵌入資料。回傳 (payload dict, 各層體積 bytes)。"""
    con = store.con

    # --- 醫療層（全量） ---
    encounters = [dict(r) for r in con.execute("""
        SELECT e.id, e.type, e.date, e.facility_name, e.dx_code, e.dx_name,
               e.copay, e.nhi_points, e.section, e.source_index, e.quality_flags,
               d.filename AS source_file
        FROM encounters e JOIN source_documents d ON e.doc_id = d.id
        ORDER BY e.date DESC, e.id DESC""")]
    meds_by_enc = {}
    lookup = DrugLookup(db_path)
    medications = []
    for r in con.execute("""
        SELECT m.id, m.encounter_id, m.order_code, m.order_name, m.total_qty,
               m.days_supply, m.tooth_name, e.date, e.facility_name
        FROM medications m JOIN encounters e ON m.encounter_id = e.id
        ORDER BY e.date DESC"""):
        m = dict(r)
        drug = lookup.lookup(m["order_code"])
        if drug:
            m["drug_zh"] = drug["name_zh"]
            m["ingredient"] = drug["ingredient"]
            m["leaflet_url"] = drug["leaflet_url"]
        medications.append(m)
        meds_by_enc.setdefault(m["encounter_id"], []).append(m["id"])
    drug_cache_meta = lookup.meta()
    lookup.close()

    labs = [dict(r) for r in con.execute("""
        SELECT id, COALESCE(test_name_normalized, test_name_raw) AS name,
               test_name_raw, test_name_normalized IS NULL AS unmapped,
               test_date, value_text, value_numeric, ref_range, facility_name,
               order_name, quality_flags
        FROM lab_results ORDER BY test_date""")]
    reports = [dict(r) for r in con.execute("""
        SELECT id, visit_date, test_date, facility_name, order_name, report_text
        FROM reports ORDER BY test_date DESC""")]
    immunizations = [dict(r) for r in con.execute(
        "SELECT date, vaccine_name, facility_name FROM immunizations ORDER BY date DESC")]
    nhi_body = [dict(r) for r in con.execute("""
        SELECT check_date, height_cm, weight_kg, bmi, waist, systolic, diastolic
        FROM body_measurements ORDER BY check_date""")]

    # --- knowledge 條目（檢驗說明） ---
    knowledge = {e["normalized_name"]: {
        "description": e["description"], "source_name": e["source_name"],
        "source_url": e["source_url"], "cited_date": str(e["cited_date"])}
        for e in load_entries()}

    # --- 活動層（日聚合） ---
    activity = {t: daily_counting_series(store, t) for t in COUNTING_TYPES}
    measures = {t: daily_measure_series(store, t) for t in MEASURE_TYPES}
    workouts = [dict(r) for r in con.execute("""
        SELECT activity, substr(start_ts,1,10) AS date, duration_min, source_name
        FROM apple_workouts ORDER BY start_ts DESC""")]

    payload = {
        "meta": {
            "generated_at": date.today().isoformat(),
            "profile": con.execute("SELECT display_name FROM profiles LIMIT 1").fetchone()[0],
            "counts": store.table_counts(),
            "sources": [dict(r) for r in con.execute(
                "SELECT filename, adapter, imported_at FROM source_documents")],
            "drug_cache": drug_cache_meta,
        },
        "encounters": encounters,
        "meds_by_enc": meds_by_enc,
        "medications": medications,
        "labs": labs,
        "reports": reports,
        "immunizations": immunizations,
        "nhi_body": nhi_body,
        "knowledge": knowledge,
        "activity": activity,
        "measures": measures,
        "workouts": workouts,
    }

    sizes = {}
    medical_keys = ["encounters", "meds_by_enc", "medications", "labs", "reports",
                    "immunizations", "nhi_body", "knowledge"]
    activity_keys = ["activity", "measures", "workouts"]
    for group, keys in [("medical", medical_keys), ("activity", activity_keys),
                        ("meta", ["meta"])]:
        sizes[group] = sum(len(json.dumps(payload[k], ensure_ascii=False).encode())
                           for k in keys)
    return payload, sizes


def to_embedded_json(payload):
    """安全內嵌：\\u003c 跳脫防 </script> 逃逸；> 與 & 一併跳脫。"""
    s = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return s.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
