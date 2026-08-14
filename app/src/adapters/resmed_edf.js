// ResMed 原生 EDF adapter（change cpap-sleep-therapy 第 3 組）。
//
// 與既有三個 adapter 的根本差異：一次匯入是一整個 SD 卡資料夾的多個檔案，
// 因此實作 importSourceSet 而非 importSource（design D1）。整批在單一
// 交易內完成，中途失敗全庫回滾。
//
// source_documents 每檔一列（design D2）：沿用既有 UNIQUE(sha256) 語意，
// 下次插卡只有新檔被處理，且來源追溯精確到檔。
import { EngineStore } from "../engine/store.js";
import { requireProfile } from "../engine/profiles.js";
import { Sha256 } from "../engine/sha256.js";
import { buildIncremental } from "../engine/quality_report.js";
import {
  parseHeader, scaleValue, isSentinel, findSignal, readSignalRecord,
  actualRecordCount, readAnnotations, offsetISO, EdfFormatError,
} from "./edf.js";

export const ADAPTER_ID = "resmed_edf";
export const ADAPTER_VERSION = "1.0.0";

// 單檔讀入上限。edf.js 收到的已經是位元組陣列，那時記憶體已經耗掉，
// 因此上限必須在「決定要不要把這個檔讀進來」這一層把關（tasks 3.1）。
// 本專案解析的三種檔實測都在百 KB 等級，8MB 已是極寬鬆的天花板。
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

// 解析對象＝STR.edf 加下列兩種後綴；PLD（逐分鐘 11 訊號）與 BRP（波形）
// 依 design 排除，且未被解析的檔不建 source_documents 列（design D2）
const PARSED_SUFFIXES = ["_EVE.edf", "_SAD.edf"];
const STR_NAME = "STR.edf";
const IDENT_NAME = "Identification.tgt";

// 每日摘要的欄位映射：STR.edf 的訊號標籤 → cpap_daily 欄位。
// 標籤用檔案中實際出現的字串（label 欄位僅 16 字元，長標籤已被來源截斷）。
// 送氣壓力（機器輸出）進主要欄位，面罩壓力與吐氣壓力進 extra_json：
// 主要欄位只放兩台機器共通的臨床量，不長成 ResMed 的形狀（proposal 約束）。
const DAILY_MAP = {
  "Mask Dur": "usage_min",
  AHI: "ahi",
  AI: "ai",
  HI: "hi",
  OAI: "oai",
  CAI: "cai",
  UAI: "uai",
  "Leak Med": "leak_median",
  "Leak 95": "leak_95",
  "Leak Max": "leak_max",
  "Therapy Pres Me": "pressure_median",
  "Therapy Pres 95": "pressure_95",
  "Therapy Pres Ma": "pressure_max",
  "Set Pressure": "pressure_set",
  "Min Pressure": "pressure_min_setting",
  "Max Pressure": "pressure_max_setting",
  Mode: "mode_raw",
  "Mask Events": "mask_events",
};

// 保留但不進主要欄位的訊號（存 extra_json，日後要用不必重新匯入）
const EXTRA_LABELS = [
  "Mask Pres Med", "Mask Pres 95", "Mask Pres Max",
  "Exp Pres Med", "Exp Pres 95", "Exp Pres Max", "EPR", "EPR Level",
];

const DAILY_COLS = ["profile_id", "doc_id", "device", "summary_date",
  "session_start_min", "session_end_min", "session_count", "usage_min",
  "ahi", "ai", "hi", "oai", "cai", "uai",
  "leak_median", "leak_95", "leak_max",
  "pressure_median", "pressure_95", "pressure_max",
  "pressure_set", "pressure_min_setting", "pressure_max_setting",
  "mode_raw", "mask_events", "extra_json", "quality_flags"];

const EVENT_COLS = ["profile_id", "doc_id", "device", "session_date",
  "start_ts", "duration_sec", "event_type", "quality_flags"];

const OXI_COLS = ["profile_id", "doc_id", "device", "session_date",
  "minute_ts", "spo2_min", "spo2_mean", "pulse_mean", "pulse_max",
  "sample_count", "quality_flags"];

// 非事件的 annotation：標記錄製起點，不是呼吸事件（design 格式事實 4）
const NON_EVENT_LABELS = new Set(["Recording starts"]);

// 正午邊界（design D4）：一個「紀錄夜」自正午起算，因此起始時刻在正午前
// 者屬於前一天。STR 的每日摘要與 DATALOG 的事件／血氧共用這條規則，
// 不可改用檔名日期（午夜後就寢會與摘要差一天且無錯誤訊息）。
export function sessionDateOf(start) {
  const d = new Date(start.year, start.month - 1, start.day);
  if (start.hour < 12) d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// STR 的第 i 個 record 對應的日期。以日曆日推進而非加 86400 秒：
// 有日光節約的時區加固定秒數會漂移，日曆加法才是「隔天」的正確語意。
export function dailyDateOf(start, dayIndex) {
  const d = new Date(start.year, start.month - 1, start.day);
  d.setDate(d.getDate() + dayIndex);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Identification.tgt 的 #PNA 欄位＝機型字串。序號（#SRN）刻意不讀：
// 裝置識別碼，本專案用機型即足以區分兩台機器（design D3，個資最小化）。
export function parseDeviceModel(text) {
  const m = String(text).match(/^#PNA\s+(\S+)/m);
  return m ? m[1] : null;
}

// 逐分鐘聚合（design D6）：一個 EDF record 即一個分鐘桶（實測 dur=60、
// nsamp=60）。dur 非 60 時依實際取樣率改切 60 秒桶，不假設 record 邊界
// 等於分鐘邊界。
export function minuteBuckets(header, sig) {
  const rate = header.recordDuration > 0 ? sig.nsamp / header.recordDuration : 1;
  const perMinute = Math.max(1, Math.round(rate * 60));
  return { rate, perMinute, recordIsMinute: header.recordDuration === 60 };
}

const mean1 = (vals) =>
  Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;

async function readAll(source) {
  if (source.size > MAX_FILE_BYTES) return null;
  const chunks = [];
  let total = 0;
  for await (const c of await source.stream()) {
    chunks.push(c);
    total += c.length;
    if (total > MAX_FILE_BYTES) return null;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

function sha256Of(bytes) {
  const h = new Sha256();
  h.update(bytes);
  return h.hex();
}

// STR.edf → cpap_daily 列（未使用日回 null，由呼叫端計入 skipped_unused）
function dailyRow(bytes, header, r, ctx) {
  const { pid, docId, device } = ctx;
  const durSig = findSignal(header, "Mask Dur");
  if (!durSig) throw new EdfFormatError("STR.edf 缺少 Mask Dur 訊號");
  const durRaw = readSignalRecord(bytes, header, durSig, r);
  if (!durRaw) return null;
  // 未使用日：整筆不入庫（design D5）。判定用數位值低於 digMin，
  // 不可用 == digMin（那會漏掉全部缺測日並誤刪合法的 0 值）
  if (isSentinel(durRaw[0], durSig)) return null;

  const flags = [];
  const cols = {};
  for (const [label, col] of Object.entries(DAILY_MAP)) {
    const sig = findSignal(header, label);
    if (!sig) { cols[col] = null; continue; }
    const raw = readSignalRecord(bytes, header, sig, r);
    cols[col] = raw && !isSentinel(raw[0], sig) ? scaleValue(raw[0], sig) : null;
  }

  // Mask On/Off 各 10 個槽位：同一天可分多段使用（design D3）
  const onSig = findSignal(header, "Mask On");
  const offSig = findSignal(header, "Mask Off");
  const segments = [];
  if (onSig && offSig) {
    const on = readSignalRecord(bytes, header, onSig, r);
    const off = readSignalRecord(bytes, header, offSig, r);
    if (on && off) {
      for (let i = 0; i < on.length; i += 1) {
        if (isSentinel(on[i], onSig)) continue;
        segments.push([
          scaleValue(on[i], onSig),
          isSentinel(off[i], offSig) ? null : scaleValue(off[i], offSig),
        ]);
      }
    }
  }
  if (segments.length > 1) flags.push("multi_session");

  const extra = {};
  for (const label of EXTRA_LABELS) {
    const sig = findSignal(header, label);
    if (!sig) continue;
    const raw = readSignalRecord(bytes, header, sig, r);
    if (raw && !isSentinel(raw[0], sig)) extra[label] = scaleValue(raw[0], sig);
  }
  if (segments.length) extra.segments = segments;

  return [
    pid, docId, device, dailyDateOf(header.start, r),
    segments.length ? segments[0][0] : null,
    segments.length ? segments[segments.length - 1][1] : null,
    segments.length || null,
    cols.usage_min, cols.ahi, cols.ai, cols.hi, cols.oai, cols.cai, cols.uai,
    cols.leak_median, cols.leak_95, cols.leak_max,
    cols.pressure_median, cols.pressure_95, cols.pressure_max,
    cols.pressure_set, cols.pressure_min_setting, cols.pressure_max_setting,
    cols.mode_raw,
    cols.mask_events == null ? null : Math.round(cols.mask_events),
    Object.keys(extra).length ? JSON.stringify(extra) : null,
    flags.join(","),
  ];
}

function eventRows(bytes, header, ctx) {
  const { pid, docId, device } = ctx;
  const sessionDate = sessionDateOf(header.start);
  const rows = [];
  for (const e of readAnnotations(bytes, header)) {
    if (NON_EVENT_LABELS.has(e.label)) continue;
    rows.push([pid, docId, device, sessionDate,
      offsetISO(header, e.onset), e.duration, e.label, ""]);
  }
  return rows;
}

function oximetryRows(bytes, header, ctx) {
  const { pid, docId, device } = ctx;
  const pulse = findSignal(header, "Pulse");
  const spo2 = findSignal(header, "SpO2");
  if (!pulse && !spo2) return [];
  const ref = spo2 ?? pulse;
  const { perMinute, recordIsMinute } = minuteBuckets(header, ref);
  const sessionDate = sessionDateOf(header.start);
  const total = actualRecordCount(bytes, header);

  // 先攤平成逐樣本序列，再切 60 秒桶。record 恰為一分鐘時這等價於逐
  // record 聚合，但 dur 非 60 的檔案也能正確處理（design D6）。
  const flat = (sig) => {
    if (!sig) return [];
    const out = [];
    for (let r = 0; r < total; r += 1) {
      const raw = readSignalRecord(bytes, header, sig, r);
      if (!raw) break;
      for (const v of raw) out.push(isSentinel(v, sig) ? null : scaleValue(v, sig));
    }
    return out;
  };
  const pulseAll = flat(pulse);
  const spo2All = flat(spo2);
  const n = Math.max(pulseAll.length, spo2All.length);
  const rows = [];
  for (let start = 0, bucket = 0; start < n; start += perMinute, bucket += 1) {
    const ps = pulseAll.slice(start, start + perMinute).filter(v => v != null);
    const ss = spo2All.slice(start, start + perMinute).filter(v => v != null);
    const count = Math.max(ps.length, ss.length);
    if (count === 0) continue;   // 整桶皆為缺測則不建列（design D6）
    const secOffset = recordIsMinute
      ? bucket * 60
      : Math.round((start / perMinute) * 60);
    rows.push([pid, docId, device, sessionDate,
      offsetISO(header, secOffset).slice(0, 16),
      ss.length ? Math.min(...ss) : null,
      ss.length ? mean1(ss) : null,
      ps.length ? mean1(ps) : null,
      ps.length ? Math.max(...ps) : null,
      count, ""]);
  }
  return rows;
}

export const resmedEdfAdapter = {
  id: ADAPTER_ID,
  formatDesc: "ResMed CPAP SD 卡資料夾（含 STR.edf 與 DATALOG）",

  // 單檔判型：本 adapter 走多檔路徑，單檔情境不接受（整張卡才有意義）
  detect() {
    return false;
  },

  // 多檔判型（design D1／D9）：卡片內要有 STR.edf 且其 header 通過 EDF 判型。
  // 只讀這一個檔的 header：資料夾可能含上千個與本 adapter 無關的檔案，
  // 逐檔讀 header 會讓其他來源的匯入變慢。
  async detectSet(entries) {
    const str = entries.find(e => baseName(e.relPath) === STR_NAME);
    if (!str) return false;
    try {
      const h = parseHeader(await str.readHeader());
      return h.signalCount > 0 && findSignal(h, "Mask Dur") != null;
    } catch {
      return false;
    }
  },

  async importSourceSet(sourceSet, driver, progress, opts = {}) {
    const messages = [];
    const profile = await requireProfile(driver, opts.profileId);
    const pid = profile.id;
    const { rootName, entries } = sourceSet;

    // 機型字串供 device 欄位（UNIQUE 鍵含 device，兩台機器期間重疊時
    // 才不會被當成重複而靜默丟棄）
    let device = null;
    const ident = entries.find(e => baseName(e.relPath) === IDENT_NAME);
    if (ident) {
      const raw = await readAll(ident.source);
      if (raw) device = parseDeviceModel(new TextDecoder("utf-8", { fatal: false }).decode(raw));
    }
    const deviceUnknown = device == null;
    if (deviceUnknown) device = ADAPTER_ID;

    const targets = entries.filter(e => {
      const n = baseName(e.relPath);
      return n === STR_NAME || PARSED_SUFFIXES.some(s => n.endsWith(s));
    }).sort((a, b) => a.relPath.localeCompare(b.relPath));

    const totalBytes = targets.reduce((a, e) => a + (e.source.size || 0), 0);

    return driver.transaction(async (d) => {
      const store = new EngineStore(d);
      // 整批共用一個時間戳：檢視層以「同 adapter ＋同 imported_at」判定批次，
      // 逐列各自取 datetime('now') 會在跨秒時把同一批切成數批（D2）。
      const [{ ts: batchImportedAt }] = await d.select(
        "SELECT datetime('now') AS ts");
      const perFile = [];
      let readBytes = 0, processed = 0;
      let skippedUnused = 0, oversize = 0, parseErrors = 0;
      let newFiles = 0, dupFiles = 0;
      const counts = { cpap_daily: 0, cpap_events: 0, cpap_oximetry: 0 };

      for (const entry of targets) {
        const name = baseName(entry.relPath);
        const bytes = await readAll(entry.source);
        readBytes += entry.source.size || 0;
        if (!bytes) {
          oversize += 1;
          perFile.push({ file: entry.relPath, status: "skipped_oversize", rows: 0 });
          continue;
        }
        const sha = sha256Of(bytes);
        const reg = await store.registerSource(pid, entry.relPath, sha,
          ADAPTER_ID, ADAPTER_VERSION, batchImportedAt);
        if (reg.importedAt) {
          dupFiles += 1;
          perFile.push({ file: entry.relPath, status: "duplicate", rows: 0 });
          continue;
        }
        newFiles += 1;

        let header;
        try {
          header = parseHeader(bytes);
        } catch (err) {
          // 逐檔防線：單一壞檔不讓整批失敗，但明確計數並列在報告卡
          parseErrors += 1;
          perFile.push({ file: entry.relPath, status: "parse_error", rows: 0,
            note: String(err.message || err) });
          continue;
        }
        const ctx = { pid, docId: reg.docId, device };
        let rows = 0;
        let fileUnused = 0;

        if (name === STR_NAME) {
          const total = actualRecordCount(bytes, header);
          const batch = [];
          for (let r = 0; r < total; r += 1) {
            const row = dailyRow(bytes, header, r, ctx);
            if (!row) { fileUnused += 1; continue; }
            batch.push(row);
          }
          skippedUnused += fileUnused;
          rows = await d.batchInsert("cpap_daily", DAILY_COLS, batch, { ignore: true });
          counts.cpap_daily += rows;
        } else if (name.endsWith("_EVE.edf")) {
          const batch = eventRows(bytes, header, ctx);
          rows = await d.batchInsert("cpap_events", EVENT_COLS, batch, { ignore: true });
          counts.cpap_events += rows;
        } else {
          const batch = oximetryRows(bytes, header, ctx);
          rows = await d.batchInsert("cpap_oximetry", OXI_COLS, batch, { ignore: true });
          counts.cpap_oximetry += rows;
        }

        // 每一列的 import_stats ＝**該檔自己**插入與略過了什麼。任何一列都
        // NEVER 寫整批合計：紀錄頁與檢視層的批次摺疊會把同批各列相加，其中
        // 一列若裝的是合計就會雙重計算（2026-08-14 實測：4 個檔的批次顯示
        // 「新增 10 筆」而資料庫實際 6 筆；檔數越多差距越大，因為每個
        // DATALOG 檔的事件都被算了兩次）。這裡在重複檔 continue 之後，
        // 天然只寫入本次新建的列，符合
        // app-import-engine「匯入不破壞既有資料」的白名單。
        store.stats.inserted = {};
        store.stats.skipped_dup = {};
        if (rows) store.stats.inserted[tableOf(name)] = rows;
        if (fileUnused) store.stats.skipped_dup.cpap_daily_unused = fileUnused;
        await store.finalizeImport(reg.docId);
        perFile.push({ file: entry.relPath, status: "parsed", rows });
        processed += rows;
        progress?.(processed, totalBytes, readBytes);
      }

      if (deviceUnknown && newFiles > 0) {
        messages.push("讀不到機型資訊（Identification.tgt），"
          + "已以 adapter 名稱代替；同一台機器的資料仍會歸在一起。");
      }
      if (oversize > 0) messages.push(`${oversize} 個檔案超過單檔上限，已略過。`);

      // 整批都命中既有 sha256＝這張卡先前已完整匯入
      if (newFiles === 0 && dupFiles > 0) {
        return { status: "skipped_duplicate", importedAt: "先前",
          originDisplayName: profile.display_name,
          messages: [`這張卡的 ${dupFiles} 個檔案先前都已匯入，資料不會重複。`],
          source: { files: perFile, rootName } };
      }

      // 整批合計只餵給本次的匯入報告卡（buildIncremental 的 sections 與
      // dedup），MUST NOT 再寫進任何 source_documents 列，理由見上面逐檔
      // 寫入處的註解。
      store.stats.inserted = counts;
      store.stats.skipped_dup = skippedUnused
        ? { cpap_daily_unused: skippedUnused } : {};

      const report = await buildIncremental(store, {
        sections: {
          cpap_daily: { status: "parsed", records: counts.cpap_daily,
            note: skippedUnused ? `另有 ${skippedUnused} 天無使用紀錄，未入庫` : "" },
          cpap_events: { status: "parsed", records: counts.cpap_events },
          cpap_oximetry: { status: "parsed", records: counts.cpap_oximetry },
        },
        sourceInfo: {
          filename: rootName, files: perFile,
          new_files: newFiles, duplicate_files: dupFiles,
          parse_errors: parseErrors ? [`${parseErrors} 個檔案解析失敗`] : [],
          adapter: ADAPTER_ID, adapter_version: ADAPTER_VERSION,
        },
      });
      return { status: "ok", messages, report };
    });
  },
};

function baseName(relPath) {
  return String(relPath).split(/[/\\]/).pop();
}

function tableOf(name) {
  if (name === STR_NAME) return "cpap_daily";
  return name.endsWith("_EVE.edf") ? "cpap_events" : "cpap_oximetry";
}
