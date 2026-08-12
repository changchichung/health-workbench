// 合成 EDF 產生器（change cpap-sleep-therapy task 2.2）。
//
// 刻意不 import src/adapters/edf.js 的任何常數或函式：若產生器與解析器
// 共用同一份佈局假設，兩邊一起錯也會通過測試。這裡的位移與欄位寬度全部
// 照 EDF 規格獨立寫死，測試斷言則用人為指定的已知值（不做往返比對）。
//
// 版面：256 固定頭 ＋ ns×256 訊號頭 ＋ 資料區（逐 record、record 內逐訊號、
// 每樣本 int16 小端序）。

// 缺測填充值：實測來源以數位值 -1 表示「此欄位無資料」，而不是用 digMin
// （digMin 多半是 0 或正數，且那些值是合法量測）。產生器沿用同一表示法，
// fixture 才會與真實檔案同形。
export const SENTINEL = -1;

// 固定寬度 ASCII 欄位：左對齊、右補空白、超長截斷（EDF 的 label 就是這樣
// 被截斷成 16 字元的，這也是測試要覆蓋的情境）
function pad(value, len) {
  const s = String(value);
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function writeAscii(bytes, offset, text) {
  for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i) & 0xff;
}

/**
 * signals: [{ label, dim, physMin, physMax, digMin, digMax, nsamp }]
 * records: 二維陣列 records[recordIndex][signalIndex] = 該訊號本 record 的
 *          數位值陣列（長度須為 nsamp；不足則以 SENTINEL 補滿，
 *          與真實來源同形）
 * opts: { startDate:"dd.mm.yy", startTime:"hh.mm.ss", recordDuration, reserved,
 *         declaredRecordCount（宣告值與實際 records 數不同時可製造截斷檔）,
 *         annotationBytes: { [signalIndex]: [Uint8Array per record] } }
 */
export function makeEdf(signals, records, opts = {}) {
  const {
    startDate = "27.03.22", startTime = "12.00.00", recordDuration = 86400,
    reserved = "EDF", declaredRecordCount = null, annotationBytes = null,
  } = opts;

  const ns = signals.length;
  const headerBytes = 256 + ns * 256;
  const perRecord = signals.reduce((a, s) => a + s.nsamp, 0) * 2;
  const total = headerBytes + records.length * perRecord;
  const bytes = new Uint8Array(total);

  // 固定頭
  writeAscii(bytes, 0, pad("0", 8));                       // version
  writeAscii(bytes, 8, pad("X X X X", 80));                // patient id（合成）
  writeAscii(bytes, 88, pad("Startdate 27-MAR-2022", 80)); // recording id（合成）
  writeAscii(bytes, 168, pad(startDate, 8));
  writeAscii(bytes, 176, pad(startTime, 8));
  writeAscii(bytes, 184, pad(headerBytes, 8));
  writeAscii(bytes, 192, pad(reserved, 44));
  writeAscii(bytes, 236, pad(declaredRecordCount ?? records.length, 8));
  writeAscii(bytes, 244, pad(recordDuration, 8));
  writeAscii(bytes, 252, pad(ns, 4));

  // 訊號頭：同一欄位連續放 ns 份
  let pos = 256;
  const block = (len, pick) => {
    for (let i = 0; i < ns; i += 1) writeAscii(bytes, pos + i * len, pad(pick(signals[i]), len));
    pos += ns * len;
  };
  block(16, s => s.label);
  block(80, () => "");                 // transducer
  block(8, s => s.dim ?? "");
  block(8, s => s.physMin);
  block(8, s => s.physMax);
  block(8, s => s.digMin);
  block(8, s => s.digMax);
  block(80, () => "");                 // prefiltering
  block(8, s => s.nsamp);
  block(32, () => "");                 // reserved

  // 資料區
  const view = new DataView(bytes.buffer);
  let offset = headerBytes;
  for (let r = 0; r < records.length; r += 1) {
    for (let si = 0; si < ns; si += 1) {
      const sig = signals[si];
      const annots = annotationBytes?.[si];
      if (annots) {
        // annotation 訊號：直接寫位元組（不足補 NUL，這也是真實檔案的樣子）
        const src = annots[r] ?? new Uint8Array(0);
        for (let i = 0; i < Math.min(src.length, sig.nsamp * 2); i += 1) {
          bytes[offset + i] = src[i];
        }
        offset += sig.nsamp * 2;
        continue;
      }
      const vals = records[r][si] ?? [];
      for (let i = 0; i < sig.nsamp; i += 1) {
        const v = i < vals.length ? vals[i] : SENTINEL;
        view.setInt16(offset + i * 2, v, true);
      }
      offset += sig.nsamp * 2;
    }
  }
  return bytes;
}

// TAL 位元組：onset[\x15duration]\x14label\x14 ＋ NUL 分隔
export function tal(onset, duration, label) {
  const dur = duration == null ? "" : `\x15${duration}`;
  const s = `${onset >= 0 ? "+" : ""}${onset}${dur}\x14${label}\x14\0`;
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// 一個 record 的 annotation 區：時間戳 TAL ＋ 事件 TAL，補滿到 byteLen
export function annotationRecord(byteLen, timekeepingOnset, events) {
  const parts = [tal(timekeepingOnset, null, "")];
  for (const e of events) parts.push(tal(e.onset, e.duration, e.label));
  const flat = [];
  for (const p of parts) flat.push(...p);
  if (flat.length > byteLen) {
    throw new Error(`annotation 超出 record 容量：${flat.length} > ${byteLen}`);
  }
  const out = new Uint8Array(byteLen);
  out.set(flat);
  return out;
}

// ResMed STR.edf 的訊號子集（label 刻意使用真實檔案中被截斷後的字串）
export const STR_SIGNALS = [
  { label: "Mask On", dim: "min.", physMin: 0, physMax: 1440, digMin: 0, digMax: 1440, nsamp: 10 },
  { label: "Mask Off", dim: "min.", physMin: 0, physMax: 1440, digMin: 0, digMax: 1440, nsamp: 10 },
  { label: "Mask Dur", dim: "min.", physMin: 0, physMax: 1440, digMin: 0, digMax: 1440, nsamp: 1 },
  { label: "Therapy Pres Me", dim: "cmH2O", physMin: 0, physMax: 30, digMin: 0, digMax: 1500, nsamp: 1 },
  { label: "Leak 95", dim: "L/s", physMin: 0, physMax: 5, digMin: 0, digMax: 250, nsamp: 1 },
  { label: "AHI", dim: "", physMin: 0, physMax: 240, digMin: 0, digMax: 2400, nsamp: 1 },
  { label: "AI", dim: "", physMin: 0, physMax: 240, digMin: 0, digMax: 2400, nsamp: 1 },
  { label: "HI", dim: "", physMin: 0, physMax: 240, digMin: 0, digMax: 2400, nsamp: 1 },
];

// SAD（血氧脈搏）：1Hz，一 record 一分鐘
export const SAD_SIGNALS = [
  { label: "Pulse", dim: "bpm", physMin: 18, physMax: 300, digMin: 18, digMax: 300, nsamp: 60 },
  { label: "SpO2", dim: "%", physMin: 0, physMax: 100, digMin: 0, digMax: 100, nsamp: 60 },
];

// EVE（事件）：EDF+D 的單一 annotation 訊號
export const EVE_SIGNALS = [
  { label: "EDF Annotations", dim: "", physMin: 0, physMax: 1439, digMin: -32768, digMax: 32767, nsamp: 18 },
];
