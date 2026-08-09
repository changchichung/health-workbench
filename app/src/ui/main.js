// App 前端入口。Tauri API 走 withGlobalTauri（window.__TAURI__），
// 引擎模組（engine/、adapters/、store/）維持純 ESM，Node 測試可直接 import。
import { maybeRunSpike } from "./spike.js";
import { TauriDriver } from "../store/tauri_driver.js";
import { initSchema, SCHEMA_VERSION } from "../store/schema.js";
import { resolveDbPath, importExistingDb } from "../store/location.js";

const statusEl = document.getElementById("status");
const app = { driver: null, dbPath: null };

async function tableCounts(driver) {
  const tables = ["encounters", "medications", "lab_results", "apple_records"];
  const out = {};
  for (const t of tables) {
    const [{ c }] = await driver.select(`SELECT count(*) c FROM ${t}`);
    out[t] = c;
  }
  return out;
}

async function boot() {
  const { path, overridden } = await resolveDbPath();
  app.dbPath = path;
  const dir = path.replace(/[/\\][^/\\]+$/, "");
  await window.__TAURI__.fs.mkdir(dir, { recursive: true }).catch(() => {});
  app.driver = await TauriDriver.open(path);
  await initSchema(app.driver);
  const counts = await tableCounts(app.driver);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  statusEl.textContent = total === 0
    ? `尚無資料。請匯入健保存摺或 Apple 健康匯出檔。（資料庫：${path}${overridden ? "，環境變數覆寫" : ""}）`
    : `資料庫：${path}｜就醫 ${counts.encounters}、用藥 ${counts.medications}、檢驗 ${counts.lab_results}、Apple ${counts.apple_records}`;
  return { path, overridden, counts };
}

// 「匯入既有資料庫檔」：選檔 → 驗版本 → 關主庫 → 複製 → 重開＋遷移
async function importExisting(srcPath) {
  await app.driver.close();
  try {
    const r = await importExistingDb(srcPath, app.dbPath,
      TauriDriver.open, SCHEMA_VERSION);
    if (!r.ok) {
      const msg = r.reason === "too_new"
        ? `此資料庫版本（${r.version}）較新，請更新 App 後再匯入`
        : "所選檔案不是本工具的資料庫檔";
      statusEl.textContent = msg;
      return r;
    }
    return r;
  } finally {
    app.driver = await TauriDriver.open(app.dbPath);
    await initSchema(app.driver);
    await boot().catch(() => {});
  }
}

document.getElementById("import-db-btn")?.addEventListener("click", async () => {
  const dialog = window.__TAURI__.dialog;
  const open = dialog.open || dialog.default?.open;
  const src = await open({ multiple: false, title: "選擇既有的 mhb.sqlite" });
  if (src) await importExisting(src);
});

if (window.__TAURI__) {
  boot()
    .then((info) => maybeRunSpike(statusEl, { app, boot, importExisting, bootInfo: info }))
    .catch((err) => { statusEl.textContent = `啟動失敗：${err.message || err}`; });
} else {
  statusEl.textContent = "非 Tauri 環境（瀏覽器預覽模式）。";
}
