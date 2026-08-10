// App 內即時檢視（app-viewer spec）：provider payload（僅當前成員）→
// assemble 單檔 HTML → iframe srcdoc。「匯出單檔 HTML」寫出同一份字串，
// 天生同構且僅含當前成員（D3）。檔名含成員名稱（exportFileName 純函式，
// tests/ui/export_name.test.mjs 直測）。
import { buildPayload } from "../provider/payload.js";
import { assemble, loadAssets } from "../provider/assemble.js";

// 純函式：匯出檔名。檔名不安全字元（含控制字元）代換為底線。
export function exportFileName(memberName, dateStr) {
  const safe = String(memberName ?? "")
    .replaceAll(/[/\\:*?"<>|\u0000-\u001f]/g, "_").trim() || "成員";
  return `dashboard_${safe}_${dateStr.replaceAll("-", "")}-private.html`;
}

export function createViewer({ getDriver, getDbPath, getProfileId,
  getExportStartDir, labEntries }) {
  let assets = null;
  let lastHtml = null;
  let lastMemberName = null;

  const frame = document.getElementById("viewer-frame");
  const emptyEl = document.getElementById("viewer-empty");
  const exportBtn = document.getElementById("export-html-btn");
  const EMPTY_TEXT = emptyEl.textContent; // 首啟引導原文（載入提示後要還原）

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

  function showEmpty() {
    frame.hidden = true;
    exportBtn.hidden = true;
    emptyEl.textContent = EMPTY_TEXT;
    emptyEl.hidden = false;
    lastHtml = null;
    lastMemberName = null;
    return { rendered: false };
  }

  async function refresh() {
    const driver = getDriver();
    const profileId = getProfileId();
    if (profileId == null) return showEmpty();
    // 先遮住舊內容再查新資料（Karen HIGH-1：大量資料下 payload 組裝
    // 需 2-3 秒，不遮會出現「新成員標籤配舊成員病歷」的錯配窗）
    frame.hidden = true;
    emptyEl.textContent = "正在載入資料…";
    emptyEl.hidden = false;
    const [{ c }] = await driver.select(
      "SELECT (SELECT count(*) FROM encounters WHERE profile_id=?)"
      + " + (SELECT count(*) FROM apple_records WHERE profile_id=?) c",
      [profileId, profileId]);
    if (c === 0) return showEmpty();
    assets = assets || await loadAssets();
    const payload = await buildPayload(driver, {
      profileId,
      knowledgeEntries: labEntries,
      drugCachePath: await drugCachePath(),
      today: new Date().toISOString().slice(0, 10),
    });
    lastHtml = assemble(payload, assets);
    lastMemberName = payload.meta.profile;
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
      // 起始目錄：記憶上次匯出位置，首次退「文件」（main.js dialogStartDir）
      const startDir = await (getExportStartDir?.() ?? null);
      const name = exportFileName(lastMemberName,
        new Date().toISOString().slice(0, 10));
      target = await save({
        title: `匯出單檔 HTML（僅成員「${lastMemberName}」的資料，含個資請妥善保管）`,
        defaultPath: startDir ? `${startDir}/${name}` : name,
      });
      if (!target) return { ok: false, reason: "cancelled" };
    }
    await t.fs.writeTextFile(target, lastHtml);
    return { ok: true, path: target, bytes: lastHtml.length };
  }

  return { refresh, exportHtml };
}
