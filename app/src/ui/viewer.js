// App 內即時檢視（app-viewer spec）：provider payload → assemble 單檔 HTML
// → iframe srcdoc。「匯出單檔 HTML」寫出同一份字串，天生同構。
// 藥品快取路徑沿用 Python 慣例：db 同目錄 drug_items.sqlite（6.1 再加
// bundle resource 後援）。
import { buildPayload } from "../provider/payload.js";
import { assemble, loadAssets } from "../provider/assemble.js";

export function createViewer({ getDriver, getDbPath, labEntries }) {
  let assets = null;
  let lastHtml = null;

  const frame = document.getElementById("viewer-frame");
  const emptyEl = document.getElementById("viewer-empty");
  const exportBtn = document.getElementById("export-html-btn");

  // 解析順序：db 同目錄（使用者可自行更新快取，Python 慣例）→ bundle 資源
  async function drugCachePath() {
    const t = window.__TAURI__;
    const dir = getDbPath().replace(/[/\\][^/\\]+$/, "");
    const sep = dir.includes("\\") ? "\\" : "/";
    const local = `${dir}${sep}drug_items.sqlite`;
    if (await t.fs.exists(local).catch(() => false)) return local;
    try {
      const bundled = await t.path.resolveResource("resources/drug_items.sqlite");
      if (await t.fs.exists(bundled)) return bundled;
    } catch { /* resource 未配置時走 null */ }
    return null;
  }

  async function refresh() {
    const driver = getDriver();
    const [{ c }] = await driver.select(
      "SELECT (SELECT count(*) FROM encounters) + (SELECT count(*) FROM apple_records) c");
    if (c === 0) {
      frame.hidden = true;
      exportBtn.hidden = true;
      emptyEl.hidden = false;
      lastHtml = null;
      return { rendered: false };
    }
    assets = assets || await loadAssets();
    const payload = await buildPayload(driver, {
      knowledgeEntries: labEntries,
      drugCachePath: await drugCachePath(),
      today: new Date().toISOString().slice(0, 10),
    });
    lastHtml = assemble(payload, assets);
    frame.srcdoc = lastHtml;
    frame.hidden = false;
    exportBtn.hidden = false;
    emptyEl.hidden = true;
    return { rendered: true, bytes: lastHtml.length, counts: payload.meta.counts };
  }

  async function exportHtml(destPath = null) {
    if (!lastHtml) await refresh();
    if (!lastHtml) return { ok: false, reason: "no_data" };
    const t = window.__TAURI__;
    let target = destPath;
    if (!target) {
      const save = t.dialog.save || t.dialog.default?.save;
      const docs = await t.path.documentDir().catch(() => null);
      const name = `dashboard_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-private.html`;
      target = await save({
        title: "匯出單檔 HTML（含全部個資，請妥善保管）",
        defaultPath: docs ? `${docs}/${name}` : name,
      });
      if (!target) return { ok: false, reason: "cancelled" };
    }
    await t.fs.writeTextFile(target, lastHtml);
    return { ok: true, path: target, bytes: lastHtml.length };
  }

  return { refresh, exportHtml };
}
