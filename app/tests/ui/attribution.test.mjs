// 匯入歸屬三態判定純函式（app-import-gui spec「匯入歸屬選擇」）
import test from "node:test";
import assert from "node:assert/strict";
import { attributionState, attributionNote } from "../../src/ui/import_flow.js";

test("attributionState 判定矩陣", () => {
  const bound = { id: 1, display_name: "爸爸", masked_id: "A12345****" };
  const unbound = { id: 2, display_name: "媽媽", masked_id: null };
  // 未選成員／非健保檔（無 maskedId）／b1.1 預讀不到 → none（交引擎護欄）
  assert.equal(attributionState("A12345****", null), "none");
  assert.equal(attributionState(null, bound), "none");
  assert.equal(attributionState(null, unbound), "none");
  // 三態
  assert.equal(attributionState("A12345****", unbound), "bind");
  assert.equal(attributionState("A12345****", bound), "match");
  assert.equal(attributionState("B98765****", bound), "mismatch");
});

test("attributionNote：不符時為警示且含雙方遮罩值與成員名", () => {
  const bound = { id: 1, display_name: "爸爸", masked_id: "A12345****" };
  const note = attributionNote("B98765****", bound);
  assert.match(note, /warn/);
  assert.match(note, /爸爸/);
  assert.match(note, /A12345\*\*\*\*/);
  assert.match(note, /B98765\*\*\*\*/);
  assert.equal(attributionNote(null, bound), "");
});
