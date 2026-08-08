"""incremental-merge：視窗接續冪等、跨批次改版偵測。"""
import json
from pathlib import Path

import pytest

from src.adapters.nhi_json import NhiJsonAdapter
from src.quality.quality_report import build_full
from src.store.db import Store

FIXTURE = Path(__file__).parent / "fixtures" / "nhi_sample.json"


def load_fixture():
    return json.loads(FIXTURE.read_bytes().decode("utf-8-sig"))


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def fp_set(db):
    s = Store(db)
    fps = {(r[0], r[1]) for r in s.con.execute("SELECT section, record_fp FROM encounters")}
    counts = s.table_counts()
    s.close()
    return fps, counts


def test_window_extension(tmp_path):
    """視窗位移批次：重疊紀錄不重複，僅新增新紀錄。"""
    db = tmp_path / "m.sqlite"
    assert NhiJsonAdapter().import_file(FIXTURE, db_path=db, assume_profile=True) == 0
    fps1, counts1 = fp_set(db)

    # 批次二：模擬下個月下載——最舊一筆消失（滾出視窗）、其餘相同（鍵序重排、
    # 空值改寫模擬 XML 式表示差異）、新增一筆新就醫
    data = load_fixture()
    bd = data["myhealthbank"]["bdata"]
    bd["b1.2"] = "20260201"
    kept = bd["r1"][1:]                          # 最舊一筆滾出
    kept = [dict(reversed(list(r.items()))) for r in kept]   # 鍵序重排
    new_rec = {"r1.1": "1", "r1.2": "臺北業務組", "r1.3": "9900000001",
               "r1.4": "測試綜合醫院", "r1.5": "20260201", "r1.7": "0009",
               "r1.8": "J00X", "r1.9": "測試診斷甲", "r1.12": "100", "r1.13": "500",
               "r1_1": [{"r1_1.1": "XX00000001", "r1_1.2": "測試藥品Ａ錠",
                         "r1_1.3": "14.00", "r1_1.4": "7"}]}
    bd["r1"] = kept + [new_rec]
    batch2 = tmp_path / "batch2.json"
    write_json(batch2, data)

    assert NhiJsonAdapter().import_file(batch2, db_path=db, assume_profile=True) == 0
    fps2, counts2 = fp_set(db)
    assert counts2["encounters"] == counts1["encounters"] + 1   # 只增新紀錄
    assert fps1 <= fps2                                          # 舊紀錄保留（縱深累積）
    assert counts2["medications"] == counts1["medications"] + 1


def test_idempotent_same_content_different_file(tmp_path):
    """同內容另存新檔（sha 不同）：紀錄層冪等，零新增。"""
    db = tmp_path / "m.sqlite"
    assert NhiJsonAdapter().import_file(FIXTURE, db_path=db, assume_profile=True) == 0
    _, counts1 = fp_set(db)
    data = load_fixture()
    copy2 = tmp_path / "copy2.json"
    write_json(copy2, data)  # 重新序列化 → 位元組不同、內容相同
    assert NhiJsonAdapter().import_file(copy2, db_path=db, assume_profile=True) == 0
    fps2, counts2 = fp_set(db)
    for t in ["encounters", "medications", "lab_results", "reports"]:
        assert counts2[t] == counts1[t], t


def test_superseded_detection(tmp_path):
    """跨批次同弱鍵不同指紋 → superseded_candidates；同批次多筆申報不誤報。"""
    db = tmp_path / "m.sqlite"
    assert NhiJsonAdapter().import_file(FIXTURE, db_path=db, assume_profile=True) == 0
    data = load_fixture()
    bd = data["myhealthbank"]["bdata"]
    bd["r1"] = [dict(bd["r1"][0], **{"r1.9": "測試診斷甲（改版名稱）"})]  # 同弱鍵、內容改
    batch2 = tmp_path / "revised.json"
    write_json(batch2, data)
    assert NhiJsonAdapter().import_file(batch2, db_path=db, assume_profile=True) == 0

    s = Store(db)
    report = build_full(s)
    assert report["superseded_candidates"] == 1
    # 兩筆並存，未自動刪除
    n = s.con.execute("""SELECT COUNT(*) FROM encounters
        WHERE facility_code='9900000001' AND date='2025-01-03'""").fetchone()[0]
    assert n == 2
    s.close()
