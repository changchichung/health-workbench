// CPAP 逐筆事件上限常數的孿生守衛（change viewer-and-history-refinement D1）。
//
// 為什麼 provider 同構測試不夠：它比對的是同一個庫產生的 payload 數值全等，
// 只有在資料量觸及「較小的那個上限」時，兩邊常數不同才會顯現差異。fixture
// 的資料量遠低於上限，所以 JS 寫 90 晚、Python 寫 60 晚會全綠通過。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CPAP_EVENT_NIGHTS, CPAP_EVENT_ROWS_CAP }
  from "../../src/provider/payload.js";

const REPO = new URL("../../..", import.meta.url).pathname;

test("CPAP 事件上限常數：payload.js 與 embed.py 同值", () => {
  const py = readFileSync(path.join(REPO, "src/dashboard/embed.py"), "utf-8");
  const found = {};
  for (const m of py.matchAll(/^(CPAP_EVENT_(?:NIGHTS|ROWS_CAP))\s*=\s*(\d+)/gm)) {
    found[m[1]] = Number(m[2]);
  }
  // 護欄：擋的是「兩邊同時改名」——那時 found 為空物件、import 進來的常數是
  // undefined，下面兩條會變成 undefined === undefined 而通過。單邊改名不需要
  // 這道護欄也會紅。
  assert.deepEqual(Object.keys(found).sort(),
    ["CPAP_EVENT_NIGHTS", "CPAP_EVENT_ROWS_CAP"],
    `embed.py 只解析到 ${JSON.stringify(found)}，解析式或常數名可能已變動`);
  assert.equal(found.CPAP_EVENT_NIGHTS, CPAP_EVENT_NIGHTS,
    "晚數上限兩邊必須同值，否則兩條路徑產出的 payload 在資料量大時會分歧");
  assert.equal(found.CPAP_EVENT_ROWS_CAP, CPAP_EVENT_ROWS_CAP,
    "筆數硬上限兩邊必須同值");
});

test("CPAP 事件上限：舊的按筆數常數已完全退場", () => {
  for (const rel of ["app/src/provider/payload.js", "src/dashboard/embed.py"]) {
    const text = readFileSync(path.join(REPO, rel), "utf-8");
    assert.ok(!/CPAP_EVENT_LIMIT/.test(text),
      `${rel} 仍有 CPAP_EVENT_LIMIT：按筆數切會落在某一晚中間而畫面看不出被截斷`);
  }
});
