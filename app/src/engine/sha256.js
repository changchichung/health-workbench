// 增量 SHA-256（純 JS）。WebCrypto subtle.digest 無串流介面，大檔（百 MB 量級+）
// 整檔進記憶體違反 app-import-engine spec 的分塊上限要求，故自備實作。
// 正確性：tests/engine/sha256.test.mjs 以標準向量＋Python hashlib 差分驗證。

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

export class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.bytesLo = 0; // 訊息長度（bytes），64-bit 以雙 32-bit 追蹤
    this.bytesHi = 0;
    this.w = new Uint32Array(64);
  }

  update(bytes) {
    const n = bytes.length;
    const newLo = (this.bytesLo + n) >>> 0;
    if (newLo < this.bytesLo) this.bytesHi = (this.bytesHi + 1) >>> 0;
    this.bytesLo = newLo;
    this.bytesHi = (this.bytesHi + Math.floor((this.bytesLo - newLo + n) / 0x100000000)) >>> 0;
    this._absorb(bytes);
    return this;
  }

  hex() {
    // 位元長度快照（padding 不再計入）
    const bitsLo = (this.bytesLo << 3) >>> 0;
    const bitsHi = ((this.bytesHi << 3) | (this.bytesLo >>> 29)) >>> 0;
    const rem = this.bufLen;
    const padLen = rem < 56 ? 56 - rem : 120 - rem;
    const tail = new Uint8Array(padLen + 8);
    tail[0] = 0x80;
    const dv = new DataView(tail.buffer);
    dv.setUint32(tail.length - 8, bitsHi);
    dv.setUint32(tail.length - 4, bitsLo);
    this._absorb(tail);
    return [...this.h].map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  _absorb(bytes) {
    const n = bytes.length;
    let off = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, n);
      this.buf.set(bytes.subarray(0, take), this.bufLen);
      this.bufLen += take;
      off = take;
      if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
    }
    while (off + 64 <= n) { this._block(bytes, off); off += 64; }
    if (off < n) { this.buf.set(bytes.subarray(off), 0); this.bufLen = n - off; }
  }

  _block(bytes, off) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
      off += 4;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
}
