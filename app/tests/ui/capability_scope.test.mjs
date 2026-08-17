// 權限宣告守衛（app-viewer spec「EPUB 匯出／寫檔路徑」）。
//
// 這一層擋的是「靜默放寬」與「靜默移除」：capabilities 改壞了不會有任何
// 測試轉紅，只會在實機上表現成「按了沒反應」或「權限開太大」，而 v0.6.0
// 的 fs scope 事故已經證明這種錯兩個方向都會發生（該擋的沒擋、該通的
// 通不了）。注意這裡驗的是宣告內容，不是 Rust 端的實際判定。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const CAP = JSON.parse(readFileSync(
  new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf-8"));

const entries = CAP.permissions.filter(p => typeof p === "object");
const byId = Object.fromEntries(entries.map(p => [p.identifier, p]));

test("寫入類權限必須明列 identifier（fs:default 不含任何寫入權限）", () => {
  // 文字（HTML 匯出、設定檔）與二進位（EPUB 是 zip）各一條，缺任一條
  // 對應的匯出在實機就會被拒
  for (const id of ["fs:allow-write-text-file", "fs:allow-write-file"]) {
    assert.ok(byId[id], `capabilities 缺 ${id}`);
  }
});

test("寫入類權限的允許路徑不得放寬為 **（實際位置由儲存對話框動態授權）", () => {
  for (const [id, p] of Object.entries(byId)) {
    if (!id.includes("write")) continue;
    const paths = p.allow.map(a => a.path);
    assert.deepEqual(paths, ["$APPDATA", "$APPDATA/**"],
      `${id} 的允許路徑被改動：${JSON.stringify(paths)}`);
    for (const path of paths) {
      assert.ok(!/^\*\*$/.test(path), `${id} 放寬成 ** 等於開放整台機器寫入`);
    }
  }
});

test("UI 不得使用原生 confirm／alert／prompt（會凍住 WebView 事件）", () => {
  const dir = new URL("../../src/ui/", import.meta.url);
  const hits = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith(".js"))) {
    const src = readFileSync(new URL(f, dir), "utf-8");
    src.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");           // 去掉行註解
      if (/(^|[^.\w])(window\.)?(confirm|alert|prompt)\s*\(/.test(code)) {
        hits.push(`${f}:${i + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(hits, [], `發現原生對話框呼叫：\n${hits.join("\n")}`);
});
