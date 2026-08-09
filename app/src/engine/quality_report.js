// 品質報告 JS 版（自 src/quality/quality_report.py 移植）。
// 結構依 design Implementation Contract：八個頂層欄位、順序固定。

export const TOP_KEYS = ["source", "sections", "date_ranges", "quality_flags",
  "unmapped_lab_names", "superseded_candidates", "stale_knowledge", "dedup"];

export function buildReport({ source, sections, dateRanges, qualityFlags,
  unmappedLabNames, supersededCandidates, staleKnowledge, dedup }) {
  const report = {
    source,
    sections,
    date_ranges: dateRanges,
    quality_flags: qualityFlags,
    unmapped_lab_names: unmappedLabNames,
    superseded_candidates: supersededCandidates,
    stale_knowledge: staleKnowledge,
    dedup,
  };
  if (JSON.stringify(Object.keys(report)) !== JSON.stringify(TOP_KEYS)) {
    throw new Error("報告頂層欄位順序不符 contract");
  }
  return report;
}

export async function buildIncremental(store, { sourceInfo, sections }) {
  return buildReport({
    source: sourceInfo,
    sections,
    dateRanges: await dateRanges(store),
    qualityFlags: await store.qualityFlagCounts(),
    unmappedLabNames: await unmappedLabs(store),
    supersededCandidates: await supersededCount(store),
    staleKnowledge: [],
    dedup: { skipped_dup: store.stats.skipped_dup, collisions: store.stats.collisions },
  });
}

async function dateRanges(store) {
  const out = {};
  for (const [table, col] of [["encounters", "date"], ["lab_results", "test_date"],
    ["immunizations", "date"], ["body_measurements", "check_date"],
    ["apple_records", "start_ts"]]) {
    const [row] = await store.driver.select(
      `SELECT MIN(${col}) lo, MAX(${col}) hi FROM ${table}`
      + ` WHERE quality_flags NOT LIKE '%epoch_placeholder_date%'`
      + ` AND quality_flags NOT LIKE '%out_of_range%'`);
    out[table] = [row.lo, row.hi];
  }
  return out;
}

async function unmappedLabs(store) {
  const rows = await store.driver.select(
    "SELECT DISTINCT test_name_raw FROM lab_results"
    + " WHERE test_name_normalized IS NULL AND test_name_raw IS NOT NULL"
    + " ORDER BY test_name_raw");
  return rows.map(r => r.test_name_raw);
}

async function supersededCount(store) {
  // 弱組合鍵相同、指紋不同、跨批次（語意同 Python _superseded_count）
  const [row] = await store.driver.select(`
    SELECT COUNT(*) c FROM (
      SELECT facility_code, date, section, visit_seq FROM encounters
      WHERE facility_code IS NOT NULL AND date IS NOT NULL
      GROUP BY facility_code, date, section, visit_seq
      HAVING COUNT(DISTINCT record_fp) > 1
         AND COUNT(DISTINCT doc_id) > 1)`);
  return row.c;
}
