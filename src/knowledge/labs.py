"""labs.yaml 載入、schema 驗證、別名正規化寫入（D5）。"""
from datetime import date, datetime
from pathlib import Path

import yaml

from .forbidden import check_entries

LABS_YAML = Path(__file__).parent / "labs.yaml"
REQUIRED_FIELDS = ["normalized_name", "aliases", "description",
                   "source_name", "source_url", "cited_date"]
STALE_DAYS = 365


class KnowledgeError(ValueError):
    """knowledge 條目不合規（缺欄位或含禁用詞）→ 建置失敗。"""


def load_entries(path=LABS_YAML):
    """載入並驗證條目。缺欄位或含禁用詞 → KnowledgeError。"""
    entries = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    for e in entries:
        # aliases 允許空清單（正規化名本身即匹配鍵），其餘欄位必須非空
        missing = [f for f in REQUIRED_FIELDS
                   if f not in e or (f != "aliases" and not e.get(f))]
        if missing or not isinstance(e.get("aliases"), list):
            raise KnowledgeError(
                f"條目 {e.get('normalized_name', '(未命名)')} 缺欄位或型別錯誤：{missing or 'aliases'}")
    violations = check_entries(entries)
    if violations:
        raise KnowledgeError(f"條目含禁用詞：{violations}")
    return entries


def alias_map(entries):
    """別名（含正規化名本身）→ normalized_name。別名衝突 → 建置失敗。"""
    m = {}
    for e in entries:
        for alias in [e["normalized_name"], *e["aliases"]]:
            key = alias.strip()
            if key in m and m[key] != e["normalized_name"]:
                raise KnowledgeError(f"別名衝突：{key} 同時指向 {m[key]} 與 {e['normalized_name']}")
            m[key] = e["normalized_name"]
    return m


def apply_normalization(store, entries=None):
    """寫入 test_name_normalized；未匹配者 NULL 並標 unmapped 旗標。

    冪等：重跑會重算全部 lab_results 的正規化欄位與 unmapped 旗標。
    """
    entries = entries if entries is not None else load_entries()
    m = alias_map(entries)
    cur = store.con.cursor()
    rows = cur.execute("SELECT id, test_name_raw, quality_flags FROM lab_results").fetchall()
    mapped = unmapped = 0
    for r in rows:
        raw = (r["test_name_raw"] or "").strip()
        normalized = m.get(raw)
        flags = [f for f in (r["quality_flags"] or "").split(",") if f and f != "unmapped"]
        if normalized:
            mapped += 1
        else:
            unmapped += 1
            flags.append("unmapped")
        cur.execute("UPDATE lab_results SET test_name_normalized=?, quality_flags=? WHERE id=?",
                    (normalized, ",".join(flags), r["id"]))
    store.con.commit()
    return {"mapped": mapped, "unmapped": unmapped}


def stale_entries(entries=None, today=None):
    """cited_date 超過一年的條目清單（過時提醒，不自動更新）。"""
    entries = entries if entries is not None else load_entries()
    today = today or date.today()
    out = []
    for e in entries:
        cited = e["cited_date"]
        if isinstance(cited, str):
            cited = datetime.strptime(cited, "%Y-%m-%d").date()
        if (today - cited).days > STALE_DAYS:
            out.append({"normalized_name": e["normalized_name"],
                        "cited_date": str(cited)})
    return out
