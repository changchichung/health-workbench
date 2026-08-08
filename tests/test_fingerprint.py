"""D1 內容指紋：JSON 與 XML 表示的同一筆紀錄必須產生相同 record_fp。

測項對應 Phase 0 實測的四種表示差異（docs/20260808_phase0_findings.md）：
鍵順序、空值表示（None vs ""）、引號置換（" vs '）、換行/空白。
"""
import pytest

from src.store.fingerprint import record_fp

# 同一筆西醫門診紀錄的「JSON 版」與「XML 版」表示
JSON_STYLE = {
    "r1.3": "3501020000",
    "r1.5": "20260101",
    "r1.6": "",              # JSON 空欄位是空字串
    "r1.9": "'測試'藥品名",   # JSON 把雙引號轉單引號
    "r1_1": [
        {"r1_1.1": "AC00000000", "r1_1.2": "藥品A", "r1_1.3": "14.00"},
        {"r1_1.1": "BC11111111", "r1_1.2": "藥品B", "r1_1.3": "7.00"},
    ],
}
XML_STYLE = {
    "r1.5": "20260101",      # 鍵順序不同
    "r1.6": None,            # XML 空標籤是 None
    "r1.3": "3501020000",
    "r1.9": '"測試"藥品名',   # XML 保留雙引號
    "r1_1": [                # 巢狀順序不同
        {"r1_1.2": "藥品B", "r1_1.1": "BC11111111", "r1_1.3": "7.00"},
        {"r1_1.3": "14.00", "r1_1.1": "AC00000000", "r1_1.2": "藥品A"},
    ],
}


def test_json_xml_same_fp():
    assert record_fp(JSON_STYLE) == record_fp(XML_STYLE)


def test_whitespace_and_newline_normalized():
    a = {"r8.10": "Findings:\n\n  Liver: fine\n  GB: negative"}
    b = {"r8.10": "Findings: Liver: fine GB: negative"}
    assert record_fp(a) == record_fp(b)


def test_different_content_different_fp():
    a = dict(JSON_STYLE)
    b = dict(JSON_STYLE, **{"r1.5": "20260102"})
    assert record_fp(a) != record_fp(b)


def test_nested_change_changes_fp():
    b = {**JSON_STYLE, "r1_1": [dict(JSON_STYLE["r1_1"][0], **{"r1_1.3": "15.00"}),
                                 JSON_STYLE["r1_1"][1]]}
    assert record_fp(JSON_STYLE) != record_fp(b)


def test_fp_format():
    fp = record_fp(JSON_STYLE)
    assert isinstance(fp, str) and len(fp) == 32  # SHA-256 前 16 bytes hex
    int(fp, 16)  # 合法 hex


def test_canonical_stable_across_calls():
    assert record_fp(JSON_STYLE) == record_fp(JSON_STYLE)
