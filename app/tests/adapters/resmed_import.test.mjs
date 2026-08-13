// ResMed adapter 匯入（change cpap-sleep-therapy 第 3 組）。
// 合成 EDF fixture → 真正寫進 node:sqlite，斷言資料庫內容而非中間結構。
import test from "node:test";
import assert from "node:assert/strict";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { createProfile } from "../../src/engine/profiles.js";
import { resmedEdfAdapter, sessionDateOf, dailyDateOf, parseDeviceModel }
  from "../../src/adapters/resmed_edf.js";
import { makeEdf, annotationRecord, STR_SIGNALS, SAD_SIGNALS, EVE_SIGNALS }
  from "../helpers/make_edf.mjs";

// 記憶體 ByteSource（介面同 tests/helpers/node_source.mjs 的最小子集）
function memSource(bytes, name) {
  return {
    name,
    size: bytes.length,
    async readAt(offset, len) { return bytes.subarray(offset, offset + len); },
    async *stream() { yield bytes; },
  };
}

const textSource = (text, name) =>
  memSource(new TextEncoder().encode(text), name);

const IDENT = "#VRN     1\n#PNA     S9_AutoSet\n#SRN     XXXXXXXXX\n";

// 一天的 STR record（數位值；未給的欄位由產生器補哨兵 -1）
function day({ on = [600], off = [780], dur = 170, pres = 372, leak = 5,
  ahi = 24, ai = 24, hi = 0 } = {}) {
  const map = {
    "Mask On": on, "Mask Off": off, "Mask Dur": [dur],
    "Therapy Pres Me": [pres], "Leak 95": [leak],
    AHI: [ahi], AI: [ai], HI: [hi],
  };
  return STR_SIGNALS.map(s => map[s.label] ?? []);
}
const UNUSED = STR_SIGNALS.map(() => [-1]);   // 未使用日：整列哨兵

function strBytes(records, opts = {}) {
  return makeEdf(STR_SIGNALS, records, { startDate: "27.03.22", ...opts });
}

function eveBytes(events, opts = {}) {
  const byteLen = EVE_SIGNALS[0].nsamp * 2;
  const recs = events.map(e => annotationRecord(byteLen, 0, [e]));
  return makeEdf(EVE_SIGNALS, recs.map(() => [[]]),
    { reserved: "EDF+D", recordDuration: 0, annotationBytes: { 0: recs },
      startDate: "12.06.23", startTime: "20.35.33", ...opts });
}

function sadBytes(minutes, opts = {}) {
  return makeEdf(SAD_SIGNALS, minutes, { recordDuration: 60,
    startDate: "12.06.23", startTime: "20.35.36", ...opts });
}

async function setup() {
  const d = new NodeDriver();
  await initSchema(d);
  const pid = await createProfile(d, "本人");
  return { d, pid };
}

const run = (d, entries, pid) =>
  resmedEdfAdapter.importSourceSet(
    { rootName: "resmed", entries }, d, null, { profileId: pid });

test("正午邊界：晚上就寢歸當日，午夜後就寢歸前一日", () => {
  assert.equal(sessionDateOf({ year: 2023, month: 6, day: 12, hour: 20 }), "2023-06-12");
  assert.equal(sessionDateOf({ year: 2023, month: 6, day: 12, hour: 12 }), "2023-06-12");
  assert.equal(sessionDateOf({ year: 2023, month: 6, day: 13, hour: 1 }), "2023-06-12",
    "凌晨 1 點就寢屬於前一晚");
  assert.equal(sessionDateOf({ year: 2023, month: 6, day: 1, hour: 3 }), "2023-05-31",
    "跨月");
  assert.equal(sessionDateOf({ year: 2023, month: 1, day: 1, hour: 3 }), "2022-12-31",
    "跨年");
});

test("每日日期以日曆日推進（不是加 86400 秒）", () => {
  const start = { year: 2022, month: 3, day: 27 };
  assert.equal(dailyDateOf(start, 0), "2022-03-27");
  assert.equal(dailyDateOf(start, 5), "2022-04-01");
  assert.equal(dailyDateOf({ year: 2022, month: 12, day: 30 }, 3), "2023-01-02");
});

test("機型字串取自 #PNA，不讀序號", () => {
  assert.equal(parseDeviceModel(IDENT), "S9_AutoSet");
  assert.equal(parseDeviceModel("#VRN 1\n"), null);
});

test("多檔判型：有 STR.edf 且通過 EDF 判型才接受", async () => {
  const entry = (relPath, bytes) => ({ relPath, readHeader: async () => bytes });
  assert.equal(await resmedEdfAdapter.detectSet(
    [entry("STR.edf", strBytes([day()]))]), true);
  assert.equal(await resmedEdfAdapter.detectSet(
    [entry("DATALOG/x_SAD.edf", sadBytes([[[], []]]))]), false,
    "只有 DATALOG 沒有 STR 不接受");
  assert.equal(await resmedEdfAdapter.detectSet(
    [entry("STR.edf", new Uint8Array(300))]), false);
  assert.equal(resmedEdfAdapter.detect(), false, "單檔路徑不接受");
});

test("多檔判型只讀必要的檔：無關檔案不被開啟", async () => {
  // 資料夾可能含上千個與本 adapter 無關的檔（如 Apple 匯出的
  // workout-routes）。逐檔讀 header 會讓其他來源的匯入每次都多上千次 IO。
  let reads = 0;
  const entry = (relPath, bytes) => ({
    relPath, readHeader: async () => { reads += 1; return bytes; },
  });
  const many = Array.from({ length: 500 },
    (_, i) => entry(`workout-routes/route${i}.gpx`, new Uint8Array(300)));
  assert.equal(await resmedEdfAdapter.detectSet(many), false);
  assert.equal(reads, 0, "沒有 STR.edf 時一個檔都不該讀");

  assert.equal(await resmedEdfAdapter.detectSet(
    [...many, entry("STR.edf", strBytes([day()]))]), true);
  assert.equal(reads, 1, "只讀 STR.edf 一個檔");
});

test("完整匯入：三表筆數與數值正確、每檔一列 source_documents", async () => {
  const { d, pid } = await setup();
  const entries = [
    { relPath: "Identification.tgt", source: textSource(IDENT, "Identification.tgt") },
    { relPath: "STR.edf", source: memSource(strBytes([day(), day({ ahi: 25 })]), "STR.edf") },
    { relPath: "DATALOG/20230612_203533_EVE.edf",
      source: memSource(eveBytes([
        { onset: 0, duration: 0, label: "Recording starts" },
        { onset: 115, duration: 11, label: "Obstructive Apnea" },
        { onset: 188, duration: 14, label: "Central Apnea" },
        { onset: 900, duration: 9, label: "Apnea" },
      ]), "e.edf") },
    { relPath: "DATALOG/20230612_203536_SAD.edf",
      source: memSource(sadBytes([
        [new Array(60).fill(70), new Array(60).fill(96)],
        [new Array(60).fill(80), new Array(60).fill(94)],
      ]), "s.edf") },
    // 未解析的檔：不得建 source_documents 列
    { relPath: "STR.crc", source: textSource("x", "STR.crc") },
    { relPath: "DATALOG/20230612_203535_PLD.edf", source: memSource(strBytes([day()]), "p.edf") },
    { relPath: "SETTINGS/AGL.tgt", source: textSource("x", "AGL.tgt") },
  ];
  const res = await run(d, entries, pid);
  assert.equal(res.status, "ok");

  const daily = await d.select("SELECT * FROM cpap_daily ORDER BY summary_date");
  assert.equal(daily.length, 2);
  assert.equal(daily[0].summary_date, "2022-03-27");
  assert.equal(daily[1].summary_date, "2022-03-28");
  assert.equal(daily[0].device, "S9_AutoSet");
  assert.equal(daily[0].ahi, 2.4, "AHI 由數位值 24 縮放而來");
  assert.equal(daily[1].ahi, 2.5);
  assert.equal(daily[0].usage_min, 170);
  assert.equal(daily[0].pressure_median, 7.44);
  assert.equal(daily[0].leak_95, 0.1);
  assert.equal(daily[0].session_start_min, 600);
  assert.equal(daily[0].session_end_min, 780);
  assert.equal(daily[0].session_count, 1);
  assert.equal(daily[0].quality_flags, "");

  const events = await d.select("SELECT * FROM cpap_events ORDER BY start_ts");
  assert.equal(events.length, 3, "Recording starts 不是事件，不入庫");
  assert.deepEqual(events.map(e => e.event_type),
    ["Obstructive Apnea", "Central Apnea", "Apnea"]);
  assert.equal(events[0].session_date, "2023-06-12");
  assert.equal(events[0].start_ts, "2023-06-12T20:37:28", "20:35:33 加 115 秒");
  assert.equal(events[0].duration_sec, 11);

  const oxi = await d.select("SELECT * FROM cpap_oximetry ORDER BY minute_ts");
  assert.equal(oxi.length, 2);
  assert.equal(oxi[0].spo2_min, 96);
  assert.equal(oxi[0].pulse_mean, 70);
  assert.equal(oxi[0].sample_count, 60);
  assert.equal(oxi[1].spo2_min, 94);
  assert.equal(oxi[0].session_date, "2023-06-12");

  // 每檔一列，且未解析的檔不建列
  const docs = await d.select("SELECT filename FROM source_documents ORDER BY filename");
  assert.deepEqual(docs.map(r => r.filename), [
    "DATALOG/20230612_203533_EVE.edf",
    "DATALOG/20230612_203536_SAD.edf",
    "STR.edf",
  ], "只有被解析的三個檔建列；crc／PLD／SETTINGS 不建列");
  await d.close();
});

test("未使用日整筆跳過並計數，合法的 0 值不被吃掉", async () => {
  const { d, pid } = await setup();
  const entries = [{ relPath: "STR.edf",
    source: memSource(strBytes([day(), UNUSED, UNUSED, day({ ahi: 0, ai: 0, hi: 0 })]), "STR.edf") }];
  const res = await run(d, entries, pid);
  const daily = await d.select("SELECT * FROM cpap_daily ORDER BY summary_date");
  assert.equal(daily.length, 2, "兩個未使用日不入庫");
  assert.deepEqual(daily.map(r => r.summary_date), ["2022-03-27", "2022-03-30"]);
  assert.equal(daily[1].ahi, 0, "AHI 恰為 0 是合法值，不可被當成缺測刪成 NULL");
  assert.equal(daily[1].ai, 0);
  assert.equal(res.report.sections.cpap_daily.note.includes("2 天"), true);
  await d.close();
});

test("多段 session：段數、首末時刻與 extra_json.segments", async () => {
  const { d, pid } = await setup();
  const entries = [{ relPath: "STR.edf", source: memSource(
    strBytes([day({ on: [600, 900], off: [780, 1000], dur: 460 })]), "STR.edf") }];
  await run(d, entries, pid);
  const [row] = await d.select("SELECT * FROM cpap_daily");
  assert.equal(row.session_count, 2);
  assert.equal(row.session_start_min, 600, "首段起");
  assert.equal(row.session_end_min, 1000, "末段止");
  assert.equal(row.quality_flags, "multi_session");
  assert.deepEqual(JSON.parse(row.extra_json).segments, [[600, 780], [900, 1000]]);
  await d.close();
});

test("重複匯入同一批：零新增，既有列逐位元組不變", async () => {
  const { d, pid } = await setup();
  const mk = () => [
    { relPath: "Identification.tgt", source: textSource(IDENT, "i") },
    { relPath: "STR.edf", source: memSource(strBytes([day(), day({ ahi: 25 })]), "STR.edf") },
  ];
  await run(d, mk(), pid);
  const dump = async () => JSON.stringify({
    daily: await d.select("SELECT * FROM cpap_daily ORDER BY id"),
    docs: await d.select(
      "SELECT id, filename, sha256, import_stats FROM source_documents ORDER BY id"),
  });
  const before = await dump();

  const res = await run(d, mk(), pid);
  assert.equal(res.status, "skipped_duplicate", "整批命中即回報整批重複");
  assert.equal(await dump(), before, "既有列逐位元組不變");
  const [{ c }] = await d.select("SELECT COUNT(*) c FROM cpap_daily");
  assert.equal(c, 2, "沒有重複列");
  await d.close();
});

test("部分新檔：只處理新的，舊檔 sha256 命中即跳過", async () => {
  const { d, pid } = await setup();
  const str = strBytes([day()]);
  await run(d, [{ relPath: "STR.edf", source: memSource(str, "STR.edf") }], pid);

  // 第二次：同一個 STR 加一個新的 SAD
  const res = await run(d, [
    { relPath: "STR.edf", source: memSource(str, "STR.edf") },
    { relPath: "DATALOG/20230612_203536_SAD.edf",
      source: memSource(sadBytes([[new Array(60).fill(70), new Array(60).fill(96)]]), "s") },
  ], pid);
  assert.equal(res.status, "ok");
  assert.equal(res.report.source.new_files, 1);
  assert.equal(res.report.source.duplicate_files, 1);
  const [{ c }] = await d.select("SELECT COUNT(*) c FROM cpap_daily");
  assert.equal(c, 1, "STR 沒有被重複處理");
  const [{ o }] = await d.select("SELECT COUNT(*) o FROM cpap_oximetry");
  assert.equal(o, 1);
  // STR 是重複檔時不得覆寫它首次匯入的統計（白名單只允許寫本次新建的列）
  const [strDoc] = await d.select(
    "SELECT import_stats FROM source_documents WHERE filename = 'STR.edf'");
  assert.equal(JSON.parse(strDoc.import_stats).inserted.cpap_daily, 1,
    "首次匯入的統計必須保留，不可被本批合計覆寫");
  await d.close();
});

test("整檔皆為缺測（未接血氧模組）：不建任何列，且不算錯誤", async () => {
  // 這是真實素材的形狀：SAD 檔結構完整、record 數正確，但每一個樣本都是
  // 缺測值。該機型需外接血氧模組，未接時照樣寫出空殼檔。
  const { d, pid } = await setup();
  const missing = new Array(60).fill(-1);
  const res = await run(d, [
    { relPath: "STR.edf", source: memSource(strBytes([day()]), "STR.edf") },
    { relPath: "DATALOG/20230612_203536_SAD.edf",
      source: memSource(sadBytes([[missing, missing], [missing, missing]]), "s") },
  ], pid);
  assert.equal(res.status, "ok");
  const [{ c }] = await d.select("SELECT COUNT(*) c FROM cpap_oximetry");
  assert.equal(c, 0, "整桶皆缺測則不建列");
  assert.equal(res.report.source.parse_errors.length, 0, "空殼檔不是解析錯誤");
  const docs = await d.select(
    "SELECT filename FROM source_documents WHERE filename LIKE '%SAD%'");
  assert.equal(docs.length, 1, "該檔仍留下來源紀錄，下次插卡才不會重複處理");
  await d.close();
});

test("讀不到機型：回退且明確告知，資料仍歸在一起", async () => {
  const { d, pid } = await setup();
  const res = await run(d, [
    { relPath: "STR.edf", source: memSource(strBytes([day()]), "STR.edf") },
  ], pid);
  const [row] = await d.select("SELECT device FROM cpap_daily");
  assert.equal(row.device, "resmed_edf");
  assert.equal(res.messages.some(m => m.includes("機型")), true);
  await d.close();
});

test("壞檔不讓整批失敗，但明確計數", async () => {
  const { d, pid } = await setup();
  const res = await run(d, [
    { relPath: "STR.edf", source: memSource(strBytes([day()]), "STR.edf") },
    { relPath: "DATALOG/20230612_203533_EVE.edf",
      source: memSource(new Uint8Array(100), "bad") },
  ], pid);
  assert.equal(res.status, "ok");
  const [{ c }] = await d.select("SELECT COUNT(*) c FROM cpap_daily");
  assert.equal(c, 1, "好檔照樣入庫");
  assert.equal(res.report.source.parse_errors.length, 1);
  const bad = res.report.source.files.find(f => f.status === "parse_error");
  assert.ok(bad, "報告卡列出解析失敗的檔");
  await d.close();
});

test("匯入失敗全庫回滾：缺 profileId 零寫入", async () => {
  const { d } = await setup();
  await assert.rejects(resmedEdfAdapter.importSourceSet(
    { rootName: "r", entries: [{ relPath: "STR.edf",
      source: memSource(strBytes([day()]), "STR.edf") }] }, d, null, {}));
  const [{ c }] = await d.select("SELECT COUNT(*) c FROM cpap_daily");
  assert.equal(c, 0);
  const [{ s }] = await d.select("SELECT COUNT(*) s FROM source_documents");
  assert.equal(s, 0, "來源列也不得留下");
  await d.close();
});

// 批次時間戳（change viewer-and-history-refinement D2）：檢視層以
// 「同 adapter ＋同 imported_at」判定批次，多檔來源必須整批共用一個時間戳。
test("多檔匯入：整批共用同一個 imported_at", async () => {
  const { d, pid } = await setup();
  const entries = [
    { relPath: "Identification.tgt", source: textSource(IDENT, "Identification.tgt") },
    { relPath: "STR.edf", source: memSource(strBytes([day(), day({ ahi: 25 })]), "STR.edf") },
    { relPath: "DATALOG/20230612_203533_EVE.edf",
      source: memSource(eveBytes([
        { onset: 115, duration: 11, label: "Obstructive Apnea" }]), "e1.edf") },
    { relPath: "DATALOG/20230613_202627_EVE.edf",
      source: memSource(eveBytes([
        { onset: 200, duration: 9, label: "Central Apnea" }]), "e2.edf") },
  ];

  // 機制層斷言：攔截 INSERT 的參數，確認每一列都帶了同一個非 null 時間戳。
  // 只看結果層（COUNT(DISTINCT imported_at)）在插入夠快時會假綠——逐列各自
  // 取 datetime('now') 也可能落在同一秒。
  const inserts = [];
  const spy = Object.create(d);
  spy.execute = (sql, params) => {
    if (/INSERT INTO source_documents/.test(sql)) inserts.push(params);
    return d.execute(sql, params);
  };
  spy.transaction = (fn) => NodeDriver.prototype.transaction.call(d, () => fn(spy));

  await resmedEdfAdapter.importSourceSet(
    { rootName: "resmed", entries }, spy, null, { profileId: pid });

  assert.equal(inserts.length, 3, "STR 與兩個 EVE 各一列（Identification 不建列）");
  const stamps = inserts.map((p) => p[5]);
  assert.ok(stamps.every((s) => s != null),
    `每列都必須帶入批次時間戳，實際：${JSON.stringify(stamps)}`);
  assert.equal(new Set(stamps).size, 1, "整批必須是同一個時間戳");
  assert.match(stamps[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    "格式必須與 schema 預設的 datetime('now') 一致");

  // 結果層：庫裡確實只有一個 imported_at
  const [{ n }] = await d.select(
    "SELECT COUNT(DISTINCT imported_at) AS n FROM source_documents WHERE adapter=?",
    ["resmed_edf"]);
  assert.equal(n, 1);
  await d.close();
});
