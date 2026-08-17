// App 內即時檢視（app-viewer spec）：provider payload（僅當前成員）→
// assemble 單檔 HTML → iframe srcdoc。「匯出單檔 HTML」寫出同一份字串，
// 天生同構且僅含當前成員（D3）。檔名含成員名稱（exportFileName 純函式，
// tests/ui/export_name.test.mjs 直測）。
import { buildPayload } from "../provider/payload.js";
import { assemble, loadAssets } from "../provider/assemble.js";
import { localDateISO } from "../engine/values.js";
import { PROFILE_DATA_TABLES } from "../engine/profiles.js";

// 「這位成員有沒有可檢視的資料」＝任一資料表有列。沿用 PROFILE_DATA_TABLES
// （成員刪除用的同一份清單，已被 tests/engine/table_coverage.test.mjs 的 DDL
// 對帳釘住），扣掉來源紀錄本身。
//
// 原本硬編成「encounters ＋ apple_records 兩表相加」，於是只有 CPAP 資料的
// 成員會被判定成沒有資料，檢視頁整片空白且沒有任何錯誤訊息（2026-08-13 實機
// 走查：把 CPAP 匯給新成員後檢視頁空白）。新增來源時漏改這裡不會有測試轉紅，
// 所以改成沿用清單而不是再列一份表名。
const HAS_DATA_TABLES = PROFILE_DATA_TABLES.filter(t => t !== "source_documents");

// 純函式：匯出檔名。檔名不安全字元（含控制字元）代換為底線。
export function exportFileName(memberName, dateStr) {
  const safe = String(memberName ?? "")
    .replaceAll(/[/\\:*?"<>|\u0000-\u001f]/g, "_").trim() || "成員";
  return `dashboard_${safe}_${dateStr.replaceAll("-", "")}-private.html`;
}

export function createViewer({ getDriver, getDbPath, getProfileId,
  getExportStartDir, labEntries, onNotify }) {
  let assets = null;
  let lastHtml = null;
  let lastMemberName = null;

  const frame = document.getElementById("viewer-frame");
  const emptyEl = document.getElementById("viewer-empty");
  const exportBtn = document.getElementById("export-html-btn");
  const EMPTY_TEXT = emptyEl.textContent; // 首啟引導原文（載入提示後要還原）
  // 外部連結攔截掛在 frame 的 load 上（初始化一次，非每次 refresh；
  // srcdoc 每次重設都會觸發 load 對新 document 重掛委派，避免累積）
  frame.addEventListener("load", wireExternalLinks);

  // 解析順序：db 同目錄（使用者可自行更新快取，Python 慣例）→ 沒有就從 bundle
  // 資源複製一份過去，之後永遠走第一條。
  //
  // 原本第二條是「exists(bundled) 為真才回 bundled」，而那個探測在 dev 模式會
  // 失敗並被 catch 吞成 null（2026-08-13 實機：檔案確實在
  // target/debug/resources/ 卻拿不到）。後果是靜默降級：payload 少了 drug_zh，
  // 用藥頁的西藥品項全部落到「診療項目與其他」，畫面只在說明行寫「未建快取」，
  // 沒人會把那句話跟分類錯誤連起來。改為直接 copyFile（權限已允許），失敗時
  // 把原因寫進 console 而不是無聲吞掉。
  async function drugCachePath() {
    const t = window.__TAURI__;
    const dir = getDbPath().replace(/[/\\][^/\\]+$/, "");
    const sep = dir.includes("\\") ? "\\" : "/";
    const local = `${dir}${sep}drug_items.sqlite`;
    if (await t.fs.exists(local).catch(() => false)) return local;
    try {
      const bundled = await t.path.resolveResource("resources/drug_items.sqlite");
      await t.fs.copyFile(bundled, local);
      return local;
    } catch (err) {
      console.error("[hwb] 用藥品項檔快取取不到，西藥品項將無法辨識：", err);
      return null;
    }
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
    // EXISTS 逐表短路：apple_records 有數十萬列，不能用 count(*) 相加
    const [{ has }] = await driver.select(
      "SELECT (" + HAS_DATA_TABLES
        .map(t => `EXISTS(SELECT 1 FROM ${t} WHERE profile_id=?)`).join(" OR ")
      + ") AS has", HAS_DATA_TABLES.map(() => profileId));
    if (!has) return showEmpty();
    assets = assets || await loadAssets();
    const payload = await buildPayload(driver, {
      profileId,
      knowledgeEntries: labEntries,
      drugCachePath: await drugCachePath(),
      today: localDateISO(),
    });
    lastHtml = assemble(payload, assets);
    lastMemberName = payload.meta.profile;
    frame.srcdoc = lastHtml;
    frame.hidden = false;
    exportBtn.hidden = false;
    emptyEl.hidden = true;
    return { rendered: true, bytes: lastHtml.length, counts: payload.meta.counts };
  }

  // 仿單等外部連結：WebView 內 target=_blank 會被 Tauri 攔下無反應
  //（2026-08-11 使用者走查發現），改經 opener 插件開系統瀏覽器。
  // srcdoc iframe 與外層同源，可直接掛委派監聽；匯出的單檔 HTML 在
  // 一般瀏覽器開啟，維持原生 target=_blank 行為不受影響。
  function wireExternalLinks() {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (e) => {
      const a = e.target.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      const openUrl = window.__TAURI__?.opener?.openUrl;
      if (openUrl) {
        openUrl(href).catch((err) => {
          onNotify?.(`無法開啟連結：${String(err?.message || err)}`, 10000);
        });
      } else {
        onNotify?.(`此版本無法開啟外部連結，請手動前往：${href}`, 10000);
      }
    });
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
      const name = exportFileName(lastMemberName, localDateISO());
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
