// D1 內容指紋 JS 版：與 src/store/fingerprint.py 逐位元組等價。
// 關鍵：Python json.dumps 預設分隔符是 ", " 與 ": "（含空格），
// JSON.stringify 無空格，MUST 用 pyJsonDumps 重現，否則指紋全面不合。
// 差分測試：tests/engine/fingerprint_parity.test.mjs。

const WS_RE = /\s+/g;

// 重現 Python json.dumps(obj, ensure_ascii=False) 的輸出。
// sortKeys=true 對應 sort_keys=True（指紋用）；false 保持插入順序
// （import_stats/extra_json 用，鏡像 Python 預設）。
export function pyJsonDumps(obj, opts = {}) {
  const { sortKeys = true } = opts;
  const rec = (o) => {
    if (o === null || o === undefined) return "null";
    if (typeof o === "boolean") return o ? "true" : "false";
    if (typeof o === "number") return numRepr(o);
    if (typeof o === "string") return JSON.stringify(o);
    if (Array.isArray(o)) return `[${o.map(rec).join(", ")}]`;
    const keys = sortKeys ? Object.keys(o).sort() : Object.keys(o);
    return `{${keys.map(k => `${JSON.stringify(k)}: ${rec(o[k])}`).join(", ")}}`;
  };
  return rec(obj);
}

// Python repr 與 JS toString 對 JSON 來源的數皆為最短往返表示；
// 整數值需與 Python int 一致不帶小數點（JS 對整數值 toString 本即如此）。
function numRepr(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return String(n);
}

function normValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(WS_RE, " ").trim().replaceAll('"', "'");
  return v;
}

function canonField(v) {
  if (Array.isArray(v)) {
    const items = v.map(canon);
    return items
      .map(x => [pyJsonDumps(x), x])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(p => p[1]);
  }
  if (v !== null && typeof v === "object") return canon(v);
  return normValue(v);
}

function canon(obj) {
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = canonField(obj[k]);
    return out;
  }
  return canonField(obj);
}

export function canonicalJson(record) {
  return pyJsonDumps(canon(record));
}

// SHA-256 前 16 bytes hex（32 字元）。WebCrypto 在 Node 與 WKWebView 皆可用。
export async function recordFp(record) {
  const data = new TextEncoder().encode(canonicalJson(record));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest).slice(0, 16)]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
