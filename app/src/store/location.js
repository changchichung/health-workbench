// 資料庫定位（design D5）：系統 App 資料目錄＋環境變數覆寫（開發模式）。
// 版本判定純函式獨立可測（tests/store/location.test.mjs）。

export const DB_FILENAME = "mhb.sqlite";

// 解析資料庫路徑：MHB_DB_PATH 環境變數（經 shell 層 command）優先，
// 否則 appDataDir/mhb.sqlite。回傳 { path, overridden }。
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
  if (rows.length === 0) return { ok: false, reason: "not_mhb_db" };
  const [{ v }] = await driver.select("SELECT MAX(version) v FROM schema_version");
  return classifyVersion(v, supportedVersion);
}

// 純函式：版本分類（node:test 直測）
export function classifyVersion(version, supportedVersion) {
  if (version == null) return { ok: false, reason: "not_mhb_db" };
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
