// EDF／EDF+ 解析純函式（change cpap-sleep-therapy 第 2 組）。
// EDF 是公開標準，本檔照規格自行實作，未參考任何 GPL 授權實作。
//
// 版面：256 位元組固定頭 ＋ ns×256 位元組訊號頭 ＋ 資料區。
// 資料區逐 record 排列，每 record 內依訊號順序放 nsamp 個 int16（小端序）。
// 實際值 phys = physMin + (dig − digMin) × (physMax − physMin) / (digMax − digMin)
//
// 本檔只做「位元組 → 結構與數值」，不含任何 CPAP 語意（日期歸屬、哨兵
// 的業務意義、聚合規則都在 adapter 層）。設計上可被其他 EDF 來源重用。

// 註：單檔讀入的大小上限不在本檔實施。本檔收到的已經是位元組陣列，
// 此時記憶體已經耗掉，再檢查也只是形式。上限 MUST 由讀檔的那一層
// （adapter 決定要不要把某個檔讀進來時）把關，見 tasks 3.1。

const HEADER_BYTES = 256;
const SIGNAL_HEADER_BYTES = 256;

export class EdfFormatError extends Error {}

const ascii = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

// EDF header 全為 ASCII 固定寬度欄位，右側以空白填充
function field(bytes, offset, len) {
  return ascii(bytes.subarray(offset, offset + len)).trim();
}

function intField(bytes, offset, len, what) {
  const raw = field(bytes, offset, len);
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v)) throw new EdfFormatError(`EDF header 的 ${what} 非整數：${raw}`);
  return v;
}

function floatField(raw, what) {
  const v = Number.parseFloat(raw);
  if (!Number.isFinite(v)) throw new EdfFormatError(`EDF header 的 ${what} 非數值：${raw}`);
  return v;
}

// EDF 的 startdate 只有兩位年份。規格定義 85-99 為 19xx、00-84 為 20xx
// （EDF+ 另有完整年份放在 recording id，本專案不依賴它）。
export function expandYear(yy) {
  return yy >= 85 ? 1900 + yy : 2000 + yy;
}

// 解析固定頭與訊號頭。bytes 需涵蓋完整 header（256 + ns×256）。
export function parseHeader(bytes) {
  if (bytes.length < HEADER_BYTES) {
    throw new EdfFormatError(`EDF 檔過短：${bytes.length} 位元組，不足固定頭 256`);
  }
  const version = field(bytes, 0, 8);
  const startDateRaw = field(bytes, 168, 8);
  const startTimeRaw = field(bytes, 176, 8);
  const headerBytes = intField(bytes, 184, 8, "header 長度");
  const reserved = field(bytes, 192, 44);
  const recordCount = intField(bytes, 236, 8, "record 數");
  const recordDuration = floatField(field(bytes, 244, 8), "record 秒數");
  const signalCount = intField(bytes, 252, 4, "訊號數");
  if (signalCount <= 0) throw new EdfFormatError(`EDF 訊號數不合理：${signalCount}`);

  const need = HEADER_BYTES + signalCount * SIGNAL_HEADER_BYTES;
  if (bytes.length < need) {
    throw new EdfFormatError(
      `EDF 訊號頭不完整：需 ${need} 位元組，實得 ${bytes.length}`);
  }

  // 訊號頭是「同一欄位連續放 ns 份」的排列，不是逐訊號成組
  let pos = HEADER_BYTES;
  const take = (len) => {
    const out = [];
    for (let i = 0; i < signalCount; i += 1) {
      out.push(field(bytes, pos + i * len, len));
    }
    pos += signalCount * len;
    return out;
  };
  const labels = take(16);
  const transducers = take(80);
  const dims = take(8);
  const physMins = take(8);
  const physMaxs = take(8);
  const digMins = take(8);
  const digMaxs = take(8);
  const prefilters = take(80);
  const nsamps = take(8);

  const signals = labels.map((label, i) => ({
    index: i,
    label,
    transducer: transducers[i],
    dim: dims[i],
    physMin: floatField(physMins[i], `訊號 ${i} physMin`),
    physMax: floatField(physMaxs[i], `訊號 ${i} physMax`),
    digMin: floatField(digMins[i], `訊號 ${i} digMin`),
    digMax: floatField(digMaxs[i], `訊號 ${i} digMax`),
    prefilter: prefilters[i],
    nsamp: Number.parseInt(nsamps[i], 10),
  }));
  for (const s of signals) {
    if (!Number.isFinite(s.nsamp) || s.nsamp < 0) {
      throw new EdfFormatError(`訊號 ${s.index}（${s.label}）的 nsamp 不合理：${s.nsamp}`);
    }
  }

  const dm = startDateRaw.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  const tm = startTimeRaw.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!dm) throw new EdfFormatError(`EDF startdate 格式非 dd.mm.yy：${startDateRaw}`);
  if (!tm) throw new EdfFormatError(`EDF starttime 格式非 hh.mm.ss：${startTimeRaw}`);
  const start = {
    year: expandYear(Number(dm[3])),
    month: Number(dm[2]),
    day: Number(dm[1]),
    hour: Number(tm[1]),
    minute: Number(tm[2]),
    second: Number(tm[3]),
  };

  const bytesPerRecord = signals.reduce((a, s) => a + s.nsamp, 0) * 2;
  return {
    version, reserved, headerBytes, recordCount, recordDuration, signalCount,
    signals, start, bytesPerRecord,
    // EDF+D（不連續）以 annotation 訊號帶時間戳；EDF+C 與基本 EDF 為連續
    isAnnotationFile: signals.some(s => s.label === "EDF Annotations"),
  };
}

// header 起始時刻的本地時間字串（EDF 檔頭無時區資訊，沿用專案既有的
// 無時區本地字串慣例，同 apple_records.start_ts）
export function startISO(header) {
  const p = (n) => String(n).padStart(2, "0");
  const { year, month, day, hour, minute, second } = header.start;
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:${p(second)}`;
}

// 自 header 起始時刻起算 offsetSec 秒的本地時間字串。
// 用 Date 只為了處理跨日／跨月的日曆推進，不涉及時區轉換（以本地建構、
// 以本地欄位取回）。
export function offsetISO(header, offsetSec) {
  const { year, month, day, hour, minute, second } = header.start;
  const d = new Date(year, month - 1, day, hour, minute, second);
  d.setSeconds(d.getSeconds() + offsetSec);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 數位值 → 物理值。digMax == digMin 時無法縮放，回 physMin（不除以零）。
export function scaleValue(dig, sig) {
  const span = sig.digMax - sig.digMin;
  if (span === 0) return sig.physMin;
  return sig.physMin + (dig - sig.digMin) * (sig.physMax - sig.physMin) / span;
}

// 缺測哨兵判定：數位值低於 header 宣告的 digMin 即為無效
// （EDF 規格要求數位值落在 [digMin, digMax]，超出範圍者不是量測值）。
//
// 兩個都會造成資料錯誤的寫法，MUST 避免：
//  1. 用物理值比對（如 phys === -1）：各訊號縮放不同，同一個哨兵數位值
//     會縮放成 -1、-0.02、-0.1 等不同數字，必然漏判。
//  2. 用 dig === digMin 比對：實測來源以 -1 表示缺測，而 digMin 多半是 0
//     或正數，這個寫法會「漏掉全部缺測日」並「誤刪合法的 0 值」
//     （實測素材中有數百天的分項指數真的是 0、壓力欄真的等於 digMin）。
export function isSentinel(dig, sig) {
  return dig < sig.digMin;
}

// 依 label 找訊號（label 欄位僅 16 字元，長標籤會被來源截斷，故以檔案中
// 實際出現的字串比對）。找不到回 null，由呼叫端決定是否為必要欄位。
export function findSignal(header, label) {
  return header.signals.find(s => s.label === label) ?? null;
}

// 某訊號在指定 record 內的位元組起點（record 起點 ＋ 前序訊號的樣本長度）
function signalOffset(header, sig, recordIndex) {
  let offset = header.headerBytes + recordIndex * header.bytesPerRecord;
  for (const s of header.signals) {
    if (s.index === sig.index) break;
    offset += s.nsamp * 2;
  }
  return offset;
}

// 逐 record 取出某訊號的原始數位值。
// recordIndex 超出實際資料長度時回 null（截斷檔），由呼叫端記錄品質旗標。
export function readSignalRecord(bytes, header, sig, recordIndex) {
  const offset = signalOffset(header, sig, recordIndex);
  if (offset + sig.nsamp * 2 > bytes.length) return null;
  // byteOffset 未必是 2 的倍數，Int16Array 需對齊，故逐值以 DataView 讀
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, sig.nsamp * 2);
  const out = new Int16Array(sig.nsamp);
  for (let i = 0; i < sig.nsamp; i += 1) out[i] = view.getInt16(i * 2, true);
  return out;
}

// 實際可讀的 record 數：header 宣告值與資料區長度取小者。
// 兩者不符即為截斷檔，呼叫端 MUST 記錄品質旗標而非靜默截斷。
// EDF 規格允許 recordCount 為 -1（錄製中、筆數未知），此時只能以資料區
// 長度為準；直接取 min 會得 -1 而把整個檔案靜默當成零筆。
export function actualRecordCount(bytes, header) {
  if (header.bytesPerRecord <= 0) return 0;
  const avail = Math.max(0, bytes.length - header.headerBytes);
  const byData = Math.floor(avail / header.bytesPerRecord);
  return header.recordCount < 0 ? byData : Math.min(header.recordCount, byData);
}

// EDF+ annotation（TAL）解析。
// 一個 record 的 annotation 區內含多個 TAL，以 NUL 分隔並以 NUL 填充尾端。
// TAL 格式：onset[\x15duration]\x14label\x14...（每 record 首個 TAL 是
// 時間戳，label 為空）。
export function parseTAL(bytes) {
  const out = [];
  for (const chunk of ascii(bytes).split("\0")) {
    if (!chunk) continue;
    const parts = chunk.split("\x14");
    const [onsetRaw, durRaw] = parts[0].split("\x15");
    const onset = Number.parseFloat(onsetRaw);
    if (!Number.isFinite(onset)) continue;
    const duration = durRaw === undefined || durRaw === ""
      ? null : Number.parseFloat(durRaw);
    const labels = parts.slice(1).map(s => s.trim()).filter(Boolean);
    out.push({
      onset,
      duration: Number.isFinite(duration) ? duration : null,
      labels,
      // 首個 TAL（label 為空）是該 record 的時間戳，不是事件
      isTimekeeping: labels.length === 0,
    });
  }
  return out;
}

// 整檔 annotation 事件（跨全部 record），已排除時間戳 TAL。
export function readAnnotations(bytes, header) {
  const sig = findSignal(header, "EDF Annotations");
  if (!sig) return [];
  const total = actualRecordCount(bytes, header);
  const out = [];
  for (let r = 0; r < total; r += 1) {
    // annotation 區是位元組導向的文字而非數值，故取位元組視圖而不走
    // readSignalRecord（後者會把它當 int16 解讀）
    const offset = signalOffset(header, sig, r);
    if (offset + sig.nsamp * 2 > bytes.length) break;
    const slice = bytes.subarray(offset, offset + sig.nsamp * 2);
    for (const tal of parseTAL(slice)) {
      if (tal.isTimekeeping) continue;
      for (const label of tal.labels) {
        out.push({ onset: tal.onset, duration: tal.duration, label, record: r });
      }
    }
  }
  return out;
}
