// App 前端入口。Tauri API 走 withGlobalTauri（window.__TAURI__），
// 引擎模組（engine/、adapters/、store/）維持純 ESM，Node 測試可直接 import。
// 多成員（change multi-profile-management）：currentProfileId 為單一
// 事實來源，檢視相關介面（狀態列/檢視頁）跟當前成員，匯入紀錄卡全庫。
import { TauriDriver } from "../store/tauri_driver.js";
import { initSchema, SCHEMA_VERSION } from "../store/schema.js";
import { resolveDbPath, importExistingDb } from "../store/location.js";
import { loadSettings, saveSettings, resolveCurrentProfile } from "../store/settings.js";
import { listProfiles } from "../engine/profiles.js";
import { createImportFlow } from "./import_flow.js";
import { createViewer } from "./viewer.js";
import { createHistory } from "./history.js";
import { createProfileManager } from "./profile_manager.js";

const statusEl = document.getElementById("status");
const noticeEl = document.getElementById("notice");

// 暫時性提示走獨立通知列，NEVER 覆蓋狀態列的成員統計
// （2026-08-10 走查回饋：複製連結把成員統計行蓋掉了）
let noticeTimer = null;
function notify(text, ms = 5000) {
  noticeEl.textContent = text;
  noticeEl.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, ms);
}
const app = { driver: null, dbPath: null, dbDir: null, currentProfileId: null,
  flow: null, viewer: null, history: null, manager: null };

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

async function tableCounts(driver, profileId) {
  const tables = ["encounters", "medications", "lab_results", "apple_records"];
  const out = {};
  for (const t of tables) {
    const [{ c }] = profileId == null
      ? [{ c: 0 }]
      : await driver.select(
        `SELECT count(*) c FROM ${t} WHERE profile_id=?`, [profileId]);
    out[t] = c;
  }
  return out;
}

// 狀態列＝當前成員視角（design D3）
async function refreshStatus() {
  const profiles = await listProfiles(app.driver);
  const current = profiles.find(p => p.id === app.currentProfileId) ?? null;
  if (!current) {
    statusEl.textContent = "尚無成員。請匯入健保存摺或 Apple 健康匯出檔（匯入時建立成員）。";
  } else {
    const counts = await tableCounts(app.driver, current.id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    statusEl.textContent = total === 0
      ? `成員「${current.display_name}」尚無資料。請匯入健保存摺或 Apple 健康匯出檔。`
      : `成員「${current.display_name}」：就醫 ${counts.encounters}、用藥 ${counts.medications}、`
        + `檢驗 ${counts.lab_results}、Apple ${counts.apple_records.toLocaleString()}`;
  }
  await app.history?.refresh().catch(() => {});
}

// 成員切換器（app-viewer spec：全域切換器＋管理入口）
async function refreshSwitcher() {
  const select = document.getElementById("profile-select");
  const profiles = await listProfiles(app.driver);
  if (profiles.length === 0) {
    select.innerHTML = `<option value="">尚無成員</option>`;
    select.disabled = true;
    return profiles;
  }
  select.disabled = false;
  select.innerHTML = profiles.map(p =>
    `<option value="${p.id}">${esc(p.display_name)}</option>`).join("");
  select.value = String(app.currentProfileId ?? "");
  return profiles;
}

// settings 一律讀取合併後回寫（單鍵覆寫會洗掉其他鍵，如記憶的目錄）
async function updateSettings(patch) {
  const s = await loadSettings(app.dbDir);
  await saveSettings(app.dbDir, { ...s, ...patch }).catch(() => {});
}

// 切換／成員異動後的統一收斂點：驗證 currentProfileId、存 settings、
// 刷新切換器＋狀態列＋檢視頁（匯入紀錄卡在 refreshStatus 內連帶刷新）
async function setCurrentProfile(id, { save = true } = {}) {
  const profiles = await listProfiles(app.driver);
  app.currentProfileId = resolveCurrentProfile(
    { current_profile_id: id }, profiles);
  if (save && app.currentProfileId != null) {
    await updateSettings({ current_profile_id: app.currentProfileId });
  }
  await refreshSwitcher();
  await refreshStatus();
  // 檢視刷新失敗 NEVER 靜默（2026-08-10 走查回饋 3 的診斷面）
  try {
    await app.viewer?.refresh();
  } catch (err) {
    statusEl.textContent = `檢視頁載入失敗：${String(err?.message || err)}`;
  }
}

// 對話框起始目錄：記憶上次使用的資料夾；首次開檔預設「下載項目」
// （健保/Apple 匯出檔的常見落點）、匯出預設「文件」（2026-08-10 走查回饋 2）
async function dialogStartDir(kind) {
  const t = window.__TAURI__;
  const s = await loadSettings(app.dbDir);
  const remembered = kind === "export" ? s.last_export_dir : s.last_open_dir;
  if (remembered && await t.fs.exists(remembered).catch(() => false)) {
    return remembered;
  }
  const fallback = kind === "export" ? t.path.documentDir() : t.path.downloadDir();
  return fallback.catch(() => null);
}

async function rememberDialogDir(kind, usedPath) {
  if (!usedPath) return;
  const dir = String(usedPath).replace(/[/\\][^/\\]+$/, "");
  if (!dir) return;
  await updateSettings(
    kind === "export" ? { last_export_dir: dir } : { last_open_dir: dir });
}

async function boot() {
  const { path, overridden } = await resolveDbPath();
  app.dbPath = path;
  app.dbDir = path.replace(/[/\\][^/\\]+$/, "");
  await window.__TAURI__.fs.mkdir(app.dbDir, { recursive: true }).catch(() => {});
  app.driver = await TauriDriver.open(path);
  await initSchema(app.driver);
  const profiles = await listProfiles(app.driver);
  app.currentProfileId = resolveCurrentProfile(
    await loadSettings(app.dbDir), profiles);
  return { path, overridden };
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
    if (app.flow) await setCurrentProfile(app.currentProfileId).catch(() => {});
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

function setTab(name) {
  for (const t of ["import", "viewer"]) {
    document.getElementById(`tab-${t}`).hidden = t !== name;
    document.getElementById(`tab-btn-${t}`).classList.toggle("active", t === name);
  }
}

async function wireUi() {
  const labEntries = await loadLabEntries();
  document.getElementById("tab-btn-import").addEventListener("click", () => setTab("import"));
  document.getElementById("tab-btn-viewer").addEventListener("click", () => setTab("viewer"));
  app.viewer = createViewer({
    getDriver: () => app.driver,
    getDbPath: () => app.dbPath,
    getProfileId: () => app.currentProfileId,
    getExportStartDir: () => dialogStartDir("export"),
    labEntries,
  });
  app.history = createHistory({
    getDriver: () => app.driver,
    getDbPath: () => app.dbPath,
  });
  app.manager = createProfileManager({
    getDriver: () => app.driver,
    getCurrentProfileId: () => app.currentProfileId,
    // 成員異動（新增/改名/刪除）→ 清掉過時匯入面板、重新驗證當前成員並全面刷新
    onChanged: async () => {
      app.flow?.resetPanel();
      await setCurrentProfile(app.currentProfileId);
    },
    // 進階：匯入既有資料庫檔（2026-08-10 裁示自工具列降級收進面板；
    // 用途＝換電腦搬資料、舊 CLI 庫一次性遷移）
    onImportDbFile: async () => {
      const p = await dialogOpen({ multiple: false, title: "選擇既有的 mhb.sqlite" });
      if (!p) return { ok: false, reason: "cancelled" };
      return importExisting(p);
    },
  });
  app.flow = createImportFlow({
    getDriver: () => app.driver,
    labEntries,
    // 匯入面板就地新增成員 → 切換器同步
    onProfilesChanged: async () => { await refreshSwitcher(); },
    onImported: async () => {
      await setCurrentProfile(app.currentProfileId);
      const report = document.getElementById("import-report");
      if (report && !report.querySelector("#goto-viewer-btn")) {
        const btn = document.createElement("button");
        btn.id = "goto-viewer-btn";
        btn.type = "button";
        btn.textContent = "前往資料檢視 →";
        btn.addEventListener("click", () => setTab("viewer"));
        report.prepend(btn);
      }
    },
  });
  document.getElementById("profile-select").addEventListener("change", async (e) => {
    await setCurrentProfile(Number(e.target.value));
  });
  document.getElementById("manage-profiles-btn").addEventListener("click",
    () => app.manager.open());
  document.getElementById("export-html-btn").addEventListener("click", async () => {
    const r = await app.viewer.exportHtml();
    if (r.ok) {
      await rememberDialogDir("export", r.path);
      notify(`已匯出：${r.path}（${(r.bytes / 1024).toFixed(0)}KB，含全部個資請妥善保管）`, 10000);
    }
  });

  await refreshSwitcher();
  await refreshStatus();
  const { rendered } = await app.viewer.refresh();
  setTab(rendered ? "viewer" : "import");

  document.getElementById("dropzone").addEventListener("click", async () => {
    const p = await dialogOpen({ multiple: false, title: "選擇健保存摺或 Apple 健康匯出檔",
      defaultPath: await dialogStartDir("open") });
    if (p) {
      await rememberDialogDir("open", p);
      await app.flow.offerFile(p);
    }
  });
  // 通用選檔（2026-08-10 走查回饋：與拖放同能力，健保/Apple 都走這顆；
  // Apple 匯出「資料夾」情境用拖放，dropzone 文案已註明）
  document.getElementById("pick-file-btn").addEventListener("click", async () => {
    const p = await dialogOpen({ multiple: false, title: "選擇要匯入的檔案",
      defaultPath: await dialogStartDir("open") });
    if (p) {
      await rememberDialogDir("open", p);
      await app.flow.offerFile(p);
    }
  });
  document.getElementById("gh-copy-btn").addEventListener("click", async () => {
    const url = "https://github.com/notoriouslab/myhealthbank";
    try {
      await navigator.clipboard.writeText(url);
      notify("已複製 GitHub 連結，貼到瀏覽器開啟即可。");
    } catch {
      notify(`請手動複製：${url}`);
    }
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
    .then(() => wireUi())
    .catch((err) => {
      const raw = String(err?.message || err);
      statusEl.textContent = /database|open|readonly|permission/i.test(raw)
        ? `無法建立或開啟資料庫，請確認應用程式資料目錄可寫入。（${raw}）`
        : `啟動失敗：${raw}`;
    });
} else {
  statusEl.textContent = "非 Tauri 環境（瀏覽器預覽模式）。";
}
