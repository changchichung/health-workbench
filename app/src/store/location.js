// 資料庫定位（design D5）：系統 App 資料目錄＋環境變數覆寫（開發模式）。
// 版本判定純函式獨立可測（tests/store/location.test.mjs）。

export const DB_FILENAME = "hwb.sqlite";

// 解析資料庫路徑：HWB_DB_PATH 環境變數（經 shell 層 command）優先，
// 否則 appDataDir/hwb.sqlite。回傳 { path, overridden }。
export async function resolveDbPath() {
  const t = window.__TAURI__;
  const override = await t.core.invoke("env_db_override");
  if (override) return { path: override, overridden: true };
  const dir = await t.path.appDataDir();
  const sep = dir.endsWith("/") || dir.endsWith("\\") ? "" : "/";
  return { path: `${dir}${sep}${DB_FILENAME}`, overridden: false };
}

// 檢視一個既有資料庫檔的 schema 版本（供「匯入既有資料庫檔」防護）。
// 回傳 {ok, version} 或 {ok:false, reason}。
export async function inspectDbVersion(driver, supportedVersion) {
  let rows;
  try {
    rows = await driver.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'");
  } catch {
    return { ok: false, reason: "not_sqlite" };
  }
  if (rows.length === 0) return { ok: false, reason: "not_hwb_db" };
  const [{ v }] = await driver.select("SELECT MAX(version) v FROM schema_version");
  return classifyVersion(v, supportedVersion);
}

// 讀既有 schema 版本；schema_version 表不存在（全新庫）回 null。
export async function readSchemaVersion(driver) {
  const rows = await driver.select(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'");
  if (rows.length === 0) return null;
  const [{ v }] = await driver.select("SELECT MAX(version) v FROM schema_version");
  return v ?? null;
}

// 純函式：是否需要遷移前快照（cpap-sleep-therapy design D8）。
// 全新庫（null）不做；已是最新或更新的版本不做。
export function needsPreMigrationSnapshot(existingVersion, supportedVersion) {
  return existingVersion != null && existingVersion < supportedVersion;
}

// 純函式：遷移前快照檔名。帶來源版本與日期，同名時附序號
// （VACUUM INTO 對已存在的目標檔直接拒絕，故呼叫端 MUST 先以 exists 預檢）。
// 版本與序號一律轉為非負整數後才進檔名：這兩個值最終會組進檔案路徑，而
// version 來自資料庫欄位（SQLite 的型別親和性允許 INTEGER 欄位實際存字串），
// 不強制數值化就等於讓資料庫內容決定路徑字串。
export function preMigrationSnapshotName(fromVersion, isoDate, seq = 0) {
  const v = Math.trunc(Number(fromVersion));
  const n = Math.trunc(Number(seq));
  if (!Number.isFinite(v) || v < 0) throw new Error("快照檔名：來源版本非有效整數");
  if (!Number.isFinite(n) || n < 0) throw new Error("快照檔名：序號非有效整數");
  const d = String(isoDate).replaceAll("-", "");
  if (!/^\d{8}$/.test(d)) throw new Error("快照檔名：日期需為 YYYY-MM-DD");
  return `hwb-premigrate-v${v}-${d}${n ? `-${n}` : ""}.sqlite`;
}

// 純函式：版本分類（node:test 直測）
export function classifyVersion(version, supportedVersion) {
  if (version == null) return { ok: false, reason: "not_hwb_db" };
  if (version > supportedVersion) return { ok: false, reason: "too_new", version };
  return { ok: true, version };
}

// 「匯入既有資料庫檔」（app-shell spec）：驗版本 → 複製到 App 資料目錄。
// 呼叫端負責先關閉目前主庫連線、複製後重開（連線池握檔陷阱，見 g3_task0.md）。
// openDriver: (path) => Promise<StoreDriver>
export async function importExistingDb(srcPath, destPath, openDriver, supportedVersion) {
  const src = await openDriver(srcPath);
  let check;
  try {
    check = await inspectDbVersion(src, supportedVersion);
  } finally {
    await src.close().catch(() => {});
  }
  if (!check.ok) return check;
  await window.__TAURI__.fs.copyFile(srcPath, destPath);
  return { ok: true, version: check.version };
}

// 匯出備份檔名：日期戳降低同名機率（app-shell spec 匯出資料庫檔）
export function backupFileName(isoDate) {
  return `hwb-backup-${isoDate.replaceAll("-", "")}.sqlite`;
}

// 一致性快照匯出：SQLite VACUUM INTO（單一交易視角、不中斷主庫、
// 輸出緊實化單檔，可直接被 importExistingDb 讀回）。目標檔案已存在
// 時 SQLite 直接拒絕（呼叫端先以 fs.exists 預檢給友善訊息）。
export async function exportDbSnapshot(driver, destPath) {
  await driver.execute("VACUUM INTO ?", [destPath]);
}
