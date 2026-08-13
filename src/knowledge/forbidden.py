"""非結論式用語約束：knowledge 條目與介面文案的禁用詞檢查。

引述原始報告文字（標示為原文）不在檢查範圍——本檢查只作用於
工具自產的說明文字與介面文案。
"""

FORBIDDEN_WORDS = [
    "診斷為", "確診", "預測", "罹患", "你可能罹患", "您可能罹患",
    "建議停藥", "建議換藥", "應停止服用", "不適合服用",
    "需要接受治療", "治療建議", "風險分數",
    # 介面呈現機器數值時不用治療語氣（2026-08-13）：機器輸出的壓力值叫
    # 「送氣壓力」，自正午起算的一晚在規格與註解裡叫「紀錄夜」、介面說
    # 「入睡當晚」。NEVER 加寬成「治療」二字：免責聲明本身就有
    # 「不提供診斷、治療或用藥建議」，加寬會讓免責聲明自我違規。
    "治療壓力", "治療夜",
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
