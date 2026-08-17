// 最小 zip 寫入器（EPUB 容器用）。專案零建置、零第三方相依，故自寫。
// 讀取端在 engine/bytesource.js（解 Apple 匯出 zip），本檔是寫入端。
//
// 只實作 EPUB 需要的子集：無資料夾項目、無 zip64、無加密、無檔案註解。
// 時間戳固定為 1980-01-01（DOS 時間原點），理由是相同輸入要產生相同位元組：
// 匯出兩次得到不同檔案會讓「內容沒變」無法用雜湊驗證，測試也不可重現。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// deflate-raw 壓縮。CompressionStream 是 DecompressionStream 的同批 API
// （bytesource.js 已在實機用過解壓側）；不可用時由呼叫端退回 store。
export async function deflateRaw(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  // 不能 await 這兩步：資料大於內部佇列時，write 要等有人讀才 resolve，
  // 而讀取在下面才開始。改為留住 promise，讀完再 await，讓錯誤照樣拋出。
  const written = (async () => { await writer.write(bytes); await writer.close(); })();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await written;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export function hasCompressionStream() {
  return typeof CompressionStream === "function";
}

const DOS_TIME = 0;      // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01（day 與 month 不得為 0，故非 0x0000）

// entries: [{ name: string, data: Uint8Array, store?: boolean }]
// store=true 者強制不壓縮（EPUB 規定 mimetype 必須如此）。
// 其餘項目在 CompressionStream 可用時走 deflate，否則整包退回 store。
export async function createZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const canDeflate = hasCompressionStream();

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const raw = e.data;
    let method = 0;
    let body = raw;
    if (!e.store && canDeflate && raw.length > 0) {
      const z = await deflateRaw(raw);
      // 壓不小就別壓（小檔常見）：省下解壓成本也避免體積反增
      if (z.length < raw.length) { method = 8; body = z; }
    }
    const crc = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, method === 8 ? 20 : 10, true); // version needed
    lv.setUint16(6, 0, true);                      // flags（檔名全 ASCII，免 UTF-8 旗標）
    lv.setUint16(8, method, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);                     // extra length（mimetype 必須為 0）
    local.set(nameBytes, 30);
    parts.push(local, body);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);                     // version made by
    cv.setUint16(6, method === 8 ? 20 : 10, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);                     // extra
    cv.setUint16(32, 0, true);                     // comment
    cv.setUint16(34, 0, true);                     // disk number start
    cv.setUint16(36, 0, true);                     // internal attrs
    cv.setUint32(38, 0, true);                     // external attrs
    cv.setUint32(42, offset, true);                // local header offset
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + body.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const all = [...parts, ...central, eocd];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of all) { out.set(part, p); p += part.length; }
  return out;
}
