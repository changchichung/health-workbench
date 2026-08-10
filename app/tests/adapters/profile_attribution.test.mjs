// app-import-engine spec「匯入歸屬指定」scenario 矩陣：
// 護欄阻擋／首次綁定／綁定衝突／缺 profileId 即錯／跨成員重複檔。
import test from "node:test";
import assert from "node:assert/strict";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { nhiJsonAdapter } from "../../src/adapters/nhi_json.js";
import { appleHealthAdapter } from "../../src/adapters/apple_health.js";
import { createProfile, getProfile } from "../../src/engine/profiles.js";
import { EngineStore } from "../../src/engine/store.js";

async function freshDb() {
  const d = new NodeDriver();
  await initSchema(d);
  return d;
}

const nhiSource = (maskedId, dateSuffix = "01") => ({
  name: `t${dateSuffix}.json`,
  bytes: new TextEncoder().encode(JSON.stringify({ myhealthbank: { bdata: {
    "b1.1": maskedId,
    r1: [{ "r1.3": "9900000009", "r1.4": "測試院所", "r1.5": `202601${dateSuffix}` }],
  } } })),
});

const APPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="zh_TW">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count"
  startDate="2026-01-01 08:00:00 +0800" endDate="2026-01-01 08:10:00 +0800" value="100"/>
</HealthData>`;

function appleSource(name = "export.xml") {
  const bytes = new TextEncoder().encode(APPLE_XML);
  return {
    name, size: bytes.length,
    readAt: async (off, len) => bytes.subarray(off, off + len),
    stream: async function* () { yield bytes; },
  };
}

async function zeroWrites(d) {
  const [{ c }] = await d.select(
    "SELECT (SELECT count(*) FROM source_documents) + (SELECT count(*) FROM encounters) c");
  return c === 0;
}

test("護欄阻擋：所選成員已綁定不同身分證 → 中止零寫入，訊息含成員名與雙值", async () => {
  const d = await freshDb();
  const pid = await createProfile(d, "爸爸");
  await d.execute("UPDATE profiles SET masked_id='A12345****' WHERE id=?", [pid]);
  const r = await nhiJsonAdapter.importSource(nhiSource("B98765****"), d, null,
    { labEntries: [], profileId: pid });
  assert.equal(r.status, "aborted");
  const msg = r.messages.at(-1);
  assert.match(msg, /爸爸/);
  assert.match(msg, /A12345\*\*\*\*/);
  assert.match(msg, /B98765\*\*\*\*/);
  assert.ok(await zeroWrites(d));
  await d.close();
});

test("首次綁定：未綁定成員匯入即綁定 b1.1，後續不符檔被擋", async () => {
  const d = await freshDb();
  const pid = await createProfile(d, "媽媽");
  const r1 = await nhiJsonAdapter.importSource(nhiSource("B98765****"), d, null,
    { labEntries: [], profileId: pid });
  assert.equal(r1.status, "ok");
  assert.equal((await getProfile(d, pid)).masked_id, "B98765****");
  const r2 = await nhiJsonAdapter.importSource(nhiSource("C11111****", "02"), d, null,
    { labEntries: [], profileId: pid });
  assert.equal(r2.status, "aborted");
  await d.close();
});

test("綁定衝突：身分證已屬他成員 → 中止並提示所屬成員，未綁定不誤綁", async () => {
  const d = await freshDb();
  const dad = await createProfile(d, "本人");
  await nhiJsonAdapter.importSource(nhiSource("A12345****"), d, null,
    { labEntries: [], profileId: dad });
  const mom = await createProfile(d, "媽媽");
  const r = await nhiJsonAdapter.importSource(nhiSource("A12345****", "02"), d, null,
    { labEntries: [], profileId: mom });
  assert.equal(r.status, "aborted");
  assert.match(r.messages.at(-1), /已屬於成員「本人」/);
  assert.equal((await getProfile(d, mom)).masked_id, null, "媽媽不被誤綁");
  const [{ c }] = await d.select(
    "SELECT count(*) c FROM encounters WHERE profile_id=?", [mom]);
  assert.equal(c, 0);
  await d.close();
});

test("缺 profileId 即錯：NHI 與 Apple 皆明確失敗，不回退第一個成員", async () => {
  const d = await freshDb();
  await createProfile(d, "本人");
  await assert.rejects(
    () => nhiJsonAdapter.importSource(nhiSource("A12345****"), d, null,
      { labEntries: [] }),
    /歸屬成員/);
  await assert.rejects(
    () => appleHealthAdapter.importSource(appleSource(), d, null, {}),
    /歸屬成員/);
  await assert.rejects(
    () => appleHealthAdapter.importSource(appleSource(), d, null, { profileId: 999 }),
    /不存在/);
  assert.ok(await zeroWrites(d));
  await d.close();
});

test("跨成員重複檔案：訊息附原歸屬成員與時間，零寫入", async () => {
  const d = await freshDb();
  const me = await createProfile(d, "本人");
  const mom = await createProfile(d, "媽媽");
  const r1 = await appleHealthAdapter.importSource(appleSource(), d, null,
    { profileId: me });
  assert.equal(r1.status, "ok");
  const store = new EngineStore(d);
  const before = await store.tableCounts();
  const r2 = await appleHealthAdapter.importSource(appleSource("export2.xml"), d, null,
    { profileId: mom });
  assert.equal(r2.status, "skipped_duplicate");
  assert.equal(r2.originDisplayName, "本人");
  assert.match(r2.messages.at(-1), /匯入至成員「本人」/);
  assert.ok(r2.importedAt);
  assert.deepEqual(await store.tableCounts(), before);
  await d.close();
});
