// settings 模組（design D4；profile-management spec「當前成員狀態記憶」）。
// loadSettings 純解析零驗證；resolveCurrentProfile 為唯一 id 驗證點（純函式）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadSettings, saveSettings, resolveCurrentProfile, nodeIo,
} from "../../src/store/settings.js";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mhb-settings-"));

test("loadSettings：缺檔回傳 {}", async () => {
  assert.deepEqual(await loadSettings(tmp(), nodeIo), {});
});

test("loadSettings：壞 JSON 靜默回傳 {}（不丟錯）", async () => {
  const dir = tmp();
  await saveSettings(dir, { current_profile_id: 2 }, nodeIo);
  const file = path.join(dir, "settings.json");
  await nodeIo.writeTextFile(file, "{壞掉的 json");
  assert.deepEqual(await loadSettings(dir, nodeIo), {});
});

test("saveSettings 後 loadSettings 重讀一致；檔案不含個資鍵", async () => {
  const dir = tmp();
  await saveSettings(dir, { current_profile_id: 3 }, nodeIo);
  assert.deepEqual(await loadSettings(dir, nodeIo), { current_profile_id: 3 });
  const raw = readFileSync(path.join(dir, "settings.json"), "utf-8");
  assert.ok(!/masked|name|身分/i.test(raw), "settings.json 僅存數字 id");
});

test("resolveCurrentProfile 判定矩陣", () => {
  const profiles = [{ id: 3, display_name: "本人" }, { id: 7, display_name: "媽媽" }];
  // settings 指向存在的成員 → 用之
  assert.equal(resolveCurrentProfile({ current_profile_id: 7 }, profiles), 7);
  // 指向已刪成員 → 回退 id 最小
  assert.equal(resolveCurrentProfile({ current_profile_id: 99 }, profiles), 3);
  // settings 空（缺檔/壞檔）→ id 最小
  assert.equal(resolveCurrentProfile({}, profiles), 3);
  // id 型別髒值（字串）→ 不匹配即回退
  assert.equal(resolveCurrentProfile({ current_profile_id: "7" }, profiles), 3);
  // 零成員 → null
  assert.equal(resolveCurrentProfile({ current_profile_id: 1 }, []), null);
  assert.equal(resolveCurrentProfile({}, []), null);
  // 清單未排序也取 id 最小（不可依賴呼叫端排序）
  assert.equal(resolveCurrentProfile({}, [{ id: 9 }, { id: 4 }]), 4);
});
