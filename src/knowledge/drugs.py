"""健保用藥品項本機快取（D4）：hwb knowledge update 手動更新，建置不外連。

資料集：健保用藥品項查詢項目檔（data.gov.tw/dataset/23715，政府資料開放授權）
下載端點：https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-E41001-001
快取檔：<db 同目錄>/drug_items.sqlite（非個資，體積大不入 git）
"""
import csv
import io
import sqlite3
import sys
import urllib.request
from datetime import date
from pathlib import Path

DATASET_URL = "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-E41001-001"
DATASET_PAGE = "https://data.gov.tw/dataset/23715"


def cache_path(db_path):
    return Path(db_path).parent / "drug_items.sqlite"


def update_cache(db_path, source=None):
    """下載品項檔重建快取。source 可傳本地 CSV 路徑（測試/離線用）。

    同一藥品代號保留有效迄日最大的一列。回傳統計 dict。
    """
    if source and Path(source).exists():
        raw = Path(source).read_bytes()
    else:
        print(f"下載健保用藥品項資料集（{DATASET_PAGE}）…")
        req = urllib.request.Request(DATASET_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            raw = resp.read()

    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    best = {}
    for row in reader:
        code = (row.get("藥品代號") or "").strip()
        if not code:
            continue
        end = (row.get("有效迄日") or "").strip()
        if code not in best or end > best[code]["end"]:
            best[code] = {
                "end": end,
                "name_en": row.get("藥品英文名稱"),
                "name_zh": row.get("藥品中文名稱"),
                "ingredient": row.get("成分"),
                "dosage_form": row.get("劑型"),
                "atc": row.get("ATC代碼"),
                "leaflet_url": row.get("藥品代碼超連結"),
            }

    path = cache_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript("""
        DROP TABLE IF EXISTS drug_items;
        CREATE TABLE drug_items(
            code TEXT PRIMARY KEY, name_en TEXT, name_zh TEXT, ingredient TEXT,
            dosage_form TEXT, atc TEXT, leaflet_url TEXT, valid_until TEXT);
        DROP TABLE IF EXISTS cache_meta;
        CREATE TABLE cache_meta(key TEXT PRIMARY KEY, value TEXT);
    """)
    con.executemany(
        "INSERT INTO drug_items VALUES(?,?,?,?,?,?,?,?)",
        [(c, v["name_en"], v["name_zh"], v["ingredient"], v["dosage_form"],
          v["atc"], v["leaflet_url"], v["end"]) for c, v in best.items()])
    con.execute("INSERT INTO cache_meta VALUES('updated_at', ?)", (date.today().isoformat(),))
    con.execute("INSERT INTO cache_meta VALUES('dataset_url', ?)", (DATASET_PAGE,))
    con.commit()
    con.close()
    stats = {"distinct_codes": len(best), "cache": str(path)}
    print(f"快取完成：{len(best)} 個藥品代號 → {path}")
    return stats


class DrugLookup:
    """離線查詢（建置時 join 用）。快取不存在時全部回 None，不外連。"""

    def __init__(self, db_path):
        p = cache_path(db_path)
        self.con = sqlite3.connect(p) if p.exists() else None
        if self.con:
            self.con.row_factory = sqlite3.Row

    def meta(self):
        if not self.con:
            return None
        return dict(self.con.execute("SELECT key, value FROM cache_meta").fetchall())

    def lookup(self, order_code):
        """醫囑代碼前 10 碼 → 品項資訊；查無回 None。"""
        if not self.con or not order_code:
            return None
        row = self.con.execute("SELECT * FROM drug_items WHERE code=?",
                               ((order_code or "")[:10],)).fetchone()
        return dict(row) if row else None

    def close(self):
        if self.con:
            self.con.close()
