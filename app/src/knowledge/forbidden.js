// 非結論式用語約束 JS 版。禁用詞清單的 SSOT 是 src/knowledge/forbidden.py，
// tests/knowledge/forbidden_guard.test.mjs 會解析 Python 檔比對本清單，
// 兩邊不同步即測試失敗（防漂移）。
export const FORBIDDEN_WORDS = [
  "診斷為", "確診", "預測", "罹患", "你可能罹患", "您可能罹患",
  "建議停藥", "建議換藥", "應停止服用", "不適合服用",
  "需要接受治療", "治療建議", "風險分數",
  "屬於正常", "屬於不正常", "數值正常", "數值不正常", "結果正常", "結果異常代表",
];

// 回傳命中的禁用詞清單（空清單 = 通過）
export function checkText(text) {
  return FORBIDDEN_WORDS.filter(w => (text || "").includes(w));
}
