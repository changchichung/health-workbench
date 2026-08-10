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
import { friendlyError } from "../../src/ui/import_flow.js";

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
