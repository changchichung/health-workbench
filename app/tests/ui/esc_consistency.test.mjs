// esc/escapeHtml 一致性守衛（2026-08-11 紅隊邊界審查發現：屬性位置
// 插值若用不轉義雙引號的 esc 會逃逸屬性）。ui 各模組的 HTML 轉義
// 函式 MUST 至少涵蓋 & < > " 四者，保持一致，杜絕未來在屬性位置
// 新增插值時的注入回歸。純原始碼掃描，不需 export 或 DOM。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const UI_DIR = new URL("../../src/ui/", import.meta.url);
const REQUIRED = ["&amp;", "&lt;", "&gt;", "&quot;"];

test("ui 各模組的 esc/escapeHtml 皆涵蓋 & < > \" 轉義", () => {
  const gaps = [];
  for (const f of readdirSync(UI_DIR).filter(f => f.endsWith(".js"))) {
    const src = readFileSync(new URL(f, UI_DIR), "utf-8");
    // 抓 esc/escapeHtml 定義的整段（箭頭或 function，到分號或右括號結束）
    for (const m of src.matchAll(
      /(?:const\s+esc\s*=\s*\(s\)\s*=>|function\s+escapeHtml\s*\(s\)\s*\{)([\s\S]{0,240}?)(?:;\s*\n|\n\})/g)) {
      const body = m[0];
      const missing = REQUIRED.filter(e => !body.includes(e));
      if (missing.length) gaps.push(`${f}: 缺 ${missing.join(",")}`);
    }
  }
  assert.deepEqual(gaps, [], `HTML 轉義不完整：\n${gaps.join("\n")}`);
});
