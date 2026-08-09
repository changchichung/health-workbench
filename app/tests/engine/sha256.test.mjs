import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Sha256 } from "../../src/engine/sha256.js";

test("標準向量", () => {
  assert.equal(new Sha256().update(new Uint8Array(0)).hex(),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(new Sha256().update(new TextEncoder().encode("abc")).hex(),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("分塊餵入與整段餵入等價（含跨 64-byte 邊界）", () => {
  const data = randomBytes(1_000_003);
  const whole = new Sha256().update(new Uint8Array(data)).hex();
  const chunked = new Sha256();
  for (let off = 0; off < data.length;) {
    const n = Math.min(1 + (off % 4097), data.length - off);
    chunked.update(new Uint8Array(data.subarray(off, off + n)));
    off += n;
  }
  assert.equal(chunked.hex(), whole);
  assert.equal(whole, createHash("sha256").update(data).digest("hex"));
});

test("55/56/64/119/120 邊界長度全對（padding 分支覆蓋）", () => {
  for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 121]) {
    const data = randomBytes(n);
    assert.equal(new Sha256().update(new Uint8Array(data)).hex(),
      createHash("sha256").update(data).digest("hex"), `長度 ${n}`);
  }
});
