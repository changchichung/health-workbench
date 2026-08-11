// Viewer 全分頁渲染守衛（2026-08-11 v0.5.0 冒煙發現：只匯健保時
// 趨勢頁 LineChart 對空序列拋錯，整個 preact 樹死掉，所有分頁空白）。
// 用最小 DOM shim 跑 vendored preact 真渲染：對「單一來源」payload
// （健保 only／Apple only）逐分頁點擊，斷言內容渲染成功且不落入
// 錯誤邊界；再驗證「造訪趨勢後回總覽」不全滅。
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
import { appleHealthAdapter } from "../../src/adapters/apple_health.js";
import { buildPayload } from "../../src/provider/payload.js";
import { nodeFileSource } from "../helpers/node_source.mjs";
import { makeDocument, findAll } from "../helpers/mini_dom.mjs";

const REPO = new URL("../../..", import.meta.url).pathname;
const ASSETS = new URL("../../src/viewer/assets/", import.meta.url);
const LAB_ENTRIES = JSON.parse(
  readFileSync(new URL("../../src/knowledge/labs.json", import.meta.url), "utf-8"));

async function singleSourcePayload(kind) {
  const tmp = mkdtempSync(path.join(tmpdir(), "mhb-vr-"));
  const d = new NodeDriver(path.join(tmp, "db.sqlite"));
  await initSchema(d);
  const pid = await createProfile(d, "測試成員");
  if (kind === "nhi") {
    await nhiJsonAdapter.importSource(
      { bytes: new Uint8Array(readFileSync(`${REPO}/tests/fixtures/nhi_sample.json`)),
        name: "nhi_sample.json" },
      d, null, { labEntries: LAB_ENTRIES, profileId: pid });
  } else {
    await appleHealthAdapter.importSource(
      await nodeFileSource(`${REPO}/tests/fixtures/apple_sample.xml`), d, null,
      { profileId: pid });
  }
  const p = await buildPayload(d, { profileId: pid,
    knowledgeEntries: LAB_ENTRIES, drugCachePath: null, today: "2026-08-11" });
  await d.close();
  return p;
}

/* 在 vm sandbox 中載入 vendor + app.js，回傳 { root, flush } */
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
  for (const f of ["vendor/preact.min.js", "vendor/hooks.umd.js", "vendor/htm.umd.js", "app.js"]) {
    vm.runInContext(readFileSync(new URL(f, ASSETS), "utf-8"), sandbox, { filename: f });
  }
  // preact 重渲染排在 microtask、effects 排在 rAF(=setTimeout)；雙重讓步沖乾淨
  const flush = () => new Promise((r) => setTimeout(r, 5));
  return { root, flush };
}

const tabButton = (root, label) => findAll(root,
  (el) => el.localName === "button" && el.textContent === label
    && (el.listeners.click || []).length)[0];

for (const kind of ["nhi", "apple"]) {
  test(`viewer 單一來源（${kind}）：四分頁渲染皆成功，趨勢後回總覽不全滅`, async () => {
    const payload = await singleSourcePayload(kind);
    const { root, flush } = renderViewer(payload);
    await flush();
    assert.ok(root.textContent.includes("個人健康資料工作台"), "初始渲染失敗");

    const EXPECT = { "總覽": "資料庫與匯入紀錄", "就醫時間軸": "全部類型",
      "用藥": "藥品", "趨勢": "檢驗趨勢" };
    for (const [label, marker] of Object.entries(EXPECT)) {
      const btn = tabButton(root, label);
      assert.ok(btn, `找不到分頁按鈕：${label}`);
      btn.dispatch("click");
      await flush();
      const text = root.textContent;
      assert.ok(!text.includes("分頁載入失敗"),
        `${label} 落入錯誤邊界：${text.slice(0, 200)}`);
      assert.ok(text.includes(marker), `${label} 內容缺關鍵字「${marker}」`);
    }

    // 症狀回歸：造訪趨勢之後，總覽必須還活著（渲染樹未死）
    tabButton(root, "總覽").dispatch("click");
    await flush();
    assert.ok(root.textContent.includes("資料庫與匯入紀錄"),
      "造訪趨勢後回總覽全滅（渲染樹已死）");
  });
}

test("viewer 錯誤邊界：單頁拋錯只該頁顯示錯誤，其他分頁不陪葬", async () => {
  const payload = await singleSourcePayload("nhi");
  // 蓄意破壞趨勢頁的資料前提（knowledge 設為 null → Trends 讀取即拋錯），
  // 驗證邊界攔截與換頁復原。
  payload.knowledge = null;
  const { root, flush } = renderViewer(payload);
  await flush();
  tabButton(root, "趨勢").dispatch("click");
  await flush();
  assert.ok(root.textContent.includes("分頁載入失敗"), "錯誤邊界未攔截");
  tabButton(root, "總覽").dispatch("click");
  await flush();
  assert.ok(root.textContent.includes("資料庫與匯入紀錄"), "換頁未復原");
});
