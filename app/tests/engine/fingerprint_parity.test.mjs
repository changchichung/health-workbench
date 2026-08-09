import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { canonicalJson, recordFp } from "../../src/engine/fingerprint.js";

const REPO = new URL("../../..", import.meta.url).pathname;

// 棘手案例：空值/空白折疊/雙引號置換/巢狀清單排序/unicode/數字型別
const TRICKY = [
  { a: null, b: "" },
  { z: "  多  空白\n換行  ", a: '他說"好"' },
  { list: [{ b: 2, a: 1 }, { a: 1, b: 1 }, "x", "a"] },
  { n: 3, f: 3.5, neg: -0.25, big: 123456789 },
  { 中文鍵: "中文值", mixed: ["乙", "甲", { 丙: null }] },
  { nested: { deep: [[2, 1], [1, 2]] } },
];

function pyBatch(records) {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from src.store.fingerprint import canonical_json, record_fp",
    "records = json.loads(sys.stdin.read())",
    "print(json.dumps([[canonical_json(r), record_fp(r)] for r in records]))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", script],
    { cwd: REPO, encoding: "utf-8", input: JSON.stringify(records) }));
}

test("fingerprint 差分：棘手案例 canonical 與 fp 全等", async () => {
  const py = pyBatch(TRICKY);
  for (let i = 0; i < TRICKY.length; i++) {
    assert.equal(canonicalJson(TRICKY[i]), py[i][0], `canonical 案例 ${i}`);
    assert.equal(await recordFp(TRICKY[i]), py[i][1], `fp 案例 ${i}`);
  }
});

test("fingerprint 差分：nhi fixture 全部紀錄 fp 全等", async () => {
  const data = JSON.parse(readFileSync(`${REPO}/tests/fixtures/nhi_sample.json`, "utf-8"));
  const records = [];
  for (const rows of Object.values(data.myhealthbank.bdata)) {
    if (Array.isArray(rows)) records.push(...rows.filter(r => typeof r === "object"));
  }
  assert.ok(records.length >= 10, `fixture 紀錄數 ${records.length} 太少`);
  const py = pyBatch(records);
  for (let i = 0; i < records.length; i++) {
    assert.equal(await recordFp(records[i]), py[i][1], `fixture 紀錄 ${i}`);
  }
});
