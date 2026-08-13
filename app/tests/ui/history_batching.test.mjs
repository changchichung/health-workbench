// App 匯入紀錄卡的批次分組純函式（change viewer-and-history-refinement D7）。
// 同一組向量另在 sleep_render.test.mjs 餵給檢視層真渲染，兩邊語意必須一致。
import test from "node:test";
import assert from "node:assert/strict";
import { groupDocsByBatch, buildBatchRescuePreviewModel }
  from "../../src/ui/history.js";
import { BATCH_DOCS, EXPECTED_BATCHES } from "../helpers/batch_vector.mjs";

test("批次分組：同 adapter ＋同 imported_at 為一批，組內維持傳入順序", () => {
  const got = groupDocsByBatch(BATCH_DOCS);
  assert.equal(got.length, EXPECTED_BATCHES.length,
    `分成 ${got.length} 批，期望 ${EXPECTED_BATCHES.length} 批`);
  assert.deepEqual(got.map(g => `${g.adapter}|${g.importedAt}`),
    EXPECTED_BATCHES.map(b => b.key), "批次的 key 與出現順序");
  got.forEach((g, i) => {
    assert.deepEqual(g.docs.map(d => d.filename), EXPECTED_BATCHES[i].filenames,
      `第 ${i + 1} 批的檔名序列（組內順序＝傳入順序）`);
  });
});

test("批次分組：統計為組內合計，缺統計的批標記出來而不是算成 0", () => {
  const got = groupDocsByBatch(BATCH_DOCS);
  got.forEach((g, i) => {
    const want = EXPECTED_BATCHES[i];
    assert.deepEqual(g.inserted, want.inserted, `第 ${i + 1} 批的 inserted 合計`);
    assert.equal(g.dupTotal, want.dupTotal, `第 ${i + 1} 批的重複略過合計`);
    assert.equal(g.missingStats, want.missingStats,
      `第 ${i + 1} 批的缺統計標記——缺統計必須看得出來，不能顯示成新增 0 筆`);
  });
});

test("批次分組：同 adapter 不同匯入時刻不得合併", () => {
  const got = groupDocsByBatch(BATCH_DOCS);
  const resmed = got.filter(g => g.adapter === "resmed_edf");
  assert.equal(resmed.length, 2,
    "兩次 CPAP 匯入是兩批：批次 key 若只用 adapter 會錯誤合併");
  assert.deepEqual(resmed.map(g => g.docs.length), [3, 2]);
});

test("批次分組：壞掉的 import_stats 不讓整批爆掉", () => {
  const got = groupDocsByBatch([
    { id: 1, filename: "a.edf", adapter: "resmed_edf", imported_at: "T1",
      import_stats: "{不是 JSON" },
    { id: 2, filename: "b.edf", adapter: "resmed_edf", imported_at: "T1",
      import_stats: JSON.stringify({ inserted: { cpap_events: 7 } }) },
  ]);
  assert.equal(got.length, 1);
  assert.equal(got[0].missingStats, true, "壞 JSON 視為缺統計");
  assert.deepEqual(got[0].inserted, { cpap_events: 7 },
    "同批其他檔的統計仍要算進來");
});

test("批次分組：空輸入與 null 輸入回空陣列", () => {
  assert.deepEqual(groupDocsByBatch([]), []);
  assert.deepEqual(groupDocsByBatch(null), []);
});

// 批次確認面板模型（T3.5）：形狀與單檔版相同，面板渲染共用

const batchPreview = (over = {}) => ({
  docCount: 41,
  filenames: ["STR.edf"],
  adapter: "resmed_edf",
  importedAt: "2026-08-13 02:50:12",
  profileId: 1,
  displayName: "本人",
  counts: { cpap_daily: 259, cpap_events: 286, cpap_oximetry: 0 },
  overlapWarning: false,
  merge: null,
  nhiGuard: null,
  ...over,
});

test("批次面板：剔除整批的摘要含檔案數與各表合計，0 筆的表不列", () => {
  const m = buildBatchRescuePreviewModel(batchPreview(), { mode: "batch-delete" });
  assert.match(m.summary, /這批 41 個來源檔案/);
  assert.match(m.summary, /可重新匯入/);
  assert.equal(m.countsText, "睡眠每日摘要 259、呼吸事件 286",
    "0 筆的睡眠血氧不該出現在確認文字裡");
  assert.equal(m.confirmDisabled, false);
  assert.equal(m.warning, null);
});

test("批次面板：改歸屬未選成員時不可確認，選了才給搬移筆數", () => {
  const noTarget = buildBatchRescuePreviewModel(batchPreview(),
    { mode: "batch-reattribute" });
  assert.equal(noTarget.confirmDisabled, true, "未選目標成員不得可按");
  assert.equal(noTarget.mergeText, null);

  const withTarget = buildBatchRescuePreviewModel(
    batchPreview({ merge: { total: 5 } }),
    { mode: "batch-reattribute", targetName: "媽媽" });
  assert.equal(withTarget.confirmDisabled, false);
  assert.match(withTarget.mergeText, /搬移 540 筆/, "545 − 5 = 540");
  assert.match(withTarget.mergeText, /重複合併 5 筆/);
});

test("批次面板：重疊警告與健保護欄阻擋", () => {
  const warned = buildBatchRescuePreviewModel(
    batchPreview({ overlapWarning: true }), { mode: "batch-delete" });
  assert.match(warned.warning, /這批檔案/);

  const blocked = buildBatchRescuePreviewModel(
    batchPreview({ nhiGuard: { blocked: true, reason: "身分不符" } }),
    { mode: "batch-reattribute", targetName: "媽媽" });
  assert.equal(blocked.confirmDisabled, true);
  assert.equal(blocked.blockReason, "身分不符");
});
