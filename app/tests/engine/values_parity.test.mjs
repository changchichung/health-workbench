import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pyFloat, toNum, normDate } from "../../src/engine/values.js";

// 差分：同一組輸入丟給 Python 的 float()/to_num()/norm_date 實跑對照
const CASES = ["12abc", "1.5", " 1.5 ", "-3", "+7", "1e5", "1.5e3", ".5", "5.",
  "", " ", "abc", "0", "007", "1,000", "1_000", "３", "12.3.4", "-.5", "1.0", "１．５", "１２", "1_0.5",
  "20260101", "202601", "2026", "  20260101  ", "no"];

function pyResults() {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from src.adapters.nhi_json import to_num, norm_date",
    `cases = json.loads(sys.argv[1])`,
    "def pyf(s):",
    "    try:",
    "        v = float(s)",
    "        return v if v == v and v not in (float('inf'), float('-inf')) else None",
    "    except (TypeError, ValueError):",
    "        return None",
    "print(json.dumps([[pyf(c), to_num(c), norm_date(c)] for c in cases]))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify(CASES)],
    { cwd: new URL("../../..", import.meta.url).pathname, encoding: "utf-8" }));
}

test("數值與日期契約：JS 與 Python 全組輸入等價", () => {
  const py = pyResults();
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    assert.deepEqual(
      [pyFloat(c), toNum(c), normDate(c)],
      py[i],
      `輸入 ${JSON.stringify(c)}：JS=${JSON.stringify([pyFloat(c), toNum(c), normDate(c)])} Python=${JSON.stringify(py[i])}`);
  }
});

test("parseFloat 前綴寬鬆被禁用（spec 畸形數值契約）", () => {
  assert.equal(pyFloat("12abc"), null);
  assert.equal(toNum("12abc"), null);
});
