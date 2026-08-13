// 「資料庫與匯入紀錄」卡（匯入分頁）：資料庫管理視角（design D3），
// 不隨成員切換器過濾——資料庫位置、全庫各類筆數、來源檔案清單
// 依成員分組列出全部成員。分組邏輯為純函式（groupDocsByProfile），
// tests/ui/history_grouping.test.mjs 直測。
// 誤歸屬救援入口（misattribution-rescue design D5）：每筆來源檔案列
// 「刪除…」「改歸屬…」，開明細預覽確認面板；面板模型為純函式
// （buildRescuePreviewModel），tests/ui/rescue_preview.test.mjs 直測。
import { previewDocRescue, deleteSourceDocument, reattributeSourceDocument }
  from "../engine/doc_rescue.js";
import { listProfiles } from "../engine/profiles.js";

export const ADAPTER_LABELS = {
  nhi_json: "健保存摺（JSON）",
  nhi_xml: "健保存摺（XML）",
  apple_health: "Apple 健康",
  resmed_edf: "ResMed CPAP SD 卡",
};

export const RESCUE_TABLE_LABELS = {
  encounters: "就醫", medications: "用藥", lab_results: "檢驗",
  reports: "報告", immunizations: "疫苗", body_measurements: "身體數值",
  cancer_screenings: "癌症篩檢", apple_records: "Apple 紀錄",
  apple_workouts: "Apple 體能訓練",
  cpap_daily: "睡眠每日摘要", cpap_events: "呼吸事件", cpap_oximetry: "睡眠血氧",
};

// 紀錄頁「全部資料」那行要統計的表，依顯示順序排（標籤共用
// RESCUE_TABLE_LABELS，不另養一份）。2026-08-13 實機走查發現這份清單原本
// 漏了六張表（CPAP 三表、apple_workouts、body_measurements、
// cancer_screenings），畫面上列著 41 個 CPAP 來源檔卻一筆都沒算進去。
// tests/ui/history_grouping.test.mjs 以 DDL 對帳釘住：schema 新增資料表
// 而這裡沒跟上就會轉紅。
export const COUNT_TABLES = ["encounters", "medications", "lab_results",
  "reports", "immunizations", "cancer_screenings", "apple_records",
  "apple_workouts", "body_measurements",
  "cpap_daily", "cpap_events", "cpap_oximetry"];

// 轉義含 " （面板有屬性位置插值需求，且與 profile_manager／import_flow
// 的 esc 保持一致，杜絕屬性逃逸；tests/ui/esc_consistency.test.mjs 釘住）
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

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

// 純函式：previewDocRescue 結果 → 面板顯示模型（design D5、決定 #52）。
// mode: "delete" | "reattribute"；targetName: 已選目標成員名（未選＝null）
export function buildRescuePreviewModel(preview, { mode, targetName = null }) {
  const countsTotal = Object.values(preview.counts).reduce((s, n) => s + n, 0);
  const countsText = Object.entries(preview.counts)
    .filter(([, c]) => c > 0)
    .map(([t, c]) => `${RESCUE_TABLE_LABELS[t] || t} ${c.toLocaleString()}`)
    .join("、") || "無資料列";
  // D2 重疊警告（doc 級啟發式，可能過度警告故文案用「可能」）
  const warning = preview.overlapWarning
    ? "注意：這位成員的其他匯入檔案曾與本檔發生重複紀錄。此操作可能"
      + "連帶移除其他檔案也含有的紀錄，且因重複檔案判定，該些檔案"
      + "無法重匯回補。"
    : null;
  if (mode === "delete") {
    return {
      summary: `即將刪除來源檔案「${preview.doc.filename}」與其全部資料列`
        + "（此檔案之後可重新匯入）。",
      countsText, warning,
      blocked: false, blockReason: null, mergeText: null, bindingText: null,
      confirmDisabled: false,
    };
  }
  // reattribute
  const guard = preview.nhiGuard;
  const blocked = guard?.blocked ?? false;
  let mergeText = null;
  if (targetName != null && preview.merge) {
    const moved = countsTotal - preview.merge.total;
    mergeText = `搬移 ${moved.toLocaleString()} 筆`
      + (preview.merge.total > 0
        ? `、與「${targetName}」既有紀錄重複合併 ${preview.merge.total.toLocaleString()} 筆`
        : "");
  }
  const bindingText = guard && !blocked && guard.willUnbindSource
    ? `「${preview.doc.displayName}」的健保身分證綁定將解除並轉移給`
      + `「${targetName}」。`
    : null;
  return {
    summary: `即將把來源檔案「${preview.doc.filename}」連同其全部資料列`
      + `改歸屬${targetName ? `給「${targetName}」` : ""}。`,
    countsText, warning,
    blocked, blockReason: blocked ? guard.reason : null,
    mergeText, bindingText,
    confirmDisabled: blocked || targetName == null,
  };
}

export function createHistory({ getDriver, getDbPath, onRescued, notify }) {
  const box = document.getElementById("import-history");
  // 進行中的救援面板狀態；refresh() 整卡重繪即收合
  let rescue = null; // { mode, docId, targetProfileId }

  const sumValues = (obj) => Object.values(obj).reduce((s, n) => s + n, 0);

  async function renderRescuePanel() {
    const panel = box.querySelector("#rescue-inline");
    if (!panel || !rescue) return;
    const driver = getDriver();
    const preview = await previewDocRescue(driver, rescue.docId,
      { targetProfileId: rescue.targetProfileId });
    const profiles = await listProfiles(driver);
    const targets = profiles.filter(p => p.id !== preview.doc.profileId);
    const target = targets.find(t => t.id === rescue.targetProfileId) ?? null;
    const model = buildRescuePreviewModel(preview,
      { mode: rescue.mode, targetName: target?.display_name ?? null });
    const targetPicker = rescue.mode !== "reattribute" ? "" : (targets.length
      ? `<p>改歸屬給：<select id="rescue-target">
          <option value="" ${target ? "" : "selected"} disabled>請選擇成員</option>
          ${targets.map(t => `<option value="${t.id}"
            ${t.id === rescue.targetProfileId ? "selected" : ""}>
            ${esc(t.display_name)}</option>`).join("")}
        </select></p>`
      : "<p class=\"warn\">尚無其他成員可改歸屬，請先於「管理成員…」新增。</p>");
    panel.hidden = false;
    panel.innerHTML = `
      <p>${esc(model.summary)}</p>
      <p class="dt">內容：${esc(model.countsText)}；匯入於 ${esc(preview.doc.importedAt)}，
        原歸屬「${esc(preview.doc.displayName)}」。</p>
      ${targetPicker}
      ${model.mergeText ? `<p>${esc(model.mergeText)}</p>` : ""}
      ${model.bindingText ? `<p>${esc(model.bindingText)}</p>` : ""}
      ${model.warning ? `<p class="warn">${esc(model.warning)}</p>` : ""}
      ${model.blockReason ? `<p class="warn">${esc(model.blockReason)}</p>` : ""}
      <button id="rescue-go" type="button" class="danger"
        ${model.confirmDisabled ? "disabled" : ""}>
        ${rescue.mode === "delete" ? "確認刪除" : "確認改歸屬"}</button>
      <button id="rescue-cancel" type="button" class="btn">取消</button>`;
    panel.querySelector("#rescue-target")?.addEventListener("change", async (e) => {
      rescue.targetProfileId = Number(e.target.value);
      await renderRescuePanel();
    });
    panel.querySelector("#rescue-cancel").addEventListener("click", () => {
      rescue = null;
      panel.hidden = true;
      panel.innerHTML = "";
    });
    panel.querySelector("#rescue-go").addEventListener("click", executeRescue);
  }

  async function executeRescue() {
    const { mode, docId, targetProfileId } = rescue;
    const driver = getDriver();
    try {
      if (mode === "delete") {
        const r = await deleteSourceDocument(driver, docId);
        notify(`已刪除來源檔案與其資料 ${sumValues(r.deleted).toLocaleString()} 筆`
          + `${r.unbound ? "，並解除該成員的健保身分證綁定" : ""}。`
          + "同一檔案之後可重新匯入。", 10000);
      } else {
        const r = await reattributeSourceDocument(driver, docId, targetProfileId);
        notify(`已改歸屬：搬移 ${sumValues(r.moved).toLocaleString()} 筆`
          + (sumValues(r.merged) > 0
            ? `、與目標既有紀錄合併 ${sumValues(r.merged).toLocaleString()} 筆` : "")
          + `${r.binding.targetBound ? "，健保身分證綁定已隨之轉移" : ""}。`, 10000);
      }
      rescue = null;
      // 統一收斂點刷新（切換器＋狀態列＋檢視頁＋本卡）；失敗上浮不靜默
      await onRescued?.();
    } catch (err) {
      notify(`救援操作失敗：${String(err?.message || err)}`, 10000);
      // 面板留著讓使用者重試或取消；重算預覽（資料庫狀態可能已不同）
      await renderRescuePanel().catch(() => {
        rescue = null;
        box.querySelector("#rescue-inline")?.setAttribute("hidden", "");
      });
    }
  }

  async function refresh() {
    rescue = null; // 整卡重繪：收合進行中的面板，避免引用失效 doc
    const driver = getDriver();
    const counts = {};
    for (const t of COUNT_TABLES) {
      const [{ c }] = await driver.select(`SELECT count(*) c FROM ${t}`);
      counts[RESCUE_TABLE_LABELS[t] || t] = c;
    }
    const docs = await driver.select(
      "SELECT d.id, d.filename, d.adapter, d.imported_at, d.import_stats,"
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
        <td>${esc(d.filename)}</td><td class="dt">${added}</td>
        <td class="dt"><button type="button" class="btn rescue-btn"
            data-mode="reattribute" data-doc="${d.id}">改歸屬…</button>
          <button type="button" class="btn rescue-btn"
            data-mode="delete" data-doc="${d.id}">刪除…</button></td></tr>`;
    };
    const groups = groupDocsByProfile(docs.map(r => ({ ...r })));
    const groupHtml = groups.map((g) => `
      <h4 class="profile-group">成員「${esc(g.profileName)}」</h4>
      <table><thead><tr><th>匯入時間</th><th>格式</th><th>檔案</th><th></th><th></th></tr></thead>
        <tbody>${g.docs.map(docRow).join("")}</tbody></table>`).join("");
    box.innerHTML = `
      <h3>資料庫與匯入紀錄</h3>
      <p class="dbline">全部資料：${esc(countText)}</p>
      <p class="dbline dt">資料庫位置：${esc(getDbPath())}</p>
      <div id="rescue-inline" hidden></div>
      ${groupHtml}`;
    for (const btn of box.querySelectorAll(".rescue-btn")) {
      btn.addEventListener("click", async () => {
        rescue = { mode: btn.dataset.mode, docId: Number(btn.dataset.doc),
          targetProfileId: null };
        try {
          await renderRescuePanel();
        } catch (err) {
          rescue = null;
          notify(`無法載入救援預覽：${String(err?.message || err)}`, 10000);
        }
      });
    }
  }

  return { refresh };
}
