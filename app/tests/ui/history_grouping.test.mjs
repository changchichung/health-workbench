// 匯入紀錄卡分組純函式（design D3 視角劃分：紀錄卡＝全庫依成員分組）
import test from "node:test";
import assert from "node:assert/strict";
import { groupDocsByProfile } from "../../src/ui/history.js";

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
