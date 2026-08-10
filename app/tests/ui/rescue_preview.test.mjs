// 救援預覽面板資料組裝純函式（misattribution-rescue design D5；DOM 呈現
// 走實機走查，模型邏輯在此直測：阻擋態／警告態／合併文案／綁定提示）。
import test from "node:test";
import assert from "node:assert/strict";
import { buildRescuePreviewModel } from "../../src/ui/history.js";

const basePreview = (over = {}) => ({
  doc: { id: 7, profileId: 1, displayName: "媽媽", filename: "export.xml",
    adapter: "apple_health", importedAt: "2026-08-01 10:00:00" },
  counts: { encounters: 0, medications: 0, lab_results: 0, reports: 0,
    immunizations: 0, body_measurements: 0, cancer_screenings: 0,
    apple_records: 120, apple_workouts: 3 },
  overlapWarning: false,
  merge: null,
  nhiGuard: null,
  ...over,
});

test("刪除模式：各表筆數文案、無警告、可確認", () => {
  const m = buildRescuePreviewModel(basePreview(), { mode: "delete" });
  assert.match(m.summary, /刪除.*export\.xml/);
  assert.match(m.countsText, /Apple 紀錄 120/);
  assert.match(m.countsText, /Apple 體能訓練 3/);
  assert.doesNotMatch(m.countsText, /就醫/, "零筆數的表不列");
  assert.equal(m.warning, null);
  assert.equal(m.blocked, false);
  assert.equal(m.confirmDisabled, false);
});

test("重疊警告態：warning 帶「可能」與不可回補說明", () => {
  const m = buildRescuePreviewModel(basePreview({ overlapWarning: true }),
    { mode: "delete" });
  assert.match(m.warning, /可能/);
  assert.match(m.warning, /無法重匯|不可回補|無法回補/);
});

test("改歸屬未選目標：確認停用、提示選擇", () => {
  const m = buildRescuePreviewModel(basePreview(), { mode: "reattribute", targetName: null });
  assert.equal(m.confirmDisabled, true);
  assert.equal(m.mergeText, null);
});

test("改歸屬合併文案：搬移＝總筆數－合併、合併>0 才顯示", () => {
  const p = basePreview({
    merge: { perTable: { apple_records: 20, apple_workouts: 0 }, total: 20 },
  });
  const m = buildRescuePreviewModel(p, { mode: "reattribute", targetName: "爸爸" });
  assert.equal(m.confirmDisabled, false);
  assert.match(m.mergeText, /搬移 103 筆/);
  assert.match(m.mergeText, /重複合併 20 筆/);
  const none = buildRescuePreviewModel(basePreview({
    merge: { perTable: {}, total: 0 },
  }), { mode: "reattribute", targetName: "爸爸" });
  assert.match(none.mergeText, /搬移 123 筆/);
  assert.doesNotMatch(none.mergeText, /合併/);
});

test("健保阻擋態：確認停用、顯示原因", () => {
  const p = basePreview({
    doc: { id: 7, profileId: 1, displayName: "媽媽", filename: "a.json",
      adapter: "nhi_json", importedAt: "2026-08-01 10:00:00" },
    merge: { perTable: {}, total: 0 },
    nhiGuard: { blocked: true, reason: "檔案身分與目標成員不符：…",
      willUnbindSource: false, willBindTarget: false },
  });
  const m = buildRescuePreviewModel(p, { mode: "reattribute", targetName: "爸爸" });
  assert.equal(m.blocked, true);
  assert.equal(m.confirmDisabled, true);
  assert.match(m.blockReason, /不符/);
});

test("健保轉綁提示：來源解綁＋目標轉綁時顯示", () => {
  const p = basePreview({
    doc: { id: 7, profileId: 1, displayName: "媽媽", filename: "a.json",
      adapter: "nhi_json", importedAt: "2026-08-01 10:00:00" },
    merge: { perTable: {}, total: 0 },
    nhiGuard: { blocked: false, reason: null,
      willUnbindSource: true, willBindTarget: true },
  });
  const m = buildRescuePreviewModel(p, { mode: "reattribute", targetName: "爸爸" });
  assert.match(m.bindingText, /媽媽.*解除/);
  assert.match(m.bindingText, /爸爸/);
  const stay = buildRescuePreviewModel(basePreview({
    doc: { id: 7, profileId: 1, displayName: "媽媽", filename: "a.json",
      adapter: "nhi_json", importedAt: "2026-08-01 10:00:00" },
    merge: { perTable: {}, total: 0 },
    nhiGuard: { blocked: false, reason: null,
      willUnbindSource: false, willBindTarget: false },
  }), { mode: "reattribute", targetName: "爸爸" });
  assert.equal(stay.bindingText, null);
});
