// DataProvider（design D4）：以 SQL 組裝與 src/dashboard/embed.py 同構的
// payload。聚合規則沿用 dashboard-generator spec（計數型日加總取最大、
// 量測型日中位數、品質旗標排除）。差分驗收：tests/provider/ 對同一庫
// 比對 Python build_payload 輸出數值全等（generated_at 除外）。
import { attachDrugs } from "../knowledge/drugs.js";

const TREND_EXCLUDE = "quality_flags NOT LIKE '%epoch_placeholder_date%'"
  + " AND quality_flags NOT LIKE '%out_of_range%'";

const COUNTING_TYPES = ["步數", "步行跑步距離", "騎車距離", "爬樓層數", "活動能量", "基礎能量"];
const MEASURE_TYPES = ["體重", "BMI", "體脂率", "收縮壓", "舒張壓", "心率", "血氧"];

const TABLES = ["profiles", "source_documents", "encounters", "medications",
  "lab_results", "reports", "immunizations", "body_measurements",
  "cancer_screenings", "apple_records", "apple_workouts"];

// Python round() 等價：round-half-even（銀行家捨入）
export function pyRound(v, digits) {
  const f = 10 ** digits;
  const x = v * f;
  const r = Math.round(x);
  // JS Math.round 對 .5 恆向上；Python 對「剛好 .5」取偶數
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const down = Math.trunc(x);
    return (down % 2 === 0 ? down : down + (x > 0 ? 1 : -1)) / f;
  }
  return r / f;
}

async function dailyCountingSeries(driver, typeZh) {
  const rows = await driver.select(`
    WITH daily AS (
      SELECT substr(start_ts,1,10) d, source_name, SUM(COALESCE(value_normalized, value_numeric)) v
      FROM apple_records WHERE type_zh=? AND ${TREND_EXCLUDE}
      GROUP BY d, source_name)
    SELECT d, MAX(v) v FROM daily GROUP BY d ORDER BY d`, [typeZh]);
  return rows.filter(r => r.v !== null).map(r => [r.d, pyRound(r.v, 1)]);
}

async function dailyMeasureSeries(driver, typeZh) {
  const rows = await driver.select(`
    SELECT substr(start_ts,1,10) d, COALESCE(value_normalized, value_numeric) v
    FROM apple_records WHERE type_zh=? AND ${TREND_EXCLUDE} AND
    COALESCE(value_normalized, value_numeric) IS NOT NULL
    ORDER BY d`, [typeZh]);
  const buckets = new Map();
  for (const { d, v } of rows) {
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d).push(v);
  }
  return [...buckets.keys()].sort().map(d => {
    const vs = buckets.get(d).slice().sort((a, b) => a - b);
    return [d, pyRound(vs[Math.floor(vs.length / 2)], 2)];
  });
}

// knowledgeEntries: labs.json 條目；drugCachePath: drug_items.sqlite 路徑（可 null）
export async function buildPayload(driver, { knowledgeEntries, drugCachePath, today }) {
  const encounters = (await driver.select(`
    SELECT e.id, e.type, e.date, e.facility_name, e.dx_code, e.dx_name,
           e.copay, e.nhi_points, e.section, e.source_index, e.quality_flags,
           d.filename AS source_file
    FROM encounters e JOIN source_documents d ON e.doc_id = d.id
    ORDER BY e.date DESC, e.id DESC`)).map(r => ({ ...r }));

  const medsByEnc = {};
  const medications = [];
  const drugs = drugCachePath ? await attachDrugs(driver, drugCachePath) : null;
  for (const row of await driver.select(`
    SELECT m.id, m.encounter_id, m.order_code, m.order_name, m.total_qty,
           m.days_supply, m.tooth_name, m.section AS section_hint,
           e.date, e.facility_name
    FROM medications m JOIN encounters e ON m.encounter_id = e.id
    ORDER BY e.date DESC`)) {
    const m = { ...row };
    const drug = drugs ? await drugs.lookup(m.order_code) : null;
    if (drug) {
      m.drug_zh = drug.name_zh;
      m.ingredient = drug.ingredient;
      m.leaflet_url = drug.leaflet_url;
    }
    medications.push(m);
    (medsByEnc[m.encounter_id] = medsByEnc[m.encounter_id] || []).push(m.id);
  }
  const drugCacheMeta = drugs ? await drugs.meta() : null;
  if (drugs) await drugs.detach();

  const labs = (await driver.select(`
    SELECT id, COALESCE(test_name_normalized, test_name_raw) AS name,
           test_name_raw, test_name_normalized IS NULL AS unmapped,
           test_date, value_text, value_numeric, ref_range, facility_name,
           order_name, quality_flags
    FROM lab_results ORDER BY test_date`)).map(r => ({ ...r }));
  const reports = (await driver.select(`
    SELECT id, visit_date, test_date, facility_name, order_name, report_text
    FROM reports ORDER BY test_date DESC`)).map(r => ({ ...r }));
  const immunizations = (await driver.select(
    "SELECT date, vaccine_name, facility_name FROM immunizations ORDER BY date DESC"))
    .map(r => ({ ...r }));
  const nhiBody = (await driver.select(`
    SELECT check_date, height_cm, weight_kg, bmi, waist, systolic, diastolic
    FROM body_measurements ORDER BY check_date`)).map(r => ({ ...r }));

  const knowledge = {};
  for (const e of knowledgeEntries) {
    knowledge[e.normalized_name] = {
      description: e.description, source_name: e.source_name,
      source_url: e.source_url, cited_date: String(e.cited_date),
    };
  }

  const activity = {};
  for (const t of COUNTING_TYPES) activity[t] = await dailyCountingSeries(driver, t);
  const measures = {};
  for (const t of MEASURE_TYPES) measures[t] = await dailyMeasureSeries(driver, t);
  const workouts = (await driver.select(`
    SELECT activity, substr(start_ts,1,10) AS date, duration_min, source_name
    FROM apple_workouts ORDER BY start_ts DESC`)).map(r => ({ ...r }));

  const [range] = await driver.select("SELECT MIN(date) lo, MAX(date) hi FROM encounters");
  const counts = {};
  for (const t of TABLES) {
    const [{ c }] = await driver.select(`SELECT COUNT(*) c FROM ${t}`);
    counts[t] = c;
  }
  const [profile] = await driver.select("SELECT display_name FROM profiles LIMIT 1");
  const sources = (await driver.select(
    "SELECT filename, adapter, imported_at, import_stats"
    + " FROM source_documents ORDER BY imported_at")).map(r => ({ ...r }));

  return {
    meta: {
      generated_at: today,
      date_min: range.lo, date_max: range.hi,
      profile: profile?.display_name ?? null,
      counts,
      sources,
      drug_cache: drugCacheMeta,
    },
    encounters,
    meds_by_enc: medsByEnc,
    medications,
    labs,
    reports,
    immunizations,
    nhi_body: nhiBody,
    knowledge,
    activity,
    measures,
    workouts,
  };
}
