// 健保用藥品項查詢 JS 版（自 src/knowledge/drugs.py 的 DrugLookup 移植）。
// 快取檔 drug_items.sqlite 以唯讀 ATTACH 掛上主連線（design D5：隨 bundle
// 資源；App 端以 resource path 解析、dev/測試用 repo data/ 路徑）。
// 快取不存在時全部回 null，不外連（語意同 Python）。

export async function attachDrugs(driver, cachePath) {
  try {
    // mode=ro：sqlx 與 SQLite URI 支援唯讀；不支援 URI 的環境退純路徑
    await driver.execute(
      `ATTACH DATABASE 'file:${cachePath.replaceAll("'", "''")}?mode=ro' AS drugs`);
  } catch {
    try {
      await driver.execute(`ATTACH DATABASE '${cachePath.replaceAll("'", "''")}' AS drugs`);
    } catch {
      return noCache();
    }
  }
  // 驗證表存在（掛到不存在的檔會建空庫）
  try {
    await driver.select("SELECT 1 FROM drugs.drug_items LIMIT 1");
  } catch {
    await driver.execute("DETACH DATABASE drugs").catch(() => {});
    return noCache();
  }
  return {
    available: true,
    async meta() {
      const rows = await driver.select("SELECT key, value FROM drugs.cache_meta");
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    },
    // 醫囑代碼前 10 碼 → 品項資訊；查無回 null（語意同 Python lookup）
    async lookup(orderCode) {
      if (!orderCode) return null;
      const rows = await driver.select(
        "SELECT * FROM drugs.drug_items WHERE code=?", [String(orderCode).slice(0, 10)]);
      return rows.length ? { ...rows[0] } : null;
    },
    async detach() {
      await driver.execute("DETACH DATABASE drugs").catch(() => {});
    },
  };
}

function noCache() {
  return {
    available: false,
    async meta() { return null; },
    async lookup() { return null; },
    async detach() {},
  };
}
