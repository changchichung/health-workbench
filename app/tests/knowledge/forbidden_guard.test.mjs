import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { FORBIDDEN_WORDS, checkText } from "../../src/knowledge/forbidden.js";

const REPO = new URL("../../..", import.meta.url).pathname;
const APP_SRC = path.join(REPO, "app/src");

test("禁用詞清單與 SSOT（src/knowledge/forbidden.py）同步", () => {
  const py = readFileSync(path.join(REPO, "src/knowledge/forbidden.py"), "utf-8");
  const block = py.match(/FORBIDDEN_WORDS = \[([\s\S]*?)\]/)[1];
  const pyWords = [...block.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(FORBIDDEN_WORDS, pyWords);
});

test("app/ 前端文案無禁用詞（引擎/知識模組全掃）", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|json)$/.test(name)) files.push(p);
    }
  };
  walk(APP_SRC);
  assert.ok(files.length >= 15, `掃描檔數 ${files.length} 異常偏少`);
  const violations = [];
  for (const f of files) {
    // forbidden.js 本身定義清單，跳過
    if (f.endsWith("knowledge/forbidden.js")) continue;
    const hits = checkText(readFileSync(f, "utf-8"));
    if (hits.length) violations.push([path.relative(REPO, f), hits]);
  }
  assert.deepEqual(violations, []);
});

test("出貨文案無禁用詞（DMG 與 Windows 使用說明）", () => {
  const violations = [];
  for (const rel of ["packaging/dmg-readme.txt", "packaging/windows-readme.txt"]) {
    const text = readFileSync(path.join(REPO, rel), "utf-8");
    assert.ok(text.length > 500, `${rel} 內容異常偏少`);
    const hits = checkText(text);
    if (hits.length) violations.push([rel, hits]);
  }
  assert.deepEqual(violations, []);
});

// 雙份 app.js 同步守衛：App 內檢視與 Python rebuild 產出的單檔 HTML 各用
// 一份，改了一份忘了另一份不會有任何錯誤，只會讓兩條路徑靜默分歧。
test("兩份 app.js 逐位元組相同（App 檢視層與匯出層）", () => {
  const a = readFileSync(path.join(REPO, "app/src/viewer/assets/app.js"), "utf-8");
  const b = readFileSync(path.join(REPO, "src/dashboard/app.js"), "utf-8");
  assert.equal(a, b,
    "app/src/viewer/assets/app.js 與 src/dashboard/app.js 不一致，請同步");
});

test("出貨文案與檢視層文案：CPAP 指標只顯示不解讀", () => {
  // 禁用詞清單擋的是既有的判定性措辭。這裡另外確認 CPAP 相關文案沒有
  // 引入新的解讀性用語（嚴重度、是否達標、要不要就醫等）。
  const app = readFileSync(path.join(REPO, "app/src/viewer/assets/app.js"), "utf-8");
  const INTERPRETIVE = ["偏高", "偏低", "過高", "過低", "嚴重", "輕微", "達標",
    "未達標", "需就醫", "建議就醫", "控制良好", "控制不佳", "正常範圍"];
  const hits = INTERPRETIVE.filter(w => app.includes(w));
  assert.deepEqual(hits, [], `檢視層出現解讀性用語：${hits.join("、")}`);
});
