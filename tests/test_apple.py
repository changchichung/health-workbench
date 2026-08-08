"""apple-health-import：串流解析、來源別修正、品質旗標、檔內去重、冪等。"""
from pathlib import Path

import pytest

from src.adapters.apple_health import AppleHealthAdapter
from src.store.db import Store

FIXTURE = Path(__file__).parent / "fixtures" / "apple_sample.xml"


@pytest.fixture
def imported(tmp_path):
    db = tmp_path / "a.sqlite"
    rc = AppleHealthAdapter().import_file(FIXTURE, db_path=db, assume_profile=True)
    assert rc == 0
    s = Store(db)
    yield s, db
    s.close()


def test_detect_by_content(tmp_path):
    assert AppleHealthAdapter.detect(FIXTURE)
    # 檔名無關：改名也認得
    renamed = tmp_path / "輸出.xml"
    renamed.write_bytes(FIXTURE.read_bytes())
    assert AppleHealthAdapter.detect(renamed)
    # 非 Apple XML 不誤判
    other = tmp_path / "other.xml"
    other.write_text("<root><data/></root>")
    assert not AppleHealthAdapter.detect(other)


def test_stream_parse(imported):
    s, _ = imported
    counts = s.table_counts()
    # 10 筆掃描：9 筆 WANTED（1 筆非目標型別忽略）、1 筆檔內重複 → 8 筆入庫
    assert counts["apple_records"] == 8
    assert counts["apple_workouts"] == 1
    # 非目標型別未入庫
    n = s.con.execute("SELECT COUNT(*) FROM apple_records"
                      " WHERE type LIKE '%EnvironmentalAudio%'").fetchone()[0]
    assert n == 0


def test_source_unit_rules(imported):
    s, _ = imported
    row = s.con.execute(
        "SELECT value_numeric, value_normalized, quality_flags FROM apple_records"
        " WHERE type_zh='體脂率'").fetchone()
    assert row["value_numeric"] == 0.255      # 原值保留
    assert row["value_normalized"] == 25.5    # 修正值
    assert "unit_normalized" in row["quality_flags"]


def test_epoch_flag(imported):
    s, _ = imported
    row = s.con.execute(
        "SELECT quality_flags FROM apple_records WHERE start_ts LIKE '1970%'").fetchone()
    assert "epoch_placeholder_date" in row["quality_flags"]


def test_outlier_flag(imported):
    s, _ = imported
    row = s.con.execute(
        "SELECT quality_flags FROM apple_records WHERE value_numeric=8.6").fetchone()
    assert "out_of_range" in row["quality_flags"]


def test_intra_file_dedup(imported):
    s, _ = imported
    n = s.con.execute(
        "SELECT COUNT(*) FROM apple_records WHERE type_zh='心率'").fetchone()[0]
    assert n == 1  # 兩筆完全相同只入一筆


def test_apple_idempotent(imported, tmp_path):
    """同內容另存新檔重匯：紀錄層冪等零新增。"""
    s, db = imported
    before = s.table_counts()
    copy2 = tmp_path / "copy.xml"
    copy2.write_bytes(FIXTURE.read_bytes()[:-1] + b"\n")  # 位元組不同、紀錄相同
    rc = AppleHealthAdapter().import_file(copy2, db_path=db, assume_profile=True)
    assert rc == 0
    s2 = Store(db)
    assert s2.table_counts()["apple_records"] == before["apple_records"]
    assert s2.table_counts()["apple_workouts"] == before["apple_workouts"]
    s2.close()


def test_step_dedup(imported):
    """跨來源重複計數防護：每日各來源加總取最大。"""
    s, _ = imported
    row = s.con.execute("""
        WITH daily AS (
          SELECT substr(start_ts,1,10) d, source_name, SUM(value_numeric) v
          FROM apple_records WHERE type_zh='步數' AND quality_flags=''
          GROUP BY d, source_name)
        SELECT MAX(v) FROM daily WHERE d='2024-01-01'""").fetchone()
    assert row[0] == 7500  # 非 13500
