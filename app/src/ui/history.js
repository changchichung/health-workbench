// 「資料庫與匯入紀錄」卡（匯入分頁）：資料庫管理視角（design D3），
// 不隨成員切換器過濾——資料庫位置、全庫各類筆數、來源檔案清單
// 依成員分組列出全部成員。分組邏輯為純函式（groupDocsByProfile），
// tests/ui/history_grouping.test.mjs 直測。
export const ADAPTER_LABELS = {
  nhi_json: "健保存摺（JSON）",
  nhi_xml: "健保存摺（XML）",
  apple_health: "Apple 健康",
};

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

// 純函式：來源檔列（含 profile 名）→ [{ profileName, docs: [...] }]，
// 依成員 id 升冪分組、組內維持傳入順序（呼叫端以匯入時間排序）
export function groupDocsByProfile(docs) {
  const groups = new Map();
  for (const d of docs) {
    if (!groups.has(d.profile_id)) {
      groups.set(d.profile_id, { profileName: d.profile_name, docs: [] });
    }
    groups.get(d.profile_id).docs.push(d);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

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
      "SELECT d.filename, d.adapter, d.imported_at, d.import_stats,"
      + " d.profile_id, p.display_name AS profile_name"
      + " FROM source_documents d JOIN profiles p ON d.profile_id = p.id"
      + " ORDER BY d.imported_at DESC");
    const countText = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([label, c]) => `${label} ${c.toLocaleString()}`).join("、") || "尚無資料";
    const docRow = (d) => {
      let added = "";
      try {
        const st = JSON.parse(d.import_stats || "{}");
        const n = Object.values(st.inserted || {}).reduce((a, b) => a + b, 0);
        added = `新增 ${n.toLocaleString()} 筆`;
      } catch { /* 統計缺漏時僅略過摘要 */ }
      return `<tr><td class="dt">${esc(d.imported_at)}</td>
        <td>${esc(ADAPTER_LABELS[d.adapter] || d.adapter)}</td>
        <td>${esc(d.filename)}</td><td class="dt">${added}</td></tr>`;
    };
    const groups = groupDocsByProfile(docs.map(r => ({ ...r })));
    const groupHtml = groups.map((g) => `
      <h4 class="profile-group">成員「${esc(g.profileName)}」</h4>
      <table><thead><tr><th>匯入時間</th><th>格式</th><th>檔案</th><th></th></tr></thead>
        <tbody>${g.docs.map(docRow).join("")}</tbody></table>`).join("");
    box.innerHTML = `
      <h3>資料庫與匯入紀錄</h3>
      <p class="dbline">全部資料：${esc(countText)}</p>
      <p class="dbline dt">資料庫位置：${esc(getDbPath())}</p>
      ${groupHtml}`;
  }

  return { refresh };
}
