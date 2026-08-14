// 公開倉庫的個資守衛（2026-08-14）。
//
// 為什麼需要這個：這個 repo 是公開的，而專案的驗證素材是真人的健康資料。
// 2026-08-12 曾人工做過一次「全面中性化改寫」，兩天後在 HEAD 又找到 30 個
// 檔案帶真實數值（就醫科別分佈、CPAP 使用天數與事件數、量測序列點數、
// 資料庫規模、體重離群值）。人工改寫不會收斂，必須有機器擋。
//
// 分工（2026-08-14 決定）：
//   - 開發過程紀錄（proposal／design／驗證紀錄／交接文件）**整批不入公開庫**
//     （見 .gitignore）。那些檔案的存在目的就是記錄實測，偵測型守衛擋得住
//     數字，卻擋不住「所有 session 都在 20:00 至 22:00 開始」這種敘述型的
//     健康資訊，所以用結構性隔離而非偵測。
//   - 留在公開庫的規格、CHANGELOG 與 README 天然不該出現實測數字，由這裡
//     以嚴格規則守住。
//
// 判準：同一行同時出現「三位數以上的數字（或 N 萬）」與「健康／資料量術語」
// 即視為可疑，除非命中白名單。要寫效能或容量要求時請寫量級（「百 MB 量級
// 檔案 MUST 於 60 秒內完成匯入」），不要寫某一份真實檔案的大小與筆數。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname;

// 掃描範圍：留在公開庫且不該有實測數字的文字檔
const SCAN = ["openspec/specs", "CHANGELOG.md", "README.md"];

const NUMBER = /(?:\d{1,3}(?:,\d{3})+|\d{3,}|\d+(?:\.\d+)?\s*萬)/;
const HEALTH_TERM = new RegExp([
  "晚", "夜", "天", "筆", "列", "事件", "摘要", "AHI", "血氧", "血壓", "體重",
  "就醫", "用藥", "藥品", "檢驗", "疫苗", "癌篩", "運動", "步數", "心率",
  "睡眠", "MB", "萬", "點",
].join("|"));

// 白名單：設計常數、格式常數、明確標示為合成素材的規模。
// 新增條目 MUST 附理由，且 MUST 是「與真實資料無關」的數字。
const ALLOW = [
  /門檻/,                        // 談門檻本身
  /1970/,                        // epoch 佔位日期
  /\b(365|366)\b/,               // 一年（區間與保留範圍的設計值）
  /\b(300|2000|8000|8,000)\b/,   // 舊上限與硬上限設計值
  /\b(237|238|400|119)\b/,       // 標記降級門檻（由繪圖區寬度推導）
  /\b5000\b/,                    // 進度回報間隔
  /\b(30|200)\s*kg\b/,           // 體重合理範圍的驗證邊界
  /220\s*MB|90\s*萬元素|90\s*萬/, // 去識別化合成檔的規模
  /10\s*MB/,                     // 單檔 HTML 上限
  /60\s*秒|60s/,                 // 匯入耗時契約
  /百\s*MB\s*量級|數十萬|數百|數千|逾千|十餘|數萬|大量/, // 已量級化的表述
  /\b\d{4}-\d{2}-\d{2}\b/,       // 日期
  /r\d+[._]\d+/,                 // 健保節區代碼
  /"20\d\d-\d\d"/,               // 年月字串（序列日期格式，不是資料量）
  /iPhone 記|Watch 記|步數統計為/, // 步數防雙計的構造示範（不是某日真實步數）
];

function walk(p) {
  const abs = join(ROOT, p);
  if (statSync(abs).isFile()) return [p];
  return readdirSync(abs).flatMap((e) => walk(join(p, e)));
}

const files = SCAN.flatMap(walk).filter((f) => f.endsWith(".md"));

test("公開倉庫的規格與說明文件不得出現實測的個人資料數值", () => {
  assert.ok(files.length >= 12, `只掃到 ${files.length} 個檔案，掃描範圍可能已失效`);
  const hits = [];
  for (const f of files) {
    const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!NUMBER.test(line) || !HEALTH_TERM.test(line)) return;
      if (ALLOW.some((re) => re.test(line))) return;
      hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 88)}`);
    });
  }
  assert.deepEqual(hits, [],
    "以上各行同時出現大數字與健康／資料量術語。若是真實資料的實測值，"
    + "請改寫為量級描述；若是設計常數或合成素材規模，請加進 ALLOW 並註明理由");
});

test("開發過程紀錄不得被追蹤進公開倉庫", async () => {
  const { execFileSync } = await import("node:child_process");
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
  const forbidden = tracked.filter((f) =>
    f.startsWith("openspec/changes/")
    || f.startsWith("docs/verification/")
    || f.startsWith("docs/spikes/")
    || /^docs\/.*handoff.*\.md$/.test(f)
    || f === "docs/20260808_phase0_findings.md");
  assert.deepEqual(forbidden, [],
    "這些路徑記錄的是對真人健康資料的實測，MUST NOT 進公開倉庫（見 .gitignore）");
});
