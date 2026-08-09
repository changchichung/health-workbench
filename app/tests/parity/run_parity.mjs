#!/usr/bin/env node
// 差分對帳 CLI（design Implementation Contract）：
//   node tests/parity/run_parity.mjs <工作目錄> <輸入檔...>
// 同組輸入經 Python 與 JS 各建新庫，全表 dump diff＋報告比對；
// 任一 diff 非空 → exit 1。真實資料演練（task 3.2）用，個資不落出工作目錄。
import { mkdirSync } from "node:fs";
import { runParity } from "./harness.mjs";

const [workDir, ...files] = process.argv.slice(2);
if (!workDir || files.length === 0) {
  console.error("用法：node tests/parity/run_parity.mjs <工作目錄> <輸入檔...>");
  process.exit(2);
}
mkdirSync(workDir, { recursive: true });
const t0 = performance.now();
const { dbDiffs, reportDiffs } = await runParity(files, workDir);
const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (dbDiffs.length || reportDiffs.length) {
  console.error(`FAIL（${secs}s）`);
  for (const d of [...dbDiffs, ...reportDiffs]) console.error("  " + d);
  process.exit(1);
}
console.log(`PASS（${secs}s）：${files.length} 檔，全表與報告全等`);
