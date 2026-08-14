// JS 分塊串流解析 spike：模擬 Tauri fs 分塊讀（4MB chunk）＋純字串掃描。
// 目標：量測 百 MB 量級+ 檔案的解析吞吐量與正確性（與 Python oracle 對帳）。
// 不用任何外部依賴；TextDecoder streaming 處理 UTF-8 跨 chunk 邊界。
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";

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

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const decodeEntities = (s) =>
  s.includes("&") ? s.replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (m, d, h) => d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ENT[m]) : s;

// 從一個 start tag 內文抽屬性（不含 < 與 >）
const ATTR_RE = /([A-Za-z_][\w.:-]*)="([^"]*)"/g;
function attrs(tag) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag)) !== null) out[m[1]] = decodeEntities(m[2]);
  return out;
}

// 掃描 buffer 中所有完整的 <Record ...> / <Workout ...> start tag；
// 回傳處理到的位置，殘尾由呼叫端保留接續（跨 chunk 邊界安全）。
function scan(buf, sink) {
  let pos = 0;
  while (true) {
    const lt = buf.indexOf("<", pos);
    if (lt === -1) return buf.length;
    if (buf.length - lt < 9) return lt; // 殘尾不足以判定標籤名，留給下一 chunk（差分實測修正）
    const rest = buf.slice(lt + 1, lt + 9); // "Record " / "Workout " 判別夠用
    const isRecord = rest.startsWith("Record ") || rest.startsWith("Record\t");
    const isWorkout = rest.startsWith("Workout ");
    if (!isRecord && !isWorkout) { pos = lt + 1; continue; }
    const gt = buf.indexOf(">", lt);
    if (gt === -1) return lt; // tag 不完整，留給下一 chunk
    const tag = buf.slice(lt + 1, buf[gt - 1] === "/" ? gt - 1 : gt);
    sink(isRecord ? "Record" : "Workout", attrs(tag));
    pos = gt + 1;
  }
}

const toFloat = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };

async function main(path) {
  const fh = await open(path, "r");
  const { size } = await fh.stat();
  const CHUNK = 4 * 1024 * 1024;
  const buf = new Uint8Array(CHUNK);
  const decoder = new TextDecoder("utf-8");
  const typeCounts = new Map();
  let carry = "", records = 0, workouts = 0, epochFlags = 0;
  const hash = createHash("sha256"); // 對帳指紋：抽取欄位序列化後累積雜湊

  const sink = (kind, a) => {
    if (kind === "Workout") { workouts++; return; }
    const t = a.type;
    if (!WANTED.has(t)) return;
    records++;
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    const start = (a.startDate || "").slice(0, 19);
    const vnum = toFloat(a.value);
    if (start < "2000-01-01") epochFlags++;
    hash.update(`${t}|${start}|${(a.endDate || "").slice(0, 19)}|${vnum ?? a.value ?? ""}|${a.unit ?? ""}|${a.sourceName ?? ""}\n`);
  };

  const t0 = performance.now();
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await fh.read(buf, 0, CHUNK, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
    carry += decoder.decode(buf.subarray(0, bytesRead), { stream: true });
    const consumed = scan(carry, sink);
    carry = carry.slice(consumed);
    if (carry.length > 1 << 20) throw new Error("carry 異常膨脹，掃描邏輯有洞");
  }
  carry += decoder.decode();
  scan(carry, sink);
  await fh.close();

  const secs = (performance.now() - t0) / 1000;
  const mb = size / 1048576;
  console.log(JSON.stringify({
    size_mb: +mb.toFixed(1), seconds: +secs.toFixed(2), mb_per_s: +(mb / secs).toFixed(1),
    wanted_records: records, workouts, epoch_flags: epochFlags,
    fingerprint: hash.digest("hex").slice(0, 16),
    peak_rss_mb: Math.round(process.memoryUsage().rss / 1048576),
    type_counts: Object.fromEntries([...typeCounts.entries()].sort()),
  }, null, 1));
}

main(process.argv[2]);
