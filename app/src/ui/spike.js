// dev spike（task 0.2/0.3/1.3/1.4）：偵測 /tmp/mhb_spike_request.json 即自動
// 執行，結果寫 /tmp/mhb_spike_result.json。正式匯入 GUI（task 4.x）落地後移除本檔。
import { TauriDriver } from "../store/tauri_driver.js";
import { runSmoke } from "../store/smoke.js";

const REQ = "/tmp/mhb_spike_request.json";
const RES = "/tmp/mhb_spike_result.json";

const WANTED = new Set([
  "HKQuantityTypeIdentifierBodyMass", "HKQuantityTypeIdentifierBodyMassIndex",
  "HKQuantityTypeIdentifierHeight", "HKQuantityTypeIdentifierBodyFatPercentage",
  "HKQuantityTypeIdentifierLeanBodyMass", "HKQuantityTypeIdentifierBloodPressureSystolic",
  "HKQuantityTypeIdentifierBloodPressureDiastolic", "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierRestingHeartRate", "HKQuantityTypeIdentifierOxygenSaturation",
  "HKQuantityTypeIdentifierRespiratoryRate", "HKCategoryTypeIdentifierSleepAnalysis",
  "HKQuantityTypeIdentifierStepCount", "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierDistanceCycling", "HKQuantityTypeIdentifierFlightsClimbed",
  "HKQuantityTypeIdentifierActiveEnergyBurned", "HKQuantityTypeIdentifierBasalEnergyBurned",
  "HKQuantityTypeIdentifierWalkingSpeed", "HKQuantityTypeIdentifierWalkingStepLength",
  "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage",
  "HKQuantityTypeIdentifierWalkingAsymmetryPercentage",
  "HKQuantityTypeIdentifierAppleWalkingSteadiness",
  "HKQuantityTypeIdentifierHeadphoneAudioExposure", "HKQuantityTypeIdentifierDietaryWater",
  "HKQuantityTypeIdentifierDietaryEnergyConsumed", "HKQuantityTypeIdentifierDietaryFatTotal",
  "HKQuantityTypeIdentifierDietaryCarbohydrates", "HKQuantityTypeIdentifierDietaryProtein",
]);

const ATTR_RE = /([A-Za-z_][\w.:-]*)="([^"]*)"/g;
function attrs(tag) {
  const out = {}; let m; ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag)) !== null) out[m[1]] = m[2];
  return out;
}

function scan(buf, sink) {
  let pos = 0;
  for (;;) {
    const lt = buf.indexOf("<", pos);
    if (lt === -1) return buf.length;
    if (buf.length - lt < 9) return lt; // 殘尾不足以判定標籤名，留給下一 chunk（差分實測修正）
    const rest = buf.slice(lt + 1, lt + 9);
    const isRecord = rest.startsWith("Record ");
    const isWorkout = rest.startsWith("Workout ");
    if (!isRecord && !isWorkout) { pos = lt + 1; continue; }
    const gt = buf.indexOf(">", lt);
    if (gt === -1) return lt;
    sink(isRecord ? "Record" : "Workout", attrs(buf.slice(lt + 1, buf[gt - 1] === "/" ? gt - 1 : gt)));
    pos = gt + 1;
  }
}

// task 0.2：fs plugin 分塊讀＋掃描 220MB 合成檔
async function parseSpike(fs, filePath) {
  const t0 = performance.now();
  const file = await fs.open(filePath, { read: true });
  const CHUNK = 4 * 1024 * 1024;
  const buf = new Uint8Array(CHUNK);
  const decoder = new TextDecoder("utf-8");
  let carry = "", records = 0, workouts = 0, readBytes = 0;
  const sink = (kind, a) => {
    if (kind === "Workout") { workouts++; return; }
    if (WANTED.has(a.type)) records++;
  };
  for (;;) {
    const n = await file.read(buf);
    if (n === null || n === 0) break;
    readBytes += n;
    carry += decoder.decode(buf.subarray(0, n), { stream: true });
    const consumed = scan(carry, sink);
    carry = carry.slice(consumed);
  }
  carry += decoder.decode();
  scan(carry, sink);
  await file.close();
  const seconds = (performance.now() - t0) / 1000;
  return { seconds: +seconds.toFixed(2), mb: +(readBytes / 1048576).toFixed(1),
           mb_per_s: +(readBytes / 1048576 / seconds).toFixed(1), records, workouts };
}

// task 0.3 復驗（D2 修訂二後）：SQLite 橋單交易批寫 10 萬筆（json_each）
async function batchSpike(_sql, dbPath, opts = {}) {
  const { holdOpen = false } = opts;
  const db = await TauriDriver.open(dbPath);
  await db.execute(`CREATE TABLE IF NOT EXISTS apple_records(
    id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, doc_id INTEGER NOT NULL,
    type TEXT NOT NULL, type_zh TEXT NOT NULL, start_ts TEXT NOT NULL, end_ts TEXT NOT NULL,
    value_numeric REAL, value_normalized REAL, value_text TEXT, unit TEXT,
    source_name TEXT, quality_flags TEXT NOT NULL DEFAULT '')`);
  await db.execute("DELETE FROM apple_records");
  const t0 = performance.now();
  const TOTAL = 100000;
  const COLS = ["id", "profile_id", "doc_id", "type", "type_zh", "start_ts", "end_ts",
    "value_numeric", "value_normalized", "value_text", "unit", "source_name", "quality_flags"];
  const rows = Array.from({ length: TOTAL }, (_, k) => [null, 1, 1,
    "HKQuantityTypeIdentifierStepCount", "步數",
    `2026-01-01 00:00:${String(k % 60).padStart(2, "0")}`, "2026-01-01 00:01:00",
    k, null, null, "count", `src${k}`, ""]);
  await db.execute("BEGIN");
  await db.batchInsert("apple_records", COLS, rows);
  if (holdOpen) {
    // kill 演練：不 COMMIT，留交易開著等外部 kill
    return { held: true };
  }
  await db.execute("COMMIT");
  const seconds = (performance.now() - t0) / 1000;
  const out = await db.select("SELECT count(*) c FROM apple_records");
  return { seconds: +seconds.toFixed(2), count: out[0].c };
}

export async function maybeRunSpike(statusEl, ctx = {}) {
  const t = window.__TAURI__;
  if (!t?.fs) return;
  let req;
  try {
    req = JSON.parse(await t.fs.readTextFile(REQ));
  } catch {
    return; // 無請求檔＝一般啟動
  }
  await t.fs.remove(REQ).catch(() => {}); // 消費請求檔，防 hot-reload 重入
  statusEl.textContent = "spike 執行中…";
  const result = { started_at: new Date().toISOString() };
  try {
    if (req.boot_report) result.boot = ctx.bootInfo ?? null;
    // 無頭驅動匯入 GUI（task 4.x G3）：與拖放同一條 offerFile→runImport 路徑
    if (req.gui_import && ctx.flow) {
      if (req.gui_import.assumeProfile) window.__MHB_TEST_ASSUME_PROFILE__ = true;
      const offer = await ctx.flow.offerFile(req.gui_import.path);
      let run = null;
      if (offer.state === "confirming" && req.gui_import.autoConfirm !== false) {
        run = await ctx.flow.runImport();
      }
      const reportEl = document.getElementById("import-report");
      const msgEl = document.getElementById("import-msg");
      result.gui = {
        offer,
        progress_events: window.__MHB_PROGRESS_EVENTS__ || 0,
        status: run?.result?.status ?? null,
        sections: run?.result?.report?.sections ?? null,
        parse_errors: run?.result?.report?.source?.parse_errors?.length ?? null,
        report_text: (reportEl?.textContent || "").slice(0, 600),
        msg_text: msgEl?.textContent || "",
        status_line: statusEl.textContent,
      };
    }
    if (req.viewer_check && ctx.app?.viewer) {
      const r = await ctx.app.viewer.refresh();
      const frame = document.getElementById("viewer-frame");
      let inner = "";
      try { inner = frame?.contentDocument?.body?.textContent?.slice(0, 400) || ""; } catch {}
      result.viewer = { ...r, iframe_hidden: frame?.hidden ?? null, inner_head: inner };
    }
    if (req.export_html && ctx.app?.viewer) {
      result.export = await ctx.app.viewer.exportHtml(req.export_html.path);
    }
    if (req.driver_smoke_db) {
      const d = await TauriDriver.open(req.driver_smoke_db);
      result.smoke = await runSmoke(d);
      await d.close();
    }
    if (req.import_db && ctx.importExisting) {
      result.import = await ctx.importExisting(req.import_db);
    }
    if (req.parse_file) result.parse = await parseSpike(t.fs, req.parse_file);
    if (req.batch_db) {
      if (req.batch_hold) {
        await t.fs.writeTextFile(RES, JSON.stringify({ ...result, holding: true }));
        await batchSpike(t.sql, req.batch_db, { holdOpen: true });
        statusEl.textContent = "spike 交易保持中（等待 kill 演練）";
        return;
      }
      result.batch = [];
      for (const cfg of req.batch_configs || [{}]) {
        result.batch.push(await batchSpike(t.sql, req.batch_db, cfg));
      }
    }
    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = String(err?.message || err);
  }
  await t.fs.writeTextFile(RES, JSON.stringify(result, null, 1));
  statusEl.textContent = `spike 完成：${JSON.stringify(result)}`;
}
