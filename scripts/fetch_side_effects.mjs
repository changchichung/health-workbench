// scripts/fetch_side_effects.mjs — 從 KingNet 國家網路醫藥·網路藥典擷取藥品
// 適應症/副作用/警語/禁忌，輸出 app/src/knowledge/side_effects.json。
//
// 背景：健保用藥品項檔的「藥品代碼超連結」指向食藥署舊版許可證查詢系統
// （已失效，HTTP 404）；食藥署仿單查詢平台每個查詢都需要驗證碼（抗 OCR），
// 無法全自動。KingNet 藥典定期與 TFDA 藥品資料庫同步（頁尾聲明），
// 頁面無驗證碼，可程式化抓取。
//
// 用法：
//   node scripts/fetch_side_effects.mjs                        # 抓 demo 用藥的 5 個成分
//   node scripts/fetch_side_effects.mjs 成分1 成分2             # 指定成分（以空格分隔）
//   node scripts/fetch_side_effects.mjs --top 200              # 品項檔熱門單方前 200 個
//   node scripts/fetch_side_effects.mjs --top 200 --delay 300  # 自訂請求間隔（ms，預設 400）
//
// 輸出：app/src/knowledge/side_effects.json（與既有內容合併，不覆寫既有成分）；
// 同時印出禁用詞命中清單，命中時需人工調整措辭後再提交（forbidden_guard 測試會擋）。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "node:sqlite";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "app/src/knowledge/side_effects.json");
const DRUG_CACHE = path.join(REPO, "app/src-tauri/resources/drug_items.sqlite");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const TODAY = new Date().toISOString().slice(0, 10);

// demo 用藥的 5 個成分（scripts/gen_demo_data.mjs 固定取樣）
const DEFAULT_INGREDIENTS = [
  "AMLODIPINE", "ATORVASTATIN", "ACETAMINOPHEN", "METFORMIN", "FAMOTIDINE",
];

// 品項檔成分名（含劑量）→ 查詢用的純成分名
function searchKey(raw) {
  return raw.split("(")[0].trim().split(/\s+/)[0].toUpperCase();
}

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

// 搜尋成分 → 回傳第一個成分頁 recno；查無回 null
async function findRecno(keyword) {
  const html = await getJson(
    `https://www.kingnet.com.tw/medicine/list?selectType=generic&keyword=${encodeURIComponent(keyword)}`);
  const m = html.match(/medicine\/generic\?recno=(\d+)/);
  return m ? m[1] : null;
}

const strip = (s) => (s || "")
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

// 解析成分頁區塊（id 系統：generic-cureitem-text 適應症、-aftereffect- 副作用、
// -careitem- 警語、-nono- 禁忌）
function parsePage(html) {
  const get = (id) => {
    const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)<\\/div>`));
    return m ? strip(m[1]) : "";
  };
  return {
    indication: get("generic-cureitem-text"),
    side_effects: get("generic-aftereffect-text"),
    warnings: get("generic-careitem-text"),
    contraindications: get("generic-nono-text"),
  };
}

async function fetchIngredient(keyword) {
  const recno = await findRecno(keyword);
  if (!recno) {
    console.log(`  查無 ${keyword}`);
    return null;
  }
  const url = `https://www.kingnet.com.tw/medicine/generic?recno=${recno}`;
  const html = await getJson(url);
  const parsed = parsePage(html);
  return {
    ingredient: keyword,
    ...parsed,
    source_name: "KingNet 國家網路醫藥·網路藥典（定期與 TFDA 藥品資料庫同步）",
    source_url: url,
    cited_date: TODAY,
  };
}

// 禁用詞檢查（與 src/knowledge/forbidden.py 同源）
const forbidden = readFileSync(path.join(REPO, "src/knowledge/forbidden.py"), "utf-8");
const block = forbidden.match(/FORBIDDEN_WORDS = \[([\s\S]*?)\]/)[1];
const FORBIDDEN = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

function checkForbidden(entry) {
  const hits = [];
  for (const w of FORBIDDEN) {
    for (const [field, val] of Object.entries(entry)) {
      if (typeof val === "string" && val.includes(w)) hits.push(`${field}:${w}`);
    }
  }
  return hits;
}

const args = process.argv.slice(2);
let topN = 0, delay = 400;
const explicit = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--top") topN = parseInt(args[++i], 10);
  else if (args[i] === "--delay") delay = parseInt(args[++i], 10);
  else explicit.push(args[i]);
}

// 品項檔熱門單方（searchKey 去重，依品項數排序取前 topN）
function topIngredients(n) {
  const db = new sqlite3.DatabaseSync(DRUG_CACHE, { readOnly: true });
  const rows = db.prepare(
    "SELECT ingredient, COUNT(*) n FROM drug_items GROUP BY ingredient").all();
  db.close();
  const counts = {};
  for (const { ingredient, n } of rows) {
    const k = searchKey(ingredient);
    if (k && !ingredient.includes("+")) counts[k] = (counts[k] || 0) + n;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
    .slice(0, n).map(([k]) => k);
}

const keywords = topN > 0 ? topIngredients(topN)
  : (explicit.length ? explicit.map(searchKey) : DEFAULT_INGREDIENTS.map(searchKey));

// 合併既有輸出（保留已抓成分，避免重抓）
const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf-8")) : [];
const seen = new Set(existing.map((e) => e.ingredient));
const merged = new Map(existing.map((e) => [e.ingredient, e]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = [];
for (const kw of keywords) {
  if (seen.has(kw)) { process.stdout.write(`略過 ${kw}（已存在）\n`); continue; }
  process.stdout.write(`抓取 ${kw} ...\n`);
  try {
    const entry = await fetchIngredient(kw);
    if (!entry) continue;
    const hits = checkForbidden(entry);
    merged.set(kw, { ...entry, _forbidden: hits });
    out.push({ ...entry, _forbidden: hits });
    process.stdout.write(`  適應症 ${(entry.indication || "無").slice(0, 30)}｜副作用 ${(entry.side_effects || "無").slice(0, 30)}\n`);
    if (hits.length) process.stdout.write(`  ⚠ 禁用詞命中: ${hits.join(", ")}\n`);
  } catch (e) {
    process.stdout.write(`  ✗ ${e.message}\n`);
  }
  if (delay > 0) await sleep(delay);
}

// 去掉內部標記後寫入（合併既有與新增）
const clean = [...merged.values()].map(({ _forbidden, ...rest }) => rest)
  .sort((a, b) => a.ingredient.localeCompare(b.ingredient));
writeFileSync(OUT, JSON.stringify(clean, null, 2) + "\n");
console.log(`\n寫入 ${OUT}（共 ${clean.length} 筆，本次新增 ${out.length}）`);
const allHits = out.flatMap((e) => e._forbidden.map((h) => `${e.ingredient}:${h}`));
if (allHits.length) {
  console.log(`⚠ 禁用詞命中 ${allHits.length} 處，需人工調整措辭：\n  ${allHits.join("\n  ")}`);
} else {
  console.log("✓ 本次新增無禁用詞命中");
}