// 匯入紀錄卡分組純函式（design D3 視角劃分：紀錄卡＝全庫依成員分組）
import test from "node:test";
import assert from "node:assert/strict";
import { groupDocsByProfile, COUNT_TABLES, RESCUE_TABLE_LABELS,
  ADAPTER_LABELS } from "../../src/ui/history.js";
import { DDL } from "../../src/store/schema.js";
import { registry } from "../../src/adapters/index.js";

test("依成員 id 升冪分組，組內維持傳入順序（時間新→舊）", () => {
  const docs = [
    { profile_id: 2, profile_name: "媽媽", filename: "m2.json", imported_at: "2026-08-10" },
    { profile_id: 1, profile_name: "本人", filename: "a2.json", imported_at: "2026-08-09" },
    { profile_id: 2, profile_name: "媽媽", filename: "m1.json", imported_at: "2026-08-08" },
    { profile_id: 1, profile_name: "本人", filename: "a1.json", imported_at: "2026-08-07" },
  ];
  const groups = groupDocsByProfile(docs);
  assert.deepEqual(groups.map(g => g.profileName), ["本人", "媽媽"]);
  assert.deepEqual(groups[0].docs.map(d => d.filename), ["a2.json", "a1.json"]);
  assert.deepEqual(groups[1].docs.map(d => d.filename), ["m2.json", "m1.json"]);
});

test("空清單→空分組；單成員→單組", () => {
  assert.deepEqual(groupDocsByProfile([]), []);
  const one = groupDocsByProfile([
    { profile_id: 5, profile_name: "本人", filename: "x.json" }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].docs.length, 1);
});

// 紀錄頁清單的對帳（2026-08-13 實機走查）：新增 CPAP 能力時 payload、store、
// viewer、Python 四處表清單都補了，紀錄頁的三處清單全漏。補值不能防再犯，
// 以下兩條把「清單要跟上 schema／registry」變成機器可驗。

const META_TABLES = new Set(["profiles", "source_documents", "schema_version"]);

test("全部資料統計：涵蓋 DDL 的每一張資料表，且都有中文標籤", () => {
  const ddlTables = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
  // 護欄：解析式失效時 ddlTables 會是空陣列，下面每條斷言都會假綠
  assert.ok(ddlTables.length >= 15,
    `DDL 只解析到 ${ddlTables.length} 張表，解析式可能已失效`);
  assert.deepEqual(ddlTables.filter(t => !META_TABLES.has(t) && !COUNT_TABLES.includes(t)),
    [], "schema 新增資料表就要同步加進 COUNT_TABLES，否則畫面上那行不算它");
  assert.deepEqual(COUNT_TABLES.filter(t => !RESCUE_TABLE_LABELS[t]),
    [], "每張表都要有中文標籤，否則顯示原始表名");
  assert.deepEqual(COUNT_TABLES.filter(t => !ddlTables.includes(t)),
    [], "不得列出 schema 沒有的表：count 查詢會直接拋錯");
});

test("格式標籤：涵蓋 registry 註冊的每個 adapter", () => {
  assert.deepEqual(registry.list().map(a => a.id).filter(id => !ADAPTER_LABELS[id]),
    [], "新增 adapter 要同步加標籤，否則紀錄頁的格式欄顯示原始 id");
});
