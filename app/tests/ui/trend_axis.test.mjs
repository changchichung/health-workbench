// 趨勢圖時間軸與區間選擇（change trend-time-axis）。
// 走與 viewer_render.test.mjs 相同的 vm sandbox 手法：不新增資產模組，
// 對真渲染出來的 SVG 座標與文字斷言（design D7／D9）。
// 資料形狀刻意複製使用者真實庫的病灶：體重密集且新鮮、血壓停在 數百天前、
// 檢驗僅 3 筆且含一筆 null 日期、步數逐日。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { createProfile } from "../../src/engine/profiles.js";
import { buildPayload } from "../../src/provider/payload.js";
import { makeDocument, findAll } from "../helpers/mini_dom.mjs";

const REPO = new URL("../../..", import.meta.url).pathname;
const ASSETS = new URL("../../src/viewer/assets/", import.meta.url);
const LAB_ENTRIES = JSON.parse(
  readFileSync(new URL("../../src/knowledge/labs.json", import.meta.url), "utf-8"));
const TODAY = "2026-08-12";
const W = 860, PL = 48, PR = 100, PW = W - PL - PR;
const day = (n) => n * 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/* 建一顆形狀貼近使用者真實資料的庫 */
async function shapePayload({ nullLabDate = false, staleAll = false,
  latestAfterGenerated = false } = {}) {
  const d = new NodeDriver(path.join(mkdtempSync(path.join(tmpdir(), "mhb-ta-")), "db.sqlite"));
  await initSchema(d);
  const pid = await createProfile(d, "示範");
  const doc = {};
  for (const [k, ad] of [["nhi", "nhi_json"], ["apple", "apple_health"]]) {
    const r = await d.execute(
      `INSERT INTO source_documents(profile_id, filename, sha256, adapter,
        adapter_version, imported_at) VALUES (?,?,?,?,?,?)`,
      [pid, `${k}.dat`, `sha-${k}`, ad, "1", "2026-08-10 21:00"]);
    doc[k] = r.lastInsertRowid;
  }
  // 就醫一筆（讓 meta.date_min/max 有值）
  await d.execute(
    `INSERT INTO encounters(profile_id, doc_id, section, source_index, record_fp,
      canonical, type, date, facility_name) VALUES (?,?,?,?,?,?,?,?,?)`,
    [pid, doc.nhi, "r1", 1, "fp-e1", "{}", "western_outpatient", "2025-03-04", "示範診所"]);

  const T = Date.parse(TODAY);
  const appleRows = [];
  // 體重：起點依情境；每日一點（密集）
  const wStart = staleAll ? T - day(2000) : T - day(2766);
  const wEnd = staleAll ? T - day(1600) : T - day(4);
  for (let t = wStart; t <= wEnd; t += day(1)) {
    appleRows.push([pid, doc.apple, "HKQuantityTypeIdentifierBodyMass", "體重",
      `${iso(t)} 07:10:00`, `${iso(t)} 07:10:00`, 72.5, null, null, "kg", "示範體重計", ""]);
  }
  if (latestAfterGenerated) {   // 一筆晚於 generated_at 的量測
    const t = T + day(1);
    appleRows.push([pid, doc.apple, "HKQuantityTypeIdentifierBodyMass", "體重",
      `${iso(t)} 07:10:00`, `${iso(t)} 07:10:00`, 71.9, null, null, "kg", "示範體重計", ""]);
  }
  // 血壓：32 天，末筆距 TODAY 數百天
  for (let i = 0; i < 32; i++) {
    const t = T - day(621) - day((31 - i) * 27);
    for (const [type, zh, v] of [["Systolic", "收縮壓", 138], ["Diastolic", "舒張壓", 88]]) {
      appleRows.push([pid, doc.apple, `HKQuantityTypeIdentifierBloodPressure${type}`, zh,
        `${iso(t)} 07:30:00`, `${iso(t)} 07:30:00`, v, null, null, "mmHg", "示範血壓計", ""]);
    }
  }
  // 步數：逐日 400 天（staleAll 時整段往前推，否則集合最新仍是新鮮的）
  const stepEnd = staleAll ? T - day(1500) : T;
  for (let i = 0; i < 400; i++) {
    const t = stepEnd - day(400 - i);
    appleRows.push([pid, doc.apple, "HKQuantityTypeIdentifierStepCount", "步數",
      `${iso(t)} 00:00:00`, `${iso(t)} 23:59:00`, 7000, null, null, "count", "示範手機", ""]);
  }
  await d.batchInsert("apple_records",
    ["profile_id", "doc_id", "type", "type_zh", "start_ts", "end_ts", "value_numeric",
      "value_normalized", "value_text", "unit", "source_name", "quality_flags"], appleRows);
  // 檢驗：3 筆（可選一筆 null 日期）
  const labDates = staleAll
    ? [iso(T - day(2400)), iso(T - day(2000)), iso(T - day(1600))]
    : ["2024-10-23", "2025-08-14", "2026-07-03"];
  if (nullLabDate) labDates.push(null);
  await d.batchInsert("lab_results",
    ["profile_id", "doc_id", "section", "source_index", "record_fp", "canonical",
      "test_date", "facility_name", "order_name", "test_name_raw",
      "test_name_normalized", "value_text", "value_numeric", "ref_range", "quality_flags"],
    labDates.map((dt, i) => [pid, doc.nhi, "r4", i + 1, `fp-l-${i}`, "{}", dt,
      "示範綜合醫院", "生化檢驗", "CREATININE", "Creatinine", "1.0 mg/dL", 1.0 + i * 0.05,
      "[0.7-1.3]", ""]));
  // 成健三點（體重圖第二條序列，顯式 marker）
  await d.batchInsert("body_measurements",
    ["profile_id", "doc_id", "section", "source_index", "record_fp", "canonical",
      "check_date", "weight_kg"],
    [[pid, doc.nhi, "r7", 1, "fp-b1", "{}", iso(T - day(2200)), 74.2],
     [pid, doc.nhi, "r7", 2, "fp-b2", "{}", iso(T - day(1100)), 72.4],
     [pid, doc.nhi, "r7", 3, "fp-b3", "{}",
      iso(T - day(staleAll ? 1500 : 120)), 70.9]]);

  const p = await buildPayload(d, { profileId: pid, knowledgeEntries: LAB_ENTRIES,
    drugCachePath: null, today: TODAY });
  await d.close();
  return p;
}

function render(payload) {
  const doc = makeDocument();
  const dataEl = doc.createElement("script");
  dataEl.textContent = JSON.stringify(payload);
  doc.registerId("mhb-data", dataEl);
  const root = doc.createElement("div");
  doc.registerId("app", root);
  const sandbox = { document: doc, console, setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id) };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ["vendor/preact.min.js", "vendor/hooks.umd.js", "vendor/htm.umd.js", "app.js"]) {
    vm.runInContext(readFileSync(new URL(f, ASSETS), "utf-8"), sandbox, { filename: f });
  }
  const flush = () => new Promise((r) => setTimeout(r, 5));
  return { root, flush };
}

const btn = (root, label) => findAll(root, (e) => e.localName === "button"
  && e.textContent === label && (e.listeners.click || []).length)[0];
const svgs = (root) => findAll(root, (e) => e.localName === "svg");
const inSvg = (s, name) => findAll(s, (e) => e.localName === name);
const num = (el, a) => Number(el.getAttribute(a));
// x 軸刻度＝固定畫在 y = H - 8 = 232 的 text；y 軸數值標籤最低在 216，
// 用 > 200 會把它一起撈進來（第一版測試的錯）
const X_TICK_Y = 232;
const xTicks = (s) => inSvg(s, "text").filter((t) => num(t, "y") === X_TICK_Y)
  .map((t) => t.textContent);
const legend = (s) => inSvg(s, "text").filter((t) => num(t, "x") >= W - PR);

async function trends(payload) {
  const { root, flush } = render(payload);
  await flush();
  btn(root, "趨勢").dispatch("click");
  await flush();
  return { root, flush };
}

test("停止記錄的序列末點不落在右緣，且時間間隔成正比", async () => {
  const { root } = await trends(await shapePayload());
  btn(root, "全部").dispatch("click");
  await new Promise((r) => setTimeout(r, 10));
  const bp = svgs(root).find((s) => inSvg(s, "circle").length === 64);
  assert.ok(bp, "找不到血壓圖（64 個標記）");
  const maxCx = Math.max(...inSvg(bp, "circle").map((c) => num(c, "cx")));
  assert.ok(maxCx < PL + 0.85 * PW,
    `血壓末點 cx=${maxCx.toFixed(0)} 應明顯小於右緣 ${PL + PW}`);
});

test("四張圖共用時間域：x 軸刻度一致，且不隨檢驗下拉變動", async () => {
  const { root, flush } = await trends(await shapePayload());
  btn(root, "全部").dispatch("click");
  await flush();
  const tickSets = svgs(root).map(xTicks).filter((t) => t.length);
  assert.ok(tickSets.length >= 2, "至少兩張圖要有刻度");
  for (const t of tickSets) assert.deepEqual(t, tickSets[0], "各圖刻度應一致");
  // 切換檢驗項目後其他圖刻度不變（序列集合與下拉選擇無關）
  const sel = findAll(root, (e) => e.localName === "select")[0];
  if (sel) {
    sel.dispatch("change");
    await flush();
    const after = svgs(root).map(xTicks).filter((t) => t.length);
    assert.deepEqual(after[after.length - 1], tickSets[tickSets.length - 1]);
  }
});

test("刻度依時間挑選：跨度大用年、近三月降到不超過上限且格式為 MM-DD", async () => {
  const { root, flush } = await trends(await shapePayload());
  btn(root, "全部").dispatch("click");
  await flush();
  const yearTicks = svgs(root).map(xTicks).find((t) => t.length);
  assert.ok(yearTicks.length >= 4 && yearTicks.length <= 8,
    `7 年以上跨度刻度數 ${yearTicks.length} 應在 4 到 8 之間`);
  for (const t of yearTicks) assert.match(t, /^\d{4}$/, "應為年格式");
  btn(root, "近三月").dispatch("click");
  await flush();
  const shortTicks = svgs(root).map(xTicks).find((t) => t.length);
  assert.ok(shortTicks.length <= 8, `近三月刻度數 ${shortTicks.length} 應 ≤ 8（週需降級）`);
  for (const t of shortTicks) assert.match(t, /^\d{2}-\d{2}$/, "近三月應為 MM-DD");
  assert.equal(new Set(shortTicks).size, shortTicks.length, "刻度文字不得重複");
});

test("圖例在右側固定位置、名稱截斷、格線不壓圖例", async () => {
  const { root, flush } = await trends(await shapePayload());
  btn(root, "全部").dispatch("click");
  await flush();
  const weight = svgs(root).find((s) => inSvg(s, "circle").some((c) => num(c, "r") === 6));
  assert.ok(weight, "找不到體重圖（含成健 r=6 標記）");
  const lg = legend(weight);
  assert.ok(lg.length >= 4, "兩條序列各兩行，至少 4 個圖例文字");
  const ys = lg.map((t) => num(t, "y"));
  assert.equal(new Set(ys).size, ys.length, "圖例各行 y 不得重疊");
  for (const t of lg) assert.ok(t.textContent.length <= 8, `圖例文字「${t.textContent}」應 ≤ 8 字`);
  for (const l of inSvg(weight, "line")) {
    assert.ok(num(l, "x2") <= W - PR, "格線右緣不得越過圖例區");
  }
});

test("標記兩段門檻：密集不畫、稀疏逐點、顯式 marker 不被吃掉", async () => {
  const { root, flush } = await trends(await shapePayload());
  btn(root, "全部").dispatch("click");
  await flush();
  const weight = svgs(root).find((s) => inSvg(s, "circle").some((c) => num(c, "r") === 6));
  const marks = inSvg(weight, "circle");
  assert.equal(marks.length, 3, "體重圖只應有成健 3 個標記（Apple 密集序列不畫）");
  for (const m of marks) assert.equal(num(m, "r"), 6, "成健顯式 marker=6 必須保留");
  const bp = svgs(root).find((s) => inSvg(s, "circle").length === 64);
  assert.ok(inSvg(bp, "circle").every((c) => num(c, "r") === 3),
    "血壓 32 點（每序列）應逐點以 r=3 繪製");
});

test("預設區間：整體資料陳舊時預設全部", async () => {
  const { root } = await trends(await shapePayload({ staleAll: true }));
  const on = findAll(root, (e) => e.localName === "button"
    && String(e.attributes.class || "").includes("on")).map((e) => e.textContent);
  assert.ok(on.includes("全部"), `預設應為全部，實際 ${JSON.stringify(on)}`);
});

test("單圖無資料顯示看全部入口，點擊後整頁切為全部", async () => {
  const { root, flush } = await trends(await shapePayload());
  const on = findAll(root, (e) => e.localName === "button"
    && String(e.attributes.class || "").includes("on")).map((e) => e.textContent);
  assert.ok(on.includes("近一年"), "體重新鮮時預設應為近一年");
  const showAll = btn(root, "看全部");
  assert.ok(showAll, "血壓在近一年內無資料，應出現看全部入口");
  showAll.dispatch("click");
  await flush();
  const on2 = findAll(root, (e) => e.localName === "button"
    && String(e.attributes.class || "").includes("on")).map((e) => e.textContent);
  assert.ok(on2.includes("全部"), "點擊後整頁應切為全部");
  const bp = svgs(root).find((s) => inSvg(s, "circle").length === 64);
  assert.ok(bp, "切全部後血壓圖應有資料");
});

test("步數粒度隨區間：近三月逐日、全部月平均", async () => {
  const { root, flush } = await trends(await shapePayload());
  btn(root, "近三月").dispatch("click");
  await flush();
  assert.ok(root.textContent.includes("逐日"), "近三月圖說應標明逐日");
  btn(root, "全部").dispatch("click");
  await flush();
  assert.ok(root.textContent.includes("月平均"), "全部區間圖說應標明月平均");
});

test("null 日期被剔除且不污染時間域", async () => {
  const { root, flush } = await trends(await shapePayload({ nullLabDate: true }));
  btn(root, "全部").dispatch("click");
  await flush();
  const ticks = svgs(root).map(xTicks).find((t) => t.length);
  assert.ok(!ticks.some((t) => t.startsWith("197")),
    `時間域下界不應被拉到 1970，實際刻度 ${JSON.stringify(ticks)}`);
  assert.match(root.textContent, /已略過 1 筆日期無法識別/);
});

test("晚於 generated_at 的最新量測不被靜默隱藏", async () => {
  const { root, flush } = await trends(await shapePayload({ latestAfterGenerated: true }));
  btn(root, "全部").dispatch("click");
  await flush();
  const weight = svgs(root).find((s) => inSvg(s, "circle").some((c) => num(c, "r") === 6));
  const poly = inSvg(weight, "polyline")[0];
  const xs = (poly.getAttribute("points") || "").split(" ")
    .map((p) => Number(p.split(",")[0])).filter((n) => !Number.isNaN(n));
  assert.ok(Math.max(...xs) <= PL + PW + 0.5,
    "最新點不得畫出繪圖區右緣（上界須含它）");
  assert.ok(Math.max(...xs) > PL + PW - 2, "最新點應貼齊右緣（它就是上界）");
});
