// zip 串流路徑 spike：純 JS 讀 zip 結構 + DecompressionStream('deflate-raw')
// 串流解壓，邊解邊餵解析器。這是 App 端（WebView）會用的同一套 Web API。
import { open } from "node:fs/promises";

async function main(path) {
  const fh = await open(path, "r");
  const { size } = await fh.stat();

  // 1. 找 End of Central Directory（檔尾 64KB 內掃 signature 0x06054b50）
  const tailLen = Math.min(65558, size);
  const tail = new Uint8Array(tailLen);
  await fh.read(tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("找不到 EOCD");
  const dv = new DataView(tail.buffer);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const cdSize = dv.getUint32(eocd + 12, true);

  // 2. 讀 central directory，取第一個 .xml 成員（略過 cda）
  const cd = new Uint8Array(cdSize);
  await fh.read(cd, 0, cdSize, cdOffset);
  const cdv = new DataView(cd.buffer);
  let p = 0, member = null;
  while (p + 46 <= cdSize && cdv.getUint32(p, true) === 0x02014b50) {
    const method = cdv.getUint16(p + 10, true);
    const compSize = cdv.getUint32(p + 20, true);
    const nameLen = cdv.getUint16(p + 28, true);
    const extraLen = cdv.getUint16(p + 30, true);
    const cmtLen = cdv.getUint16(p + 32, true);
    const lho = cdv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    if (name.toLowerCase().endsWith(".xml") && !name.toLowerCase().includes("cda"))
      member = { name, method, compSize, lho };
    p += 46 + nameLen + extraLen + cmtLen;
    if (member) break;
  }
  if (!member) throw new Error("zip 內找不到 XML 成員");
  if (member.method !== 8) throw new Error(`非 deflate 壓縮：method=${member.method}`);

  // 3. local header 定位資料起點
  const lh = new Uint8Array(30);
  await fh.read(lh, 0, 30, member.lho);
  const ldv = new DataView(lh.buffer);
  const dataStart = member.lho + 30 + ldv.getUint16(26, true) + ldv.getUint16(28, true);

  // 4. 壓縮位元組分塊 → DecompressionStream('deflate-raw') → 計量
  const t0 = performance.now();
  const CHUNK = 4 * 1024 * 1024;
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  let inflated = 0, chunks = 0;
  const reader = (async () => {
    const r = ds.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      inflated += value.length; chunks++;
      // 此處即餵給 parse_spike 的 scan()；spike 只計量不重複解析
    }
  })();
  for (let off = 0; off < member.compSize; ) {
    const n = Math.min(CHUNK, member.compSize - off);
    const buf = new Uint8Array(n);
    await fh.read(buf, 0, n, dataStart + off);
    await writer.write(buf);
    off += n;
  }
  await writer.close();
  await reader;
  await fh.close();
  const secs = (performance.now() - t0) / 1000;
  console.log(JSON.stringify({
    member: member.name, zip_mb: +(size / 1048576).toFixed(1),
    inflated_mb: +(inflated / 1048576).toFixed(1), seconds: +secs.toFixed(2),
    inflate_mb_per_s: +(inflated / 1048576 / secs).toFixed(1),
    stream_chunks: chunks, peak_rss_mb: Math.round(process.memoryUsage().rss / 1048576),
  }, null, 1));
}

main(process.argv[2]);
