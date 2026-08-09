import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runParity, REPO } from "./harness.mjs";

const NHI = `${REPO}/tests/fixtures/nhi_sample.json`;
const APPLE = `${REPO}/tests/fixtures/apple_sample.xml`;

test("parity：nhi fixture 單檔全表全等＋報告全等", async () => {
  const { dbDiffs, reportDiffs } = await runParity(
    [NHI], mkdtempSync(path.join(tmpdir(), "mhb-par1-")));
  assert.deepEqual(dbDiffs, []);
  assert.deepEqual(reportDiffs, []);
});

test("parity：apple fixture 單檔全表全等＋報告全等", async () => {
  const { dbDiffs, reportDiffs } = await runParity(
    [APPLE], mkdtempSync(path.join(tmpdir(), "mhb-par2-")));
  assert.deepEqual(dbDiffs, []);
  assert.deepEqual(reportDiffs, []);
});

test("parity：nhi＋apple 依序匯入同一庫（每月例行形態）全等", async () => {
  const { dbDiffs, reportDiffs } = await runParity(
    [NHI, APPLE], mkdtempSync(path.join(tmpdir(), "mhb-par3-")));
  assert.deepEqual(dbDiffs, []);
  assert.deepEqual(reportDiffs, []);
});

test("parity：同檔重複匯入（冪等跳過）後仍全等", async () => {
  // 第二次匯入同檔：兩實作皆以 SHA-256 跳過且不產報告，庫零變化
  const { dbDiffs, reportDiffs } = await runParity(
    [NHI, NHI, APPLE, APPLE], mkdtempSync(path.join(tmpdir(), "mhb-par4-")));
  assert.deepEqual(dbDiffs, []);
  assert.deepEqual(reportDiffs, []);
});
