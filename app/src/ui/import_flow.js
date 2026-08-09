// 匯入操作流程（app-import-gui spec）：判型確認 → 進度 → 報告卡/防護訊息。
// 狀態機：idle → confirming → importing → done/aborted/error。
// 防重入：importing 期間拒收新檔（spec「匯入中防重入」）。
import { registry } from "../adapters/index.js";
import { tauriFileSource, resolveAppleDirTauri } from "../engine/tauri_source.js";
import { nhiJsonAdapter } from "../adapters/nhi_json.js";
import { nhiXmlAdapter } from "../adapters/nhi_xml.js";

const $ = (id) => document.getElementById(id);

export function createImportFlow({ getDriver, labEntries, onImported }) {
  let state = "idle";
  let pending = null; // { adapter, source, path }

  const panel = $("import-panel");
  const msg = $("import-msg");
  const confirmBox = $("import-confirm");
  const progressBox = $("import-progress");
  const bar = $("import-bar");
  const progressText = $("import-progress-text");
  const reportBox = $("import-report");

  function show(el) {
    for (const e of [confirmBox, progressBox, reportBox]) e.hidden = e !== el;
    panel.hidden = false;
  }
  function say(text) {
    msg.textContent = text;
    msg.hidden = !text;
  }

  async function offerFile(path) {
    if (state === "importing") {
      say("匯入進行中，請等本次完成後再加入新檔案。");
      return { state, rejected: "busy" };
    }
    // 資料夾（Apple 匯出資料夾情境）→ 解析出 XML 檔
    const fs = window.__TAURI__.fs;
    const st = await fs.stat(path).catch(() => null);
    if (!st) {
      say(`讀不到檔案：${path}`);
      return { state, rejected: "unreadable" };
    }
    let filePath = path;
    if (st.isDirectory) {
      const resolved = await resolveAppleDirTauri(path);
      if (!resolved) {
        say("資料夾內找不到 Apple Health 匯出 XML。");
        return { state, rejected: "no_xml_in_dir" };
      }
      filePath = resolved;
    }
    const source = await tauriFileSource(filePath);
    const header = await source.readAt(0, Math.min(65536, source.size));
    const adapter = registry.detect(header, source.name);
    if (!adapter) {
      say(`無法識別「${source.name}」。目前支援的格式：`);
      confirmBox.innerHTML = `<ul>${registry.formats()
        .map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`;
      show(confirmBox);
      state = "idle";
      return { state, rejected: "unknown_format", formats: registry.formats() };
    }
    pending = { adapter, source, path: filePath };
    state = "confirming";
    say("");
    confirmBox.innerHTML = `
      <p>判型結果：<strong>${escapeHtml(adapter.formatDesc)}</strong></p>
      <p>檔案：${escapeHtml(source.name)}（${(source.size / 1048576).toFixed(1)}MB）</p>
      <button id="import-go" type="button">開始匯入</button>
      <button id="import-cancel" type="button">取消</button>`;
    show(confirmBox);
    $("import-go").addEventListener("click", () => runImport());
    $("import-cancel").addEventListener("click", () => {
      pending = null; state = "idle"; panel.hidden = true;
    });
    return { state, detected: adapter.id };
  }

  async function runImport() {
    if (!pending || state === "importing") return { state };
    const { adapter, source, path } = pending;
    state = "importing";
    show(progressBox);
    bar.value = 0;
    progressText.textContent = "開始匯入…";
    const progress = (processed, totalBytes, readBytes) => {
      window.__MHB_PROGRESS_EVENTS__ = (window.__MHB_PROGRESS_EVENTS__ || 0) + 1;
      if (totalBytes > 0) bar.value = Math.min(100, (readBytes / totalBytes) * 100);
      progressText.textContent =
        `已處理 ${processed.toLocaleString()} 筆（${Math.round(bar.value)}%）`;
    };
    let result;
    try {
      const needsBytes = adapter === nhiJsonAdapter || adapter === nhiXmlAdapter;
      const src = needsBytes
        ? { bytes: await window.__TAURI__.fs.readFile(path), name: source.name }
        : source;
      result = await adapter.importSource(src, getDriver(), progress, {
        labEntries,
        // dev spike 無頭驅動用旗標（隨 spike.js 一併移除；正式路徑恆走對話框）
        assumeProfile: window.__MHB_TEST_ASSUME_PROFILE__ === true,
        confirmNewProfile: async (maskedId) => {
          const ask = window.__TAURI__.dialog.ask || window.__TAURI__.dialog.default?.ask;
          return ask(`首次匯入：以遮罩身分證 ${maskedId} 建立本人資料？`,
            { title: "建立個人資料", kind: "info" });
        },
      });
    } catch (err) {
      state = "idle";
      pending = null;
      say(`匯入失敗：${err.message || err}`);
      panel.hidden = false;
      show(reportBox);
      reportBox.innerHTML = "";
      return { state, error: String(err.message || err) };
    }
    pending = null;
    state = "idle";
    renderResult(result);
    if (result.status === "ok") await onImported?.(result);
    return { state, result };
  }

  function renderResult(result) {
    say("");
    if (result.status === "skipped_duplicate") {
      reportBox.innerHTML = `<p>此檔案已於 <strong>${escapeHtml(result.importedAt)}</strong>
        匯入過（SHA-256 相同），已跳過，資料庫未變動。</p>`;
      show(reportBox);
      return;
    }
    if (result.status === "aborted") {
      reportBox.innerHTML = `<p class="warn">${escapeHtml(result.messages.at(-1) || "匯入中止")}</p>`;
      show(reportBox);
      return;
    }
    const r = result.report;
    const secRows = Object.entries(r.sections).map(([sec, info]) => {
      const extra = [
        info.inserted !== undefined ? `新增 ${info.inserted}` : "",
        info.note ? escapeHtml(info.note) : "",
      ].filter(Boolean).join("，");
      return `<tr><td>${escapeHtml(sec)}</td><td>${escapeHtml(info.status)}</td>
        <td>${info.records}${extra ? `（${extra}）` : ""}</td></tr>`;
    }).join("");
    const dedup = r.dedup?.skipped_dup ?? {};
    const dedupText = Object.entries(dedup)
      .map(([t, n]) => `${escapeHtml(t)} 跳過 ${n}`).join("、") || "無";
    const flags = Object.entries(r.quality_flags ?? {})
      .map(([k, v]) => `${escapeHtml(k)}×${v}`).join("、") || "無";
    const unmapped = (r.unmapped_lab_names ?? []);
    const perr = r.source.parse_errors ?? [];
    reportBox.innerHTML = `
      <h3>匯入完成：${escapeHtml(r.source.filename)}</h3>
      <table><thead><tr><th>節區</th><th>狀態</th><th>筆數</th></tr></thead>
        <tbody>${secRows}</tbody></table>
      <p>重複（冪等跳過）：${dedupText}</p>
      <p>品質旗標：${flags}</p>
      ${unmapped.length ? `<p>未對照檢驗名 ${unmapped.length} 項：${unmapped.map(escapeHtml).join("、")}</p>` : ""}
      ${perr.length ? `<details class="warn"><summary>部分紀錄解析失敗（已續行，該筆未入庫）：${perr.length} 筆</summary>
        <ul>${perr.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul></details>` : ""}`;
    show(reportBox);
  }

  return {
    offerFile,
    runImport,
    getState: () => state,
  };
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
