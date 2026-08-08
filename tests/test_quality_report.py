"""品質報告：固定結構、欄位順序、增量 vs 全庫。"""
from src.quality.quality_report import TOP_KEYS, build_full, build_incremental, render_text
from src.store.db import Store


def _seeded_store(tmp_path):
    s = Store(tmp_path / "q.sqlite")
    pid, _ = s.get_or_create_profile("測試")
    doc, _ = s.register_source(pid, "f.json", "b" * 64, "nhi_json", "1.0")
    s.insert_fp_record("lab_results", {"r7.10": "MYSTERY"}, profile_id=pid, doc_id=doc,
                       section="r7", source_index=0,
                       columns={"test_name_raw": "MYSTERY", "test_date": "2026-01-01"},
                       quality_flags="unmapped")
    s.commit()
    return s


def test_schema_complete(tmp_path):
    s = _seeded_store(tmp_path)
    full = build_full(s)
    assert list(full) == TOP_KEYS
    assert full["unmapped_lab_names"] == ["MYSTERY"]
    assert full["quality_flags"] == {"unmapped": 1}
    assert full["sections"]["r7"]["records"] == 1
    text = render_text(full)
    assert "品質報告" in text and "未對照檢驗名" in text
    s.close()


def test_schema_complete_empty_db(tmp_path):
    s = Store(tmp_path / "empty.sqlite")
    full = build_full(s)
    assert list(full) == TOP_KEYS  # 空庫也是完整結構
    assert full["unmapped_lab_names"] == []
    s.close()


def test_incremental_vs_full(tmp_path):
    s = _seeded_store(tmp_path)
    inc = build_incremental(s, source_info={"filename": "f.json", "adapter": "nhi_json"},
                            sections={"r7": {"status": "parsed", "records": 1}})
    assert list(inc) == TOP_KEYS  # 兩者共用同一結構
    assert inc["dedup"]["skipped_dup"] == {}
    assert inc["source"]["filename"] == "f.json"
    s.close()
