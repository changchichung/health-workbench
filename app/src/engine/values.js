// 數值解析契約（design D3：以 Python 行為為準，禁止 parseFloat 前綴寬鬆）。
// 差分測試：tests/engine/values_parity.test.mjs 以 Python 實跑對照。

// Python float() 等價（Apple adapter 的 _to_float）：完整字串必須是合法
// 浮點文字，否則 null。非有限值（inf/nan：Python 接受）在本系統一律視為
// 無效值回 null（資料面不存在，且 JSON 序列化無法攜帶非有限值）。
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// Python 數字文字前處理鏡像：全形數字轉半形（int("３")=3；小數點/正負號/
// 指數符號 Python 只收 ASCII，不轉）、合法底線分隔移除（int("1_000")=1000；
// 底線必須夾在數字間）。其他 Unicode Nd 數字系統（如天城文）Python 也收，
// 但健保/Apple 資料不存在，不鏡像。
function pyNumText(s) {
  let t = String(s).trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (t.includes("_")) {
    const collapsed = t.replace(/(\d)_(?=\d)/g, "$1");
    if (collapsed.includes("_")) return null; // 非法底線位置
    t = collapsed;
  }
  return t;
}

export function pyFloat(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const t = pyNumText(s);
  if (t === null || !FLOAT_RE.test(t)) return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

// nhi_json.to_num 等價：None/數字直通；字串 strip 後，含 "." 走 float()、
// 否則走 int()；失敗回 null。
const INT_RE = /^[+-]?\d+$/;
export function toNum(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return s;
  const t = pyNumText(s);
  if (t === null) return null;
  if (t.includes(".")) return pyFloat(t);
  return INT_RE.test(t) ? parseInt(t, 10) : null;
}

// 本機時區的今天（YYYY-MM-DD）。NEVER 用 toISOString()：那是 UTC 日期，
// 台北 UTC+8 每天 00:00-08:00 會早一天，與 Python 端 date.today()（本地）
// 產生的 generated_at 不一致；趨勢圖以 generated_at 為時間軸上界後，
// 這個落差會直接反映成兩邊圖形差一日。
export function localDateISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// nhi_json.norm_date 等價：8 碼 → YYYY-MM-DD；6 碼 → YYYY-MM；其餘 null。
export function normDate(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}`;
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}`;
  return null;
}
