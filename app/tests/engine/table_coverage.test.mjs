// 表清單對帳（change viewer-and-history-refinement）。
//
// 為什麼需要這個：CPAP change 新增三張資料表，卻沒有接上任何「以表清單列舉」
// 的既有機制。2026-08-13 實測後果——刪除 CPAP 來源檔與刪除含 CPAP 資料的成員
// 都 FOREIGN KEY constraint failed（cpap_*.doc_id 指向 source_documents），
// 改歸屬則把資料留在原成員卻回報「搬移 0 筆」，看起來像成功。
//
// 補值不能防再犯（同一輪已經在紀錄頁踩過「四處補了、第五處沒補」），所以把
// 「清單要跟上 schema」變成機器可驗：新增資料表而漏接任何一處，這裡就轉紅。
import test from "node:test";
import assert from "node:assert/strict";
import { DDL } from "../../src/store/schema.js";
import { DOC_DATA_TABLES } from "../../src/engine/doc_rescue.js";
import { PROFILE_DATA_TABLES } from "../../src/engine/profiles.js";
import { QUALITY_FLAG_TABLES } from "../../src/engine/store.js";

// 非「成員資料」的表：profiles 本身、來源紀錄（各清單另行處理）、schema 版本
const META_TABLES = new Set(["profiles", "schema_version", "source_documents"]);

function ddlDataTables() {
  const all = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
  // 護欄：解析式失效時 all 會是空陣列，下面每條 filter 都會回空陣列而假綠
  assert.ok(all.length >= 15, `DDL 只解析到 ${all.length} 張表，解析式可能已失效`);
  return all.filter(t => !META_TABLES.has(t));
}

test("DOC_DATA_TABLES 涵蓋 DDL 的每一張資料表", () => {
  const missing = ddlDataTables().filter(t => !DOC_DATA_TABLES.includes(t));
  assert.deepEqual(missing, [],
    "漏掉的表在刪除來源檔時不會被清除；若該表的 doc_id 有 FK，刪除會直接失敗");
});

test("PROFILE_DATA_TABLES 涵蓋 DDL 的每一張資料表", () => {
  const missing = ddlDataTables().filter(t => !PROFILE_DATA_TABLES.includes(t));
  assert.deepEqual(missing, [],
    "漏掉的表在刪除成員時不會被清除；若該表的 doc_id 有 FK，刪除成員會直接失敗");
});

test("PROFILE_DATA_TABLES 的 source_documents 必須排在所有引用它的表之後", () => {
  const idx = PROFILE_DATA_TABLES.indexOf("source_documents");
  assert.ok(idx >= 0, "成員刪除必須連帶刪除來源紀錄");
  assert.equal(idx, PROFILE_DATA_TABLES.length - 1,
    "cpap_*／encounters 等的 doc_id 指向 source_documents，它必須最後刪");
});

// 以「欄位」對帳（2026-08-14）：有 quality_flags 欄位卻不在掃描清單的表，
// 其旗標永遠不會出現在品質報告上，而匯入卡照樣顯示「品質旗標：無」，看起來
// 像這批資料很乾淨。實測當時漏了 apple_workouts 與 CPAP 三表。
function ddlTablesWithQualityFlags() {
  const blocks = [...DDL.matchAll(
    /CREATE TABLE IF NOT EXISTS (\w+)\(([\s\S]*?)\);/g)];
  assert.ok(blocks.length >= 15,
    `DDL 只解析到 ${blocks.length} 個建表語句，解析式可能已失效`);
  const out = blocks.filter(m => /\bquality_flags\b/.test(m[2])).map(m => m[1]);
  assert.ok(out.length >= 12,
    `只解析到 ${out.length} 張帶 quality_flags 的表，解析式可能已失效`);
  return out;
}

test("QUALITY_FLAG_TABLES 涵蓋 DDL 中每一張帶 quality_flags 的表", () => {
  const missing = ddlTablesWithQualityFlags()
    .filter(t => !QUALITY_FLAG_TABLES.includes(t));
  assert.deepEqual(missing, [],
    "漏掉的表其品質旗標不會被統計，報告會顯示成「無」而不是漏報");
});

test("QUALITY_FLAG_TABLES 不得列出沒有 quality_flags 欄位的表", () => {
  const withFlags = ddlTablesWithQualityFlags();
  assert.deepEqual(QUALITY_FLAG_TABLES.filter(t => !withFlags.includes(t)), [],
    "清單中的表若無該欄位，統計查詢會直接拋錯");
});

test("兩份清單不得列出 DDL 沒有的表（查詢會直接拋錯）", () => {
  const all = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
  for (const [name, list] of [["DOC_DATA_TABLES", DOC_DATA_TABLES],
    ["PROFILE_DATA_TABLES", PROFILE_DATA_TABLES]]) {
    assert.deepEqual(list.filter(t => !all.includes(t)), [], `${name} 有幽靈表名`);
  }
});
