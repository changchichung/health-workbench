import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { createProfile } from "../../src/engine/profiles.js";
import { nhiJsonAdapter } from "../../src/adapters/nhi_json.js";
import { createRegistry } from "../../src/adapters/registry.js";
import { nhiXmlAdapter } from "../../src/adapters/nhi_xml.js";
import { appleHealthAdapter } from "../../src/adapters/apple_health.js";
import { friendlyError, readFailureMessage } from "../../src/ui/import_flow.js";

const REPO = new URL("../../..", import.meta.url).pathname;

// 邊界容錯（Karen 收尾檢核 2026-08-10 補）：壞檔不得炸出技術訊息、
// 資料庫必須零寫入

test("0-byte 檔：判型不命中（走「無法識別」路徑，不炸）", () => {
  const reg = createRegistry();
  reg.register(nhiJsonAdapter);
  reg.register(nhiXmlAdapter);
  reg.register(appleHealthAdapter);
  assert.equal(reg.detect(new Uint8Array(0), "空.json"), null);
});

test("截斷的健保 JSON：引擎丟錯且零寫入；GUI 轉譯為友善訊息", async () => {
  const d = new NodeDriver();
  await initSchema(d);
  const truncated = readFileSync(`${REPO}/tests/fixtures/nhi_sample.json`)
    .subarray(0, 500); // 判型會過（含 "myhealthbank"），JSON.parse 會炸
  let thrown = null;
  try {
    await nhiJsonAdapter.importSource(
      { bytes: new Uint8Array(truncated), name: "截斷.json" }, d, null,
      { labEntries: [], profileId: await createProfile(d, "本人") });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "截斷檔應丟錯");
  const [{ c }] = await d.select("SELECT count(*) c FROM source_documents");
  assert.equal(c, 0, "零寫入");
  const [friendly, detail] = friendlyError(thrown);
  assert.ok(!/Unexpected|parse|undefined/i.test(friendly), `友善訊息不得含技術詞：${friendly}`);
  assert.ok(detail.length > 0, "技術細節保留於折疊區");
  await d.close();
});

test("垃圾內容偽裝 myhealthbank：友善訊息不外洩內部結構詞", async () => {
  const d = new NodeDriver();
  await initSchema(d);
  const junk = new TextEncoder().encode('{"myhealthbank": 123}');
  let thrown = null;
  try {
    await nhiJsonAdapter.importSource(
      { bytes: junk, name: "junk.json" }, d, null,
      { labEntries: [], profileId: await createProfile(d, "本人") });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown);
  const [friendly] = friendlyError(thrown);
  assert.ok(!/Unexpected|reading|undefined|null/i.test(friendly), friendly);
  const [{ c }] = await d.select("SELECT count(*) c FROM source_documents");
  assert.equal(c, 0);
  await d.close();
});

// fs scope 拒絕的引導訊息（2026-08-17，配合讀取 scope 由 ** 收斂為白名單）。
// 錯誤原文取自 2026-08-13 實機走查紀錄（docs/verification/
// cpap_dotfile_scope_fix.md），非人造字串。

const SCOPE_ERR_STAT = "forbidden path: /Users/x/Pictures/卡/.DS_Store, "
  + "maybe it is not allowed on the scope for `allow-stat` permission "
  + "in your capability file";

test("scope 拒絕：訊息要指出可行的替代路徑，不能只說失敗", () => {
  const m = readFailureMessage(SCOPE_ERR_STAT);
  assert.match(m, /選擇檔案/, "MUST 指出 dialog 選檔可繞過（它走動態授權、不吃靜態 scope）");
  assert.match(m, /未寫入任何資料/, "MUST 說明資料庫狀態，使用者才知道不必擔心半套資料");
  assert.ok(!/forbidden|scope|permission/i.test(m), `友善訊息不得含技術詞：${m}`);
  // 讀取 scope 是 **，沒有位置白名單；叫使用者搬資料夾是錯的引導
  assert.ok(!/移到|搬到|下載／桌面|放到下載/.test(m),
    `MUST NOT 叫使用者搬移資料夾（讀取 scope 為 ** 無位置白名單）：${m}`);
});

test("scope 拒絕：權限名不同也要命中（allow-stat 以外）", () => {
  for (const perm of ["allow-read-dir", "allow-read-file", "allow-open"]) {
    const raw = `forbidden path: /Users/x/a, maybe it is not allowed on the `
      + `scope for \`${perm}\` permission in your capability file`;
    assert.match(readFailureMessage(raw), /選擇檔案/,
      `${perm} 也必須命中：權限名隨呼叫點不同，判別式不得綁定特定權限名`);
  }
});

test("非 scope 錯誤：沿用通用措辭，不得誤導使用者去換位置", () => {
  for (const raw of ["Unexpected end of JSON input", "No such file or directory",
    "資料庫已鎖定"]) {
    const m = readFailureMessage(raw);
    assert.equal(m, "無法讀取這個來源，資料庫未寫入任何資料。",
      `不該被判成 scope 錯誤：${raw}`);
  }
});
