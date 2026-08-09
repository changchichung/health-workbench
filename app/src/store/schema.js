// health-database schema JS 版：DDL 字串自 src/store/schema.py 逐字移植，
// 驗收＝兩邊空庫正規化 schema dump 全等（tests/store/schema_parity.test.mjs）。
// 修改 DDL 時 MUST 同步修改 Python 版並重跑 parity 測試。

export const SCHEMA_VERSION = 3;

export const DDL = `
CREATE TABLE IF NOT EXISTS schema_version(
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS profiles(
    id INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL,
    masked_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS source_documents(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    filename TEXT NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    adapter TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    import_stats TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS encounters(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    section TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    record_fp TEXT NOT NULL,
    canonical TEXT NOT NULL,
    type TEXT NOT NULL,
    date TEXT,
    visit_seq TEXT,
    facility_name TEXT,
    facility_code TEXT,
    dx_code TEXT,
    dx_name TEXT,
    copay INTEGER,
    nhi_points INTEGER,
    extra_json TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, section, record_fp));

CREATE TABLE IF NOT EXISTS medications(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    encounter_id INTEGER NOT NULL REFERENCES encounters(id),
    order_code TEXT,
    order_name TEXT,
    total_qty REAL,
    days_supply INTEGER,
    tooth_code TEXT,
    tooth_name TEXT,
    section TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(encounter_id, section, source_index));
CREATE INDEX IF NOT EXISTS idx_medications_profile ON medications(profile_id, encounter_id);

CREATE TABLE IF NOT EXISTS lab_results(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    section TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    record_fp TEXT NOT NULL,
    canonical TEXT NOT NULL,
    visit_date TEXT,
    test_date TEXT,
    facility_name TEXT,
    order_code TEXT,
    order_name TEXT,
    test_name_raw TEXT,
    test_name_normalized TEXT,
    value_text TEXT,
    value_numeric REAL,
    ref_range TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, section, record_fp));

CREATE TABLE IF NOT EXISTS reports(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    section TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    record_fp TEXT NOT NULL,
    canonical TEXT NOT NULL,
    visit_date TEXT,
    test_date TEXT,
    facility_name TEXT,
    order_code TEXT,
    order_name TEXT,
    report_text TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, section, record_fp));

CREATE TABLE IF NOT EXISTS immunizations(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    section TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    record_fp TEXT NOT NULL,
    canonical TEXT NOT NULL,
    date TEXT,
    vaccine_name TEXT,
    facility_name TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, section, record_fp));

CREATE TABLE IF NOT EXISTS body_measurements(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    section TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    record_fp TEXT NOT NULL,
    canonical TEXT NOT NULL,
    check_date TEXT,
    height_cm REAL,
    weight_kg REAL,
    bmi REAL,
    waist REAL,
    systolic INTEGER,
    diastolic INTEGER,
    extra_json TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, section, record_fp));

CREATE TABLE IF NOT EXISTS cancer_screenings(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    section TEXT NOT NULL,
    source_index INTEGER NOT NULL,
    record_fp TEXT NOT NULL,
    canonical TEXT NOT NULL,
    category TEXT,
    item_name TEXT,
    detail_json TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, section, record_fp));

CREATE TABLE IF NOT EXISTS apple_records(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    type TEXT NOT NULL,
    type_zh TEXT NOT NULL,
    start_ts TEXT NOT NULL,
    end_ts TEXT NOT NULL,
    value_numeric REAL,
    value_normalized REAL,
    value_text TEXT,
    unit TEXT,
    source_name TEXT,
    quality_flags TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS uq_apple ON apple_records(
    profile_id, type, start_ts, end_ts, COALESCE(source_name,''),
    COALESCE(value_numeric, -999999.25), COALESCE(value_text, ''));

CREATE TABLE IF NOT EXISTS apple_workouts(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    activity TEXT NOT NULL,
    start_ts TEXT NOT NULL,
    end_ts TEXT NOT NULL,
    duration_min REAL,
    source_name TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, activity, start_ts, end_ts, source_name));
`;

// 前向遷移：{來源版本: [SQL, ...]}，逐版執行至 SCHEMA_VERSION（同 Python）
export const MIGRATIONS = {
  1: ["ALTER TABLE source_documents ADD COLUMN import_stats TEXT"],
  2: ["CREATE INDEX IF NOT EXISTS idx_medications_profile"
      + " ON medications(profile_id, encounter_id)"],
};

export class SchemaTooNew extends Error {}
export class NoMigrationPath extends Error {}

// 初始化／前向遷移，語意鏡像 src/store/db.py Store._init_schema
export async function initSchema(driver) {
  const existing = await driver.select(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'");
  if (existing.length === 0) {
    for (const stmt of splitStatements(DDL)) await driver.execute(stmt);
    await driver.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION]);
    return SCHEMA_VERSION;
  }
  let [{ ver }] = await driver.select("SELECT MAX(version) ver FROM schema_version");
  while (ver < SCHEMA_VERSION) {
    const steps = MIGRATIONS[ver];
    if (!steps) {
      throw new NoMigrationPath(
        `資料庫 schema 版本 ${ver} 與程式 ${SCHEMA_VERSION} 不符，且無可用遷移路徑`);
    }
    for (const sql of steps) await driver.execute(sql);
    ver += 1;
    await driver.execute("INSERT INTO schema_version(version) VALUES (?)", [ver]);
  }
  if (ver !== SCHEMA_VERSION) {
    throw new SchemaTooNew(
      `資料庫 schema 版本 ${ver} 高於程式支援的 ${SCHEMA_VERSION}，請更新 App`);
  }
  return ver;
}

// 以分號＋換行切分 DDL（DDL 內無字串常值含分號，安全）
function splitStatements(ddl) {
  return ddl.split(";").map(s => s.trim()).filter(Boolean);
}
