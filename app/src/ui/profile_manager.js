// 成員管理面板（profile-management spec）：清單（名稱/遮罩身分證/筆數
// 摘要）、新增、改名、刪除（顯示筆數＋輸入成員名稱才啟用刪除，D5）。
// 全程 in-app 元素，不用原生 confirm/prompt（會凍住 WebView 事件）。
import { listProfiles, createProfile, renameProfile, deleteProfile,
  profileCounts } from "../engine/profiles.js";

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const COUNT_LABELS = [
  ["encounters", "就醫"], ["medications", "用藥"], ["lab_results", "檢驗"],
  ["reports", "報告"], ["immunizations", "疫苗"],
  ["body_measurements", "身體數值"], ["cancer_screenings", "癌篩"],
  ["apple_records", "Apple 紀錄"], ["apple_workouts", "Apple 運動"],
  ["source_documents", "來源檔案"],
];

export function countsSummary(counts) {
  const parts = COUNT_LABELS
    .filter(([k]) => (counts[k] || 0) > 0)
    .map(([k, label]) => `${label} ${counts[k].toLocaleString()}`);
  return parts.join("、") || "尚無資料";
}

export function createProfileManager({ getDriver, getCurrentProfileId, onChanged }) {
  const box = document.getElementById("profile-manager");
  let confirmingDelete = null; // 進行中的刪除確認 { id, name, counts }

  function say(text, isError = true) {
    const el = box.querySelector("#pm-msg");
    if (el) {
      el.textContent = text;
      el.hidden = !text;
      el.classList.toggle("warn", isError);
    }
  }

  async function render() {
    const driver = getDriver();
    const profiles = await listProfiles(driver);
    const rows = [];
    for (const p of profiles) {
      const counts = await profileCounts(driver, p.id);
      const isCurrent = p.id === getCurrentProfileId();
      rows.push(`
        <tr data-id="${p.id}">
          <td><strong>${esc(p.display_name)}</strong>${isCurrent ? "（檢視中）" : ""}</td>
          <td class="dt">${p.masked_id ? esc(p.masked_id) : "未綁定"}</td>
          <td class="dt">${esc(countsSummary(counts))}</td>
          <td>
            <button type="button" class="btn pm-rename" data-id="${p.id}"
              data-name="${esc(p.display_name)}">改名</button>
            <button type="button" class="btn pm-delete" data-id="${p.id}"
              data-name="${esc(p.display_name)}">刪除…</button>
          </td>
        </tr>`);
    }
    box.innerHTML = `
      <div class="pm-card">
        <h3>管理成員</h3>
        <p id="pm-msg" class="warn" hidden></p>
        ${profiles.length ? `<table>
          <thead><tr><th>名稱</th><th>遮罩身分證</th><th>資料</th><th></th></tr></thead>
          <tbody>${rows.join("")}</tbody></table>` : "<p>尚無成員。</p>"}
        <div class="pm-add">
          <input id="pm-new-name" type="text" placeholder="新成員名稱（如：媽媽）">
          <button id="pm-add-btn" type="button" class="primary">新增成員</button>
        </div>
        <div id="pm-inline" hidden></div>
        <div class="pm-foot"><button id="pm-close" type="button" class="btn">關閉</button></div>
      </div>`;
    wire();
  }

  function wire() {
    box.querySelector("#pm-close").addEventListener("click", () => { box.hidden = true; });
    box.querySelector("#pm-add-btn").addEventListener("click", async () => {
      const name = box.querySelector("#pm-new-name").value;
      try {
        await createProfile(getDriver(), name);
        await render();
        await onChanged?.();
      } catch (e) { say(String(e.message || e)); }
    });
    for (const btn of box.querySelectorAll(".pm-rename")) {
      btn.addEventListener("click", () => showRename(
        Number(btn.dataset.id), btn.dataset.name));
    }
    for (const btn of box.querySelectorAll(".pm-delete")) {
      btn.addEventListener("click", () => showDelete(
        Number(btn.dataset.id), btn.dataset.name));
    }
  }

  function showRename(id, oldName) {
    const inline = box.querySelector("#pm-inline");
    inline.hidden = false;
    inline.innerHTML = `
      <p>將「${esc(oldName)}」改名為：</p>
      <input id="pm-rename-name" type="text" value="${esc(oldName)}">
      <button id="pm-rename-go" type="button" class="primary">確定改名</button>
      <button id="pm-rename-cancel" type="button" class="btn">取消</button>`;
    inline.querySelector("#pm-rename-cancel").addEventListener("click",
      () => { inline.hidden = true; });
    inline.querySelector("#pm-rename-go").addEventListener("click", async () => {
      try {
        await renameProfile(getDriver(), id, inline.querySelector("#pm-rename-name").value);
        await render();
        await onChanged?.();
      } catch (e) { say(String(e.message || e)); }
    });
  }

  // 刪除二次確認（D5）：顯示各類筆數，輸入成員名稱完全一致才啟用刪除鈕
  async function showDelete(id, name) {
    const counts = await profileCounts(getDriver(), id);
    confirmingDelete = { id, name };
    const inline = box.querySelector("#pm-inline");
    inline.hidden = false;
    inline.innerHTML = `
      <p class="warn">即將刪除成員「${esc(name)}」與其全部資料：${esc(countsSummary(counts))}。
        此動作無法復原（原始下載檔仍在您的電腦上，可重新匯入）。</p>
      <p>請輸入成員名稱「${esc(name)}」以確認刪除：</p>
      <input id="pm-del-name" type="text" placeholder="${esc(name)}">
      <button id="pm-del-go" type="button" class="danger" disabled>永久刪除</button>
      <button id="pm-del-cancel" type="button" class="btn">取消</button>`;
    const input = inline.querySelector("#pm-del-name");
    const go = inline.querySelector("#pm-del-go");
    input.addEventListener("input", () => {
      go.disabled = input.value.trim() !== confirmingDelete.name;
    });
    inline.querySelector("#pm-del-cancel").addEventListener("click", () => {
      confirmingDelete = null;
      inline.hidden = true;
    });
    go.addEventListener("click", async () => {
      if (input.value.trim() !== confirmingDelete.name) return; // 雙保險
      try {
        await deleteProfile(getDriver(), confirmingDelete.id);
        confirmingDelete = null;
        await render();
        await onChanged?.();
      } catch (e) { say(String(e.message || e)); }
    });
  }

  return {
    open: async () => { box.hidden = false; await render(); },
    close: () => { box.hidden = true; },
  };
}
