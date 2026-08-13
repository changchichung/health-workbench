// 睡眠呼吸分頁的真渲染守衛（change cpap-sleep-therapy 第 5 組）。
// 沿用 viewer_render 的 vm sandbox 手法：跑 vendored preact + app.js 真渲染。
// 重點有二：(1) 有 CPAP 資料時各區塊確實出現；(2) 沒有 CPAP 資料時
// 不留下任何空分頁或空卡片（proposal 的相容性要求）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { createProfile } from "../../src/engine/profiles.js";
import { nhiJsonAdapter } from "../../src/adapters/nhi_json.js";
import { resmedEdfAdapter } from "../../src/adapters/resmed_edf.js";
import { buildPayload } from "../../src/provider/payload.js";
import { makeDocument, findAll } from "../helpers/mini_dom.mjs";
import { makeEdf, annotationRecord, STR_SIGNALS, SAD_SIGNALS, EVE_SIGNALS }
  from "../helpers/make_edf.mjs";

const REPO = new URL("../../..", import.meta.url).pathname;
const ASSETS = new URL("../../src/viewer/assets/", import.meta.url);
const LAB_ENTRIES = JSON.parse(
  readFileSync(new URL("../../src/knowledge/labs.json", import.meta.url), "utf-8"));

const memSource = (bytes, name) => ({
  name, size: bytes.length,
  async readAt(o, l) { return bytes.subarray(o, o + l); },
  async *stream() { yield bytes; },
});
const textSource = (t, n) => memSource(new TextEncoder().encode(t), n);

function day({ ahi = 24, ai = 24, hi = 0, dur = 170 } = {}) {
  const map = {
    "Mask On": [600], "Mask Off": [780], "Mask Dur": [dur],
    "Therapy Pres Me": [372], "Leak 95": [5], AHI: [ahi], AI: [ai], HI: [hi],
  };
  return STR_SIGNALS.map(s => map[s.label] ?? []);
}

// today 取在資料之後，讓預設區間邏輯走「全部」（資料已停數年）
const TODAY = "2026-08-13";

async function cpapPayload({ withOximetry = false } = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), "mhb-sleep-"));
  const d = new NodeDriver(path.join(tmp, "db.sqlite"));
  await initSchema(d);
  const pid = await createProfile(d, "測試成員");
  // 併一份健保資料，確保 CPAP 區塊與既有分頁並存時都正常
  await nhiJsonAdapter.importSource(
    { bytes: new Uint8Array(readFileSync(`${REPO}/tests/fixtures/nhi_sample.json`)),
      name: "nhi_sample.json" },
    d, null, { labEntries: LAB_ENTRIES, profileId: pid });

  const entries = [
    { relPath: "Identification.tgt",
      source: textSource("#PNA     S9_AutoSet\n", "Identification.tgt") },
    { relPath: "STR.edf", source: memSource(
      makeEdf(STR_SIGNALS, [day(), day({ ahi: 51 }), day({ ahi: 6 })],
        { startDate: "27.03.22" }), "STR.edf") },
    { relPath: "DATALOG/20220327_203533_EVE.edf", source: memSource((() => {
      const byteLen = EVE_SIGNALS[0].nsamp * 2;
      const evs = [
        { onset: 115, duration: 11, label: "Obstructive Apnea" },
        { onset: 900, duration: 14, label: "Central Apnea" },
      ];
      const recs = evs.map(e => annotationRecord(byteLen, 0, [e]));
      return makeEdf(EVE_SIGNALS, recs.map(() => [[]]),
        { reserved: "EDF+D", recordDuration: 0, annotationBytes: { 0: recs },
          startDate: "27.03.22", startTime: "20.35.33" });
    })(), "e.edf") },
  ];
  if (withOximetry) {
    entries.push({ relPath: "DATALOG/20220327_203536_SAD.edf", source: memSource(
      makeEdf(SAD_SIGNALS, [[new Array(60).fill(70), new Array(60).fill(93)]],
        { recordDuration: 60, startDate: "27.03.22", startTime: "20.35.36" }), "s.edf") });
  }
  await resmedEdfAdapter.importSourceSet({ rootName: "resmed", entries }, d, null,
    { profileId: pid });

  const p = await buildPayload(d, { profileId: pid,
    knowledgeEntries: LAB_ENTRIES, drugCachePath: null, today: TODAY });
  await d.close();
  return p;
}

async function nhiOnlyPayload() {
  const tmp = mkdtempSync(path.join(tmpdir(), "mhb-sleep0-"));
  const d = new NodeDriver(path.join(tmp, "db.sqlite"));
  await initSchema(d);
  const pid = await createProfile(d, "測試成員");
  await nhiJsonAdapter.importSource(
    { bytes: new Uint8Array(readFileSync(`${REPO}/tests/fixtures/nhi_sample.json`)),
      name: "nhi_sample.json" },
    d, null, { labEntries: LAB_ENTRIES, profileId: pid });
  const p = await buildPayload(d, { profileId: pid,
    knowledgeEntries: LAB_ENTRIES, drugCachePath: null, today: TODAY });
  await d.close();
  return p;
}

function renderViewer(payload) {
  const doc = makeDocument();
  const dataEl = doc.createElement("script");
  dataEl.textContent = JSON.stringify(payload);
  doc.registerId("mhb-data", dataEl);
  const root = doc.createElement("div");
  doc.registerId("app", root);
  const sandbox = {
    document: doc, console,
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ["vendor/preact.min.js", "vendor/hooks.umd.js",
    "vendor/htm.umd.js", "app.js"]) {
    vm.runInContext(readFileSync(new URL(f, ASSETS), "utf-8"), sandbox, { filename: f });
  }
  const flush = () => new Promise((r) => setTimeout(r, 5));
  return { root, flush };
}

const tabButton = (root, label) => findAll(root,
  (el) => el.localName === "button" && el.textContent === label
    && (el.listeners.click || []).length)[0];

test("有 CPAP 資料：分頁出現，各區塊渲染成功且不落入錯誤邊界", async () => {
  const payload = await cpapPayload({ withOximetry: true });
  assert.equal(payload.cpap.daily.length, 3, "payload 帶有每日摘要");
  const { root, flush } = renderViewer(payload);
  await flush();

  const btn = tabButton(root, "睡眠呼吸");
  assert.ok(btn, "有 CPAP 資料時必須出現睡眠呼吸分頁");
  btn.dispatch("click");
  await flush();
  const text = root.textContent;
  assert.ok(!text.includes("分頁載入失敗"), `落入錯誤邊界：${text.slice(0, 200)}`);
  for (const marker of ["每晚 AHI", "使用時數", "漏氣（95 百分位）",
    "治療壓力（95 百分位）", "睡眠期血氧", "呼吸事件"]) {
    assert.ok(text.includes(marker), `缺區塊「${marker}」`);
  }
  assert.ok(text.includes("S9_AutoSet"), "顯示機型");
  assert.ok(text.includes("日期為入睡當晚"), "標注日期語意（正午邊界）");
  assert.ok(text.includes("Obstructive Apnea"), "事件明細表列出事件");
  // 折線有實際座標（不是空圖）
  const circles = findAll(root, (el) => el.localName === "circle");
  const polylines = findAll(root, (el) => el.localName === "polyline");
  assert.ok(polylines.length > 0 || circles.length > 0, "AHI 圖沒有畫出任何內容");
});

test("有 CPAP 資料：總覽卡與趨勢頁 AHI 圖出現", async () => {
  const payload = await cpapPayload();
  const { root, flush } = renderViewer(payload);
  await flush();
  assert.ok(root.textContent.includes("睡眠呼吸（最近一晚）"), "總覽缺 CPAP 卡");
  assert.ok(root.textContent.includes("睡眠呼吸 3 晚"), "匯入紀錄摘要缺 CPAP 晚數");

  tabButton(root, "趨勢").dispatch("click");
  await flush();
  const text = root.textContent;
  assert.ok(!text.includes("分頁載入失敗"), "趨勢頁落入錯誤邊界");
  assert.ok(text.includes("每晚 AHI（睡眠呼吸）"), "趨勢頁缺 AHI 對照圖");
  assert.ok(text.includes("可直接同期對照"), "缺同期對照說明");
});

test("沒有 CPAP 資料：不出現分頁、總覽卡與趨勢圖（不留空區塊）", async () => {
  const payload = await nhiOnlyPayload();
  assert.deepEqual(payload.cpap.daily, [], "payload 的 CPAP 區塊為空");
  const { root, flush } = renderViewer(payload);
  await flush();

  assert.equal(tabButton(root, "睡眠呼吸"), undefined,
    "沒有 CPAP 資料時不得出現睡眠呼吸分頁");
  assert.ok(!root.textContent.includes("睡眠呼吸（最近一晚）"),
    "沒有 CPAP 資料時不得出現總覽卡");

  tabButton(root, "趨勢").dispatch("click");
  await flush();
  const text = root.textContent;
  assert.ok(!text.includes("分頁載入失敗"), "趨勢頁落入錯誤邊界");
  assert.ok(!text.includes("每晚 AHI"), "沒有 CPAP 資料時趨勢頁不得出現 AHI 圖");
  assert.ok(text.includes("檢驗趨勢"), "既有內容仍在");
});

test("沒有血氧資料：說明原因而不是畫一張空圖", async () => {
  // 真實素材的形狀：有每日摘要與事件，但機器未接血氧模組
  const payload = await cpapPayload({ withOximetry: false });
  assert.deepEqual(payload.cpap.oximetry, []);
  const { root, flush } = renderViewer(payload);
  await flush();
  tabButton(root, "睡眠呼吸").dispatch("click");
  await flush();
  const text = root.textContent;
  assert.ok(text.includes("此來源沒有血氧資料"), "缺空狀態說明");
  assert.ok(text.includes("外接血氧模組"), "未說明原因");
});

test("匯入紀錄：多檔來源摺疊成一行，可展開看逐檔", async () => {
  const payload = await cpapPayload({ withOximetry: true });
  // payload 保留逐檔追溯（design D2）
  const cpapDocs = payload.meta.sources.filter(s => s.adapter === "resmed_edf");
  assert.equal(cpapDocs.length, 3, "payload 保留每個被解析的檔");

  const { root, flush } = renderViewer(payload);
  await flush();
  const text = root.textContent;
  assert.ok(text.includes("3 個檔案"), "多檔來源未摺疊成一行");
  assert.ok(text.includes("CPAP（ResMed）"), "來源欄未顯示中文來源名");
  // 摺疊後逐檔仍在 DOM 內（details 展開即見）
  assert.ok(text.includes("STR.edf"), "展開內容缺逐檔檔名");
  // 合計統計：三個檔的新增筆數應被加總後呈現
  assert.ok(text.includes("睡眠每日摘要 +3"), `缺合計統計：${text.slice(0, 300)}`);
});

test("趨勢頁時間域涵蓋 CPAP 日期（不納入的話新圖會被壓到邊界）", async () => {
  // CPAP 資料（2022-03）早於健保 fixture 的任何日期。若 trendBounds 的
  // groups 沒有納入 CPAP 序列，共用時間域就不會涵蓋 2022，x 軸刻度也不會
  // 出現該年份，AHI 圖的點會全部被 clamp 到繪圖區左緣。
  const payload = await cpapPayload();
  const others = [
    ...payload.labs.map(l => l.test_date),
    ...(payload.measures["體重"] || []).map(p => p[0]),
    ...payload.encounters.map(e => e.date),
  ].filter(Boolean);
  const cpapEarliest = payload.cpap.daily[0].date;
  assert.ok(others.every(d => d > cpapEarliest),
    `前提不成立：CPAP 起始 ${cpapEarliest} 必須早於其他所有資料`);

  const ticks = async (p) => {
    const { root, flush } = renderViewer(p);
    await flush();
    tabButton(root, "趨勢").dispatch("click");
    await flush();
    return findAll(root, (el) => el.localName === "text").map(el => el.textContent);
  };
  // 納入 CPAP 後時間域自 2022 起，會跨過 2023 的年界；只有健保資料時
  // （2025 起）不可能出現 2023 刻度。兩個方向都驗，避免斷言恆真。
  const withCpap = await ticks(payload);
  assert.ok(withCpap.some(t => t === "2023"),
    `時間域未納入 CPAP 日期，x 軸缺 2023 刻度：${[...new Set(withCpap)].join(",")}`);
  const without = await ticks(await nhiOnlyPayload());
  assert.ok(!without.some(t => t === "2023"),
    "前提不成立：沒有 CPAP 時本來就不該出現 2023 刻度");
});

// task 6.3：匯出的單檔 HTML 必須涵蓋新區塊。檢視器與匯出共用同一份
// app.js 與 payload，但仍要驗證組裝後的產物真的帶著它們（契約若被改窄，
// 或組裝時漏掉區塊，只會在使用者打開匯出檔時才發現）。
import { assemble, validateShape, SIZE_LIMIT } from "../../src/provider/assemble.js";

test("匯出單檔 HTML：涵蓋 CPAP 區塊且通過契約與體積門檻", async () => {
  const payload = await cpapPayload({ withOximetry: true });
  assert.deepEqual(validateShape(payload), [], "payload 不符契約");

  const assets = {
    appJs: readFileSync(new URL("app.js", ASSETS), "utf-8"),
    css: readFileSync(new URL("style.css", ASSETS), "utf-8"),
    vendor: ["preact.min.js", "hooks.umd.js", "htm.umd.js"].map(
      f => readFileSync(new URL(`vendor/${f}`, ASSETS), "utf-8")),
  };
  const html = assemble(payload, assets);
  assert.ok(html.length < SIZE_LIMIT, "超出單檔體積門檻");

  // 嵌入資料帶著 CPAP（注意 assemble 會跳脫 < > &，故比對鍵名而非整段）
  const embedded = JSON.parse(
    html.match(/<script type="application\/json" id="mhb-data">(.*?)<\/script>/s)[1]
      .replaceAll("\\u003c", "<").replaceAll("\\u003e", ">").replaceAll("\\u0026", "&"));
  assert.equal(embedded.cpap.daily.length, payload.cpap.daily.length);
  assert.ok(embedded.cpap.events.length > 0, "匯出檔缺呼吸事件");
  // 檢視程式碼帶著睡眠分頁
  assert.ok(html.includes("睡眠呼吸"), "匯出檔的程式碼缺睡眠呼吸分頁");
  assert.ok(html.includes("此來源沒有血氧資料"), "匯出檔缺血氧空狀態文案");
});

test("匯出單檔 HTML：沒有 CPAP 資料時仍是合法產物", async () => {
  const payload = await nhiOnlyPayload();
  assert.deepEqual(validateShape(payload), [],
    "沒有 CPAP 資料時 payload 仍須符合契約（cpap 為空區塊而非缺鍵）");
  const assets = {
    appJs: readFileSync(new URL("app.js", ASSETS), "utf-8"),
    css: readFileSync(new URL("style.css", ASSETS), "utf-8"),
    vendor: ["preact.min.js", "hooks.umd.js", "htm.umd.js"].map(
      f => readFileSync(new URL(`vendor/${f}`, ASSETS), "utf-8")),
  };
  const html = assemble(payload, assets);
  assert.ok(html.length < SIZE_LIMIT);
});
