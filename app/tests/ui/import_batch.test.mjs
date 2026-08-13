// 多檔匯入的 registry 擴充與 GUI 純函式（change cpap-sleep-therapy 第 4 組）。
import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../../src/adapters/registry.js";
import { registry } from "../../src/adapters/index.js";
import { sourceChipText, batchSummary } from "../../src/ui/import_flow.js";
import { collectDirEntries, resolveAppleDir } from "../../src/engine/tauri_source.js";

const singleAdapter = {
  id: "single", formatDesc: "單檔格式",
  detect: () => true,
  importSource: async () => ({ status: "ok" }),
};
const setAdapter = {
  id: "set", formatDesc: "多檔格式",
  detect: () => false,
  detectSet: async (entries) => entries.some(e => e.relPath === "MARK.edf"),
  importSourceSet: async () => ({ status: "ok" }),
};

test("register：匯入方法二選一即可，兩者皆無才拒絕", () => {
  const r = createRegistry();
  assert.doesNotThrow(() => r.register(singleAdapter), "只有 importSource");
  assert.doesNotThrow(() => r.register(setAdapter), "只有 importSourceSet");
  assert.throws(() => r.register({ id: "x", detect: () => true }),
    /importSource 與 importSourceSet 至少一個/);
  assert.throws(() => r.register({ id: "y", importSource: async () => {} }),
    /adapter 介面不完整/, "仍要求 detect");
});

test("detectSet：只問實作了集合介面的 adapter", async () => {
  const r = createRegistry();
  r.register(singleAdapter);
  r.register(setAdapter);
  assert.equal((await r.detectSet([{ relPath: "MARK.edf" }]))?.id, "set");
  assert.equal(await r.detectSet([{ relPath: "other.txt" }]), null,
    "沒有 adapter 認得就回 null，不得誤落到單檔 adapter");
});

test("預設註冊表：CPAP adapter 已註冊且不影響既有單檔判型", async () => {
  const ids = registry.list().map(a => a.id);
  assert.ok(ids.includes("resmed_edf"), "CPAP adapter 已註冊");
  assert.deepEqual(ids.slice(0, 3), ["nhi_json", "nhi_xml", "apple_health"],
    "既有三個 adapter 的順序不變（單檔判型優先序不受影響）");
  // CPAP adapter 的單檔 detect 恆為 false：半張 SD 卡匯入沒有意義，
  // 且不得攔截既有格式的單檔判型
  const apple = new TextEncoder().encode('<?xml version="1.0"?><HealthData>');
  assert.equal(registry.detect(apple, "export.xml")?.id, "apple_health");
  assert.equal(registry.formats().length, 4);
});

test("sourceChipText：單檔顯示檔名，多檔顯示資料夾與檔數", () => {
  assert.equal(
    sourceChipText({ source: { name: "export.xml", size: 184 * 1048576 } }),
    "export.xml｜184.0MB");
  assert.equal(
    sourceChipText({
      sourceSet: { rootName: "resmed" }, fileCount: 41,
      totalBytes: 3 * 1048576,
    }),
    "resmed｜41 個檔案，合計 3.0MB");
});

test("batchSummary：逐檔狀態統計", () => {
  const files = [
    { file: "STR.edf", status: "parsed", rows: 259 },
    { file: "a_EVE.edf", status: "parsed", rows: 12 },
    { file: "b_EVE.edf", status: "duplicate", rows: 0 },
    { file: "c_SAD.edf", status: "parse_error", rows: 0 },
    { file: "big.edf", status: "skipped_oversize", rows: 0 },
  ];
  assert.deepEqual(batchSummary(files), {
    total: 5, parsed: 2, duplicate: 1, parseError: 1, oversize: 1, rows: 271,
  });
  assert.deepEqual(batchSummary([]),
    { total: 0, parsed: 0, duplicate: 0, parseError: 0, oversize: 0, rows: 0 });
});

// 資料夾走訪（fs 注入版；App 端的 collectDirEntriesTauri 只是包一層）

function fakeFs(tree) {
  return {
    async readDir(dir) {
      const node = tree[dir];
      if (!node) throw new Error(`no such dir: ${dir}`);
      return node;
    },
    async open() { throw new Error("本測試不讀內容"); },
  };
}

test("資料夾走訪：兩層深度、relPath 用正斜線、目錄不入清單", async () => {
  const fs = fakeFs({
    "/card": [
      { name: "STR.edf", isDirectory: false },
      { name: "Identification.tgt", isDirectory: false },
      { name: "DATALOG", isDirectory: true },
      { name: "SETTINGS", isDirectory: true },
    ],
    "/card/DATALOG": [
      { name: "a_EVE.edf", isDirectory: false },
      { name: "深層", isDirectory: true },
    ],
    "/card/SETTINGS": [{ name: "AGL.tgt", isDirectory: false }],
    "/card/DATALOG/深層": [{ name: "too_deep.edf", isDirectory: false }],
  });
  const out = await collectDirEntries(fs, "/card");
  assert.deepEqual(out.map(e => e.relPath).sort(), [
    "DATALOG/a_EVE.edf", "Identification.tgt", "SETTINGS/AGL.tgt", "STR.edf",
  ], "第三層不列入（maxDepth 2）");
  assert.equal(out.find(e => e.relPath === "DATALOG/a_EVE.edf").path,
    "/card/DATALOG/a_EVE.edf");
});

test("資料夾走訪：達到上限即停止（選到大目錄不得卡住 UI）", async () => {
  const many = Array.from({ length: 100 },
    (_, i) => ({ name: `f${i}.bin`, isDirectory: false }));
  const fs = fakeFs({ "/big": many });
  const out = await collectDirEntries(fs, "/big", { maxEntries: 10 });
  assert.equal(out.length, 10);
});

test("資料夾走訪：讀不到的子目錄跳過而不中斷整體", async () => {
  const fs = fakeFs({
    "/card": [
      { name: "STR.edf", isDirectory: false },
      { name: "NOPERM", isDirectory: true },
    ],
    // "/card/NOPERM" 不存在於 tree → readDir 拋錯
  });
  const out = await collectDirEntries(fs, "/card");
  assert.deepEqual(out.map(e => e.relPath), ["STR.edf"]);
});

test("資料夾走訪：Windows 路徑分隔符", async () => {
  const fs = fakeFs({
    "C:\\card": [{ name: "STR.edf", isDirectory: false },
      { name: "DATALOG", isDirectory: true }],
    "C:\\card\\DATALOG": [{ name: "a_EVE.edf", isDirectory: false }],
  });
  const out = await collectDirEntries(fs, "C:\\card");
  assert.deepEqual(out.map(e => e.path).sort(),
    ["C:\\card\\DATALOG\\a_EVE.edf", "C:\\card\\STR.edf"]);
  assert.deepEqual(out.map(e => e.relPath).sort(),
    ["DATALOG/a_EVE.edf", "STR.edf"], "relPath 一律正斜線，與 adapter 的比對一致");
});

test("資料夾走訪：點開頭的檔案與目錄一律不列舉", async () => {
  const seen = [];
  const base = fakeFs({
    "/card": [
      { name: ".DS_Store", isDirectory: false },
      { name: "._STR.edf", isDirectory: false },
      { name: "STR.edf", isDirectory: false },
      { name: ".Spotlight-V100", isDirectory: true },
      { name: "DATALOG", isDirectory: true },
    ],
    "/card/DATALOG": [
      { name: ".DS_Store", isDirectory: false },
      { name: "a_EVE.edf", isDirectory: false },
    ],
    "/card/.Spotlight-V100": [{ name: "store.db", isDirectory: false }],
  });
  const fs = { ...base, async readDir(dir) { seen.push(dir); return base.readDir(dir); } };
  const out = await collectDirEntries(fs, "/card");
  assert.deepEqual(out.map(e => e.relPath).sort(), ["DATALOG/a_EVE.edf", "STR.edf"],
    "點檔案與 AppleDouble 檔不列入，任何深度都一樣");
  assert.ok(!seen.includes("/card/.Spotlight-V100"),
    "點目錄不下潛：Tauri fs scope 的 ** 不匹配 leading dot，stat 會被權限層拒絕，"
    + "且這類目錄的檔案數會白吃 maxEntries 額度");
});

// Apple 資料夾挑檔（fs 注入版；App 端的 resolveAppleDirTauri 只是包一層）

test("Apple 資料夾挑檔：AppleDouble 與點目錄一律不選", async () => {
  const fs = fakeFs({
    "/exp": [
      { name: "._輸出.xml", isDirectory: false },
      { name: "輸出.xml", isDirectory: false },
      { name: "export_cda.xml", isDirectory: false },
    ],
  });
  assert.equal(await resolveAppleDir(fs, "/exp"), "/exp/輸出.xml",
    "`._輸出.xml` 排序在真檔之前，選中它會在 stat 時被 fs scope 拒絕");
});

test("Apple 資料夾挑檔：下潛一層時跳過點目錄", async () => {
  const fs = fakeFs({
    "/outer": [
      { name: ".Spotlight-V100", isDirectory: true },
      { name: "zz_匯出", isDirectory: true },
    ],
    "/outer/.Spotlight-V100": [{ name: "any.xml", isDirectory: false }],
    "/outer/zz_匯出": [{ name: "輸出.xml", isDirectory: false }],
  });
  // 目錄名刻意不含 apple_health_export：那個關鍵字會讓目標目錄在優先序上
  // 永遠贏過點目錄，測試就永遠走不到點目錄那條路（等於沒測到）。
  assert.equal(await resolveAppleDir(fs, "/outer"),
    "/outer/zz_匯出/輸出.xml",
    "點目錄不下潛，否則會挑到 Spotlight 索引裡的 XML");
});
