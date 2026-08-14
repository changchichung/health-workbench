"""Python 端的表清單對帳（2026-08-14 紅隊指出的防線不對稱）。

JS 端有 app/tests/engine/table_coverage.test.mjs 以 DDL 反查清單完整性，
Python 端原本沒有等價測試：未來 Python 漏加新表不會有任何測試轉紅，而兩端
的品質報告必須逐位元組同構（見 app/tests/parity/）。

這裡鏡像 JS 那份的判準：從 DDL 解析出每張表與其欄位，斷言清單跟得上 schema，
且不含 schema 沒有的表（查詢會直接拋錯）。
"""
import re

from src.store.schema import (ALL_TABLES, DDL, FP_TABLES, QUALITY_FLAG_TABLES)
from src.quality.quality_report import DATE_RANGE_COLUMNS

# 非「成員資料」的表：schema 版本紀錄與 profiles 本身
META_TABLES = {"schema_version", "profiles"}

TABLE_BLOCK = re.compile(
    r"CREATE TABLE IF NOT EXISTS (\w+)\((.*?)\);", re.S)


def _blocks():
    blocks = TABLE_BLOCK.findall(DDL)
    # 護欄：解析式失效時 blocks 會是空的，下面每條斷言都會假綠
    assert len(blocks) >= 15, f"DDL 只解析到 {len(blocks)} 張表，解析式可能已失效"
    return blocks


def test_quality_flag_tables_covers_ddl():
    """帶 quality_flags 欄位的表都要在掃描清單裡。

    漏掉的表其旗標永遠不會出現在品質報告上，而畫面照樣顯示「品質旗標：無」，
    看起來像這批資料很乾淨（2026-08-14 實測：CPAP 三表與 apple_workouts 都漏）。
    """
    with_flags = [name for name, body in _blocks() if "quality_flags" in body]
    assert len(with_flags) >= 12, (
        f"只解析到 {len(with_flags)} 張帶 quality_flags 的表，解析式可能已失效")
    missing = [t for t in with_flags if t not in QUALITY_FLAG_TABLES]
    assert missing == [], f"這些表的品質旗標不會被統計：{missing}"


def test_quality_flag_tables_has_no_ghost():
    """清單不得列出沒有該欄位的表：統計查詢會直接拋錯。"""
    with_flags = {name for name, body in _blocks() if "quality_flags" in body}
    ghosts = [t for t in QUALITY_FLAG_TABLES if t not in with_flags]
    assert ghosts == [], f"這些表沒有 quality_flags 欄位：{ghosts}"


def test_all_tables_covers_ddl():
    """ALL_TABLES 要涵蓋 DDL 的每一張資料表。"""
    names = [name for name, _ in _blocks() if name not in META_TABLES]
    missing = [t for t in names if t not in ALL_TABLES]
    assert missing == [], f"ALL_TABLES 漏掉：{missing}"


def test_date_range_columns_are_real():
    """日期範圍的表與欄位都要真的存在，否則報告產生時會拋錯。

    這份對照無法用 DDL 自動補全（不是每張有日期的表都值得報告，欄位名也各異），
    但至少要擋住「表名或欄位名打錯」與「表被移除後忘了改」。
    """
    cols = {name: body for name, body in _blocks()}
    for table, col in DATE_RANGE_COLUMNS:
        assert table in cols, f"date_ranges 引用了不存在的表：{table}"
        assert re.search(rf"\b{col}\b", cols[table]), (
            f"{table} 沒有欄位 {col}")


def test_fp_tables_are_subset_of_quality_flag_tables():
    """指紋表都帶 quality_flags（碰撞時要標記），所以必為掃描清單的子集。"""
    missing = [t for t in FP_TABLES if t not in QUALITY_FLAG_TABLES]
    assert missing == [], f"指紋表未納入品質旗標統計：{missing}"
