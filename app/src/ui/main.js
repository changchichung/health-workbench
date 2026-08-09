// App 前端入口。Tauri API 走 withGlobalTauri（window.__TAURI__），
// 引擎模組（engine/、adapters/、store/）維持純 ESM，Node 測試可直接 import。
import { maybeRunSpike } from "./spike.js";
import { TauriDriver } from "../store/tauri_driver.js";
import { initSchema, SCHEMA_VERSION } from "../store/schema.js";
import { resolveDbPath, importExistingDb } from "../store/location.js";
import { createImportFlow } from "./import_flow.js";

const statusEl = document.getElementById("status");
const app = { driver: null, dbPath: null, flow: null };

async function tableCounts(driver) {
  const tables = ["encounters", "medications", "lab_results", "apple_records"];
  const out = {};
  for (const t of tables) {
    const [{ c }] = await driver.select(`SELECT count(*) c FROM ${t}`);
    out[t] = c;
  }
  return out;
}

async function refreshStatus() {
  const counts = await tableCounts(app.driver);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  statusEl.textContent = total === 0
    ? `尚無資料。請匯入健保存摺或 Apple 健康匯出檔。（資料庫：${app.dbPath}）`
    : `資料庫：${app.dbPath}｜就醫 ${counts.encounters}、用藥 ${counts.medications}、檢驗 ${counts.lab_results}、Apple ${counts.apple_records}`;
  return counts;
}

async function boot() {
  const { path, overridden } = await resolveDbPath();
  app.dbPath = path;
  const dir = path.replace(/[/\\][^/\\]+$/, "");
  await window.__TAURI__.fs.mkdir(dir, { recursive: true }).catch(() => {});
  app.driver = await TauriDriver.open(path);
  await initSchema(app.driver);
  const counts = await refreshStatus();
  return { path, overridden, counts };
}

// 「匯入既有資料庫檔」：選檔 → 驗版本 → 關主庫 → 複製 → 重開＋遷移
async function importExisting(srcPath) {
  await app.driver.close();
  try {
    const r = await importExistingDb(srcPath, app.dbPath,
      TauriDriver.open, SCHEMA_VERSION);
    if (!r.ok) {
      statusEl.textContent = r.reason === "too_new"
        ? `此資料庫版本（${r.version}）較新，請更新 App 後再匯入`
        : "所選檔案不是本工具的資料庫檔";
    }
    return r;
  } finally {
    app.driver = await TauriDriver.open(app.dbPath);
    await initSchema(app.driver);
    if (app.flow) await refreshStatus().catch(() => {});
  }
}

async function loadLabEntries() {
  const res = await fetch("./knowledge/labs.json");
  return res.json();
}

function dialogOpen(opts) {
  const dialog = window.__TAURI__.dialog;
  const open = dialog.open || dialog.default?.open;
  return open(opts);
}

async function wireUi() {
  app.flow = createImportFlow({
    getDriver: () => app.driver,
    labEntries: await loadLabEntries(),
    onImported: () => refreshStatus(),
  });

  document.getElementById("pick-file-btn").addEventListener("click", async () => {
    const p = await dialogOpen({ multiple: false, title: "選擇健保存摺或 Apple 健康匯出檔" });
    if (p) await app.flow.offerFile(p);
  });
  document.getElementById("pick-dir-btn").addEventListener("click", async () => {
    const p = await dialogOpen({ directory: true, title: "選擇 apple_health_export 資料夾" });
    if (p) await app.flow.offerFile(p);
  });
  document.getElementById("import-db-btn").addEventListener("click", async () => {
    const p = await dialogOpen({ multiple: false, title: "選擇既有的 mhb.sqlite" });
    if (p) await importExisting(p);
  });

  // 原生拖放（Tauri drag-drop 事件；HTML5 drop 在 Tauri 內拿不到路徑）
  const { listen } = window.__TAURI__.event;
  await listen("tauri://drag-enter", () => document.body.classList.add("dragover"));
  await listen("tauri://drag-leave", () => document.body.classList.remove("dragover"));
  await listen("tauri://drag-drop", async (e) => {
    document.body.classList.remove("dragover");
    const paths = e.payload?.paths ?? [];
    if (paths.length) await app.flow.offerFile(paths[0]);
  });
}

if (window.__TAURI__) {
  boot()
    .then(async (info) => {
      await wireUi();
      await maybeRunSpike(statusEl, {
        app, boot, importExisting, bootInfo: info,
        flow: app.flow, refreshStatus,
      });
    })
    .catch((err) => { statusEl.textContent = `啟動失敗：${err.message || err}`; });
} else {
  statusEl.textContent = "非 Tauri 環境（瀏覽器預覽模式）。";
}
