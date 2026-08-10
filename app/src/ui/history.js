// 「資料庫與匯入紀錄」卡（匯入分頁）：資料庫位置、各類筆數、來源檔案
// 清單（時間、格式、新增統計）。未來多人時依 profile 分組顯示的掛載點。
export const ADAPTER_LABELS = {
  nhi_json: "健保存摺（JSON）",
  nhi_xml: "健保存摺（XML）",
  apple_health: "Apple 健康",
};

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

export function createHistory({ getDriver, getDbPath }) {
  const box = document.getElementById("import-history");

  async function refresh() {
    const driver = getDriver();
    const counts = {};
    for (const [t, label] of [["encounters", "就醫"], ["medications", "用藥"],
      ["lab_results", "檢驗"], ["reports", "報告"], ["immunizations", "疫苗"],
      ["apple_records", "Apple 健康"]]) {
      const [{ c }] = await driver.select(`SELECT count(*) c FROM ${t}`);
      counts[label] = c;
    }
    const docs = await driver.select(
      "SELECT filename, adapter, imported_at, import_stats"
      + " FROM source_documents ORDER BY imported_at DESC");
    const countText = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([label, c]) => `${label} ${c.toLocaleString()}`).join("、") || "尚無資料";
    const rows = docs.map((d) => {
      let added = "";
      try {
        const st = JSON.parse(d.import_stats || "{}");
        const n = Object.values(st.inserted || {}).reduce((a, b) => a + b, 0);
        added = `新增 ${n.toLocaleString()} 筆`;
      } catch { /* 統計缺漏時僅略過摘要 */ }
      return `<tr><td class="dt">${esc(d.imported_at)}</td>
        <td>${esc(ADAPTER_LABELS[d.adapter] || d.adapter)}</td>
        <td>${esc(d.filename)}</td><td class="dt">${added}</td></tr>`;
    }).join("");
    box.innerHTML = `
      <h3>資料庫與匯入紀錄</h3>
      <p class="dbline">目前資料：${esc(countText)}</p>
      <p class="dbline dt">資料庫位置：${esc(getDbPath())}</p>
      ${docs.length ? `<table><thead><tr><th>匯入時間</th><th>格式</th><th>檔案</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>` : ""}`;
  }

  return { refresh };
}
