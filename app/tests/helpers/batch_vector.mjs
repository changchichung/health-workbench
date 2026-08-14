// 批次分組的共用測試向量（change viewer-and-history-refinement D7）。
//
// 為什麼要共用向量：分組邏輯有兩份實作（App 的 history.js groupDocsByBatch
// 與檢視層 app.js 的 groupSources）。檢視層那份自包含嵌進單檔 HTML、不能
// import，而它的 groupSources 在 IIFE 內、沙箱外也取不到，所以無法「直接呼叫
// 兩份函式比對回傳值」。改為兩邊對同一組輸入各自斷言：
//   - App 端：tests/ui/history_batching.test.mjs 直呼純函式
//   - 檢視層：tests/ui/sleep_render.test.mjs 放進 payload 真渲染檢查 DOM
// 兩處欄位名相同（filename／adapter／imported_at／import_stats），因此同一份
// 向量可以直接餵給雙方。
//
// 向量刻意涵蓋四種情形：同批多檔、同 adapter 但不同批、單檔批次、缺統計。
//
// 形狀的硬約束（2026-08-14 修）：每一列的 import_stats MUST 只裝**該檔自己**
// 的筆數，因為分組就是把組內各列相加。這份向量原本把 STR 列寫成整批合計，
// 期望值又寫成「合計＋各檔」，等於把雙重計算固化成正確答案，兩份實作都照著
// 錯的答案通過。改動這裡時 MUST 保持「各列相加＝該批真實筆數」，否則守衛會
// 再次確認錯誤行為。
//
// 數值一律用合成的圓整數，NEVER 抄真實資料庫的量：這個 repo 是公開的，
// 而 CPAP 的使用天數與事件數合起來是可辨識的個人健康資訊。

const stats = (inserted, dup = {}) =>
  JSON.stringify({ inserted, skipped_dup: dup, collisions: 0 });

// 依 imported_at 遞增排列（呼叫端通常已排序；分組不依賴輸入順序，但組內
// 順序 MUST 維持傳入順序）
export const BATCH_DOCS = [
  // 批 A：同一批三個 CPAP 檔（合成值）。STR 只產生每日摘要與 unused 計數，
  // 事件分散在各 EVE 檔，相加才是該批的事件總數。
  { id: 1, filename: "STR.edf", adapter: "resmed_edf",
    imported_at: "2026-08-13 02:50:12",
    import_stats: stats({ cpap_daily: 120 }, { cpap_daily_unused: 50 }) },
  { id: 2, filename: "DATALOG/20230612_EVE.edf", adapter: "resmed_edf",
    imported_at: "2026-08-13 02:50:12", import_stats: stats({ cpap_events: 60 }) },
  { id: 3, filename: "DATALOG/20230613_EVE.edf", adapter: "resmed_edf",
    imported_at: "2026-08-13 02:50:12", import_stats: stats({ cpap_events: 20 }) },
  // 批 B：同一個 adapter 但不同匯入時刻 → 必須分成另一批
  { id: 4, filename: "STR.edf", adapter: "resmed_edf",
    imported_at: "2026-08-14 09:00:00", import_stats: stats({ cpap_daily: 3 }) },
  { id: 5, filename: "DATALOG/20230701_EVE.edf", adapter: "resmed_edf",
    imported_at: "2026-08-14 09:00:00", import_stats: stats({ cpap_events: 5 }) },
  // 批 C：單檔批次（不同 adapter）
  { id: 6, filename: "輸出.xml", adapter: "apple_health",
    imported_at: "2026-08-12 10:12:00",
    import_stats: stats({ apple_records: 400000 }, { apple_records: 30 }) },
  // 批 D：缺統計（早期匯入，import_stats 為 null）
  { id: 7, filename: "健康存摺醫療類_1.json", adapter: "nhi_json",
    imported_at: "2026-08-11 23:51:00", import_stats: null },
];

// 期望分組：key 為 `${adapter}|${imported_at}`，順序＝各批首次出現的順序
export const EXPECTED_BATCHES = [
  { key: "resmed_edf|2026-08-13 02:50:12",
    filenames: ["STR.edf", "DATALOG/20230612_EVE.edf", "DATALOG/20230613_EVE.edf"],
    inserted: { cpap_daily: 120, cpap_events: 80 }, dupTotal: 50, missingStats: false },
  { key: "resmed_edf|2026-08-14 09:00:00",
    filenames: ["STR.edf", "DATALOG/20230701_EVE.edf"],
    inserted: { cpap_daily: 3, cpap_events: 5 }, dupTotal: 0, missingStats: false },
  { key: "apple_health|2026-08-12 10:12:00",
    filenames: ["輸出.xml"],
    inserted: { apple_records: 400000 }, dupTotal: 30, missingStats: false },
  { key: "nhi_json|2026-08-11 23:51:00",
    filenames: ["健康存摺醫療類_1.json"],
    inserted: {}, dupTotal: 0, missingStats: true },
];

// 檢視層真渲染用：meta.sources 只需要這四個欄位
export const BATCH_SOURCES = BATCH_DOCS.map(
  ({ filename, adapter, imported_at, import_stats }) =>
    ({ filename, adapter, imported_at, import_stats }));
