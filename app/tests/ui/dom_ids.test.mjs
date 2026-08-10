// DOM id 一致性守衛：ui 模組中 getElementById 的靜態目標必須存在於
// index.html（動態 innerHTML 建立的 id 列白名單）。UI 改版最常見的
// 斷線（改了 HTML 忘了 JS、或反之）在 CI 就攔下。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const UI_DIR = new URL("../../src/ui/", import.meta.url);
const HTML = readFileSync(new URL("../../src/index.html", import.meta.url), "utf-8");

// 由 JS 以 innerHTML／createElement 動態建立、不在 index.html 的 id
const DYNAMIC_IDS = new Set([
  "import-go", "import-cancel", "goto-viewer-btn",
  "import-profile-select", "import-new-member", "import-new-name", "import-new-go",
  "pm-msg", "pm-new-name", "pm-add-btn", "pm-inline", "pm-close",
  "pm-rename-name", "pm-rename-go", "pm-rename-cancel",
  "pm-del-name", "pm-del-go", "pm-del-cancel",
]);

test("ui 模組的 getElementById 目標都在 index.html 或動態白名單", () => {
  const missing = [];
  for (const f of readdirSync(UI_DIR).filter(f => f.endsWith(".js"))) {
    const src = readFileSync(new URL(f, UI_DIR), "utf-8");
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) {
      const id = m[1];
      if (DYNAMIC_IDS.has(id)) continue;
      if (!HTML.includes(`id="${id}"`)) missing.push(`${f}: #${id}`);
    }
    // 模板字串形式 getElementById(`tab-${t}`) 等：驗證兩個分頁 id 存在
    if (src.includes("getElementById(`tab-")) {
      for (const id of ["tab-import", "tab-viewer", "tab-btn-import", "tab-btn-viewer"]) {
        if (!HTML.includes(`id="${id}"`)) missing.push(`${f}: #${id}（模板）`);
      }
    }
  }
  assert.deepEqual(missing, [], `index.html 缺少 id：\n${missing.join("\n")}`);
});

test("動態白名單反向檢查：白名單 id 確實出現在某個 ui 模組的模板字串中", () => {
  const all = readdirSync(UI_DIR).filter(f => f.endsWith(".js"))
    .map(f => readFileSync(new URL(f, UI_DIR), "utf-8")).join("\n");
  // 兩種動態建法都算：模板字串 id="x"、或 createElement 後 .id = "x" 賦值
  const stale = [...DYNAMIC_IDS].filter(id =>
    !all.includes(`id="${id}"`) && !all.includes(`id = "${id}"`));
  assert.deepEqual(stale, [], `白名單過期（模板中已不存在）：${stale.join("、")}`);
});
