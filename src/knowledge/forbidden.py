"""非結論式用語約束：knowledge 條目與介面文案的禁用詞檢查。

引述原始報告文字（標示為原文）不在檢查範圍——本檢查只作用於
工具自產的說明文字與介面文案。
"""

FORBIDDEN_WORDS = [
    "診斷為", "確診", "預測", "罹患", "你可能罹患", "您可能罹患",
    "建議停藥", "建議換藥", "應停止服用", "不適合服用",
    "需要接受治療", "治療建議", "風險分數",
    "屬於正常", "屬於不正常", "數值正常", "數值不正常", "結果正常", "結果異常代表",
]


def check_text(text):
    """回傳命中的禁用詞清單（空清單 = 通過）。"""
    return [w for w in FORBIDDEN_WORDS if w in (text or "")]


def check_entries(entries):
    """檢查 knowledge 條目集合，回傳 [(條目名, 禁用詞), ...]。"""
    violations = []
    for e in entries:
        for w in check_text(e.get("description", "")):
            violations.append((e.get("normalized_name", "?"), w))
    return violations
