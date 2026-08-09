// 檢驗名稱正規化 JS 版（自 src/knowledge/labs.py 移植）。
// 條目來源：建置期由 labs.yaml 轉出的 labs.json（scripts 見 tasks 2.6），
// 呼叫端負責載入後傳入（App：bundle 資源；測試：讀 repo 檔）。

export function aliasMap(entries) {
  const m = new Map();
  for (const e of entries) {
    for (const alias of [e.normalized_name, ...e.aliases]) {
      const key = alias.trim();
      if (m.has(key) && m.get(key) !== e.normalized_name) {
        throw new Error(`別名衝突：${key} 同時指向 ${m.get(key)} 與 ${e.normalized_name}`);
      }
      m.set(key, e.normalized_name);
    }
  }
  return m;
}

// 冪等重算全部 lab_results 的 test_name_normalized 與 unmapped 旗標
export async function applyNormalization(store, entries) {
  const m = aliasMap(entries);
  const rows = await store.driver.select(
    "SELECT id, test_name_raw, quality_flags FROM lab_results");
  let mapped = 0, unmapped = 0;
  for (const r of rows) {
    const raw = (r.test_name_raw || "").trim();
    const normalized = m.get(raw) ?? null;
    const flags = (r.quality_flags || "").split(",")
      .filter(f => f && f !== "unmapped");
    if (normalized) mapped += 1;
    else { unmapped += 1; flags.push("unmapped"); }
    await store.driver.execute(
      "UPDATE lab_results SET test_name_normalized=?, quality_flags=? WHERE id=?",
      [normalized, flags.join(","), r.id]);
  }
  return { mapped, unmapped };
}
