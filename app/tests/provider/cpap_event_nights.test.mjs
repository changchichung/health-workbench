// 逐筆事件的 payload 保留範圍以「晚」為單位（change
// viewer-and-history-refinement D3）。按筆數切的舊語意會落在某一晚的中間，
// 那晚只剩一半事件而畫面上看不出被截斷；本檔把「任一晚要嘛完整、要嘛不在
// payload」釘住。
import test from "node:test";
import assert from "node:assert/strict";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { createProfile } from "../../src/engine/profiles.js";
import { buildPayload, CPAP_EVENT_NIGHTS, CPAP_EVENT_ROWS_CAP }
  from "../../src/provider/payload.js";

// 造庫：nights 晚，每晚 perNight 筆事件。日期由 2020-01-01 起連續遞增，
// 因此「最舊的晚」就是第一天。
async function dbWithEvents(nights, perNight) {
  const d = new NodeDriver(":memory:");
  await initSchema(d);
  const pid = await createProfile(d, "測試成員");
  await d.execute(
    "INSERT INTO source_documents(profile_id,filename,sha256,adapter,adapter_version)"
    + " VALUES(?,?,?,?,?)", [pid, "STR.edf", "sha-nights", "resmed_edf", "1"]);
  const [{ id: docId }] = await d.select(
    "SELECT id FROM source_documents WHERE sha256='sha-nights'");
  const base = Date.UTC(2020, 0, 1);
  const rows = [];
  for (let n = 0; n < nights; n++) {
    const date = new Date(base + n * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < perNight; i++) {
      // start_ts 必須在一晚內唯一：cpap_events 的 UNIQUE 鍵是
      // (profile_id, device, start_ts, event_type)，時刻重複會被真實約束擋下
      const p2 = (n) => String(n).padStart(2, "0");
      const ts = `${date}T${p2(20 + Math.floor(i / 3600))}`
        + `:${p2(Math.floor((i % 3600) / 60))}:${p2(i % 60)}`;
      rows.push([pid, docId, "TestDev", date, ts, 10, "Obstructive Apnea"]);
    }
  }
  for (const r of rows) {
    await d.execute(
      "INSERT INTO cpap_events(profile_id,doc_id,device,session_date,start_ts,"
      + "duration_sec,event_type) VALUES(?,?,?,?,?,?,?)", r);
  }
  return { d, pid };
}

const payloadOf = (d, pid) => buildPayload(d, { profileId: pid,
  knowledgeEntries: [], drugCachePath: null, today: "2026-08-13" });

// 每一晚在 payload 裡的筆數；用來斷言「沒有半晚」
function perNightCounts(events) {
  const m = new Map();
  for (const e of events) m.set(e.session_date, (m.get(e.session_date) || 0) + 1);
  return m;
}

test("恰好上限晚數：全部帶入且不標記截斷", async () => {
  const { d, pid } = await dbWithEvents(CPAP_EVENT_NIGHTS, 3);
  const { cpap } = await payloadOf(d, pid);
  assert.equal(cpap.events_nights, CPAP_EVENT_NIGHTS);
  assert.equal(cpap.events_nights_total, CPAP_EVENT_NIGHTS);
  assert.equal(cpap.events.length, CPAP_EVENT_NIGHTS * 3);
  assert.equal(cpap.events_truncated, false, "沒有任何一晚被剔除就不得標記截斷");
  await d.close();
});

test("超過上限晚數：最舊那晚完全不在 payload，不得有半晚", async () => {
  const { d, pid } = await dbWithEvents(CPAP_EVENT_NIGHTS + 1, 3);
  const { cpap } = await payloadOf(d, pid);
  assert.equal(cpap.events_nights, CPAP_EVENT_NIGHTS);
  assert.equal(cpap.events_nights_total, CPAP_EVENT_NIGHTS + 1,
    "庫裡有事件的晚數要如實回報，不受保留範圍影響");
  assert.equal(cpap.events_truncated, true);
  const counts = perNightCounts(cpap.events);
  assert.ok(!counts.has("2020-01-01"), "最舊的一晚必須整晚不在，而不是被切一半");
  assert.equal(counts.size, CPAP_EVENT_NIGHTS);
  assert.ok([...counts.values()].every((n) => n === 3),
    `每一晚都必須完整（3 筆）：${JSON.stringify([...counts])}`);
  await d.close();
});

test("觸發筆數硬上限：以整晚為單位剔除，剩下的每晚仍完整", async () => {
  // 每晚 200 筆 × 50 晚 = 10,000 筆，超過 8,000 筆硬上限而晚數仍在上限內，
  // 因此紅的一定是筆數上限那條路徑。晚數用 CPAP_EVENT_NIGHTS 會造出七萬多列，
  // 測試要跑數秒且無助於斷言。
  const perNight = 200;
  const nights = 50;
  assert.ok(nights <= CPAP_EVENT_NIGHTS, "此測試要單獨驗筆數上限，晚數不得先觸發");
  const { d, pid } = await dbWithEvents(nights, perNight);
  const { cpap } = await payloadOf(d, pid);
  assert.ok(cpap.events.length <= CPAP_EVENT_ROWS_CAP,
    `帶入 ${cpap.events.length} 筆超過硬上限 ${CPAP_EVENT_ROWS_CAP}`);
  assert.ok(cpap.events_nights < nights, "筆數上限應讓保留的晚數少於實際晚數");
  const counts = perNightCounts(cpap.events);
  assert.equal(counts.size, cpap.events_nights, "events_nights 要與實際晚數相符");
  assert.ok([...counts.values()].every((n) => n === perNight),
    `剔除必須以整晚為單位，每晚都是 ${perNight} 筆：${JSON.stringify([...counts.values()])}`);
  assert.equal(cpap.events_truncated, true);
  // 保留的是「最近的」那些晚：最舊的晚必須先被剔除
  const kept = [...counts.keys()].sort();
  const [{ mx }] = await d.select("SELECT MAX(session_date) mx FROM cpap_events");
  assert.equal(kept.at(-1), mx, "最後一晚（最新）必須保留");
  await d.close();
});

test("完全沒有逐筆事件：欄位為空且不標記截斷", async () => {
  const { d, pid } = await dbWithEvents(0, 0);
  const { cpap } = await payloadOf(d, pid);
  assert.deepEqual(cpap.events, []);
  assert.deepEqual(cpap.event_daily, []);
  assert.equal(cpap.events_total, 0);
  assert.equal(cpap.events_nights, 0);
  assert.equal(cpap.events_nights_total, 0);
  assert.equal(cpap.events_truncated, false);
  await d.close();
});

test("每晚事件數聚合不受保留範圍影響：涵蓋全部有事件的晚", async () => {
  const { d, pid } = await dbWithEvents(CPAP_EVENT_NIGHTS + 5, 2);
  const { cpap } = await payloadOf(d, pid);
  const aggNights = new Set(cpap.event_daily.map((r) => r.date));
  assert.equal(aggNights.size, CPAP_EVENT_NIGHTS + 5,
    "event_daily 是聚合視角，資料量再大都要涵蓋全部夜晚");
  assert.ok(aggNights.has("2020-01-01"),
    "被逐筆保留範圍剔除的晚，在每晚事件數裡仍必須看得到");
  assert.equal(cpap.events_nights, CPAP_EVENT_NIGHTS);
  await d.close();
});
