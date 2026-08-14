# Proposal: MVP 核心四件套單檔儀表板

## Why

健保存摺資料是三年滾動視窗且分散難讀，Apple 健康資料鎖在手機裡，兩者都無法
回答「我過去幾年就醫、用藥、檢驗、身體數值的全貌」。Phase 0 已實測證明：
格式可穩定解析（官方 spec 在手）、多來源可正規化入同一資料庫、冪等累加合併
可行。現在需要把原型（phase0/）升級為正式的資料管線與可日常使用的檢視介面，
讓每月一次的「下載 → 匯入 → 開檔檢視」成為固定習慣，資料縱深隨時間累積。

## What Changes

- 建立正式資料管線：健保存摺 JSON 匯入器與 Apple Health 匯入器
  （自 phase0 原型重構），每來源一個版本化 parser adapter。
- 建立正規化 SQLite schema：全表帶 profile_id（多人預留、單人先行）、
  來源追溯欄位、quality_flags；健保側設計自然鍵完成跨批次冪等合併
  （Apple 側 Phase 0 已驗證的機制正式化）。
- 新增單檔互動 dashboard 產生器：總覽 tiles、就醫時間軸、用藥清單、
  檢驗/身體數值趨勢、客戶端全文搜尋；資料嵌入分層（醫療類全量、
  活動類聚合），目標單檔 <10MB；繁體中文介面、深淺色、含醫療邊界聲明。
- 新增 knowledge 解讀對照表：檢驗項目與藥品的說明引用（國健署/食藥署/
  醫院公開資料），每則附來源 URL 與日期；醫囑代碼對接健保藥品代碼。
- CLI 統一入口（匯入、重建 dashboard、資料品質報告）。
- 不含（v2 起）：手動補充 manual.json、回診摘要匯出、Tauri 桌面 App、
  多 profile 操作介面、XML parser、doc-cleaner 整合。

## Capabilities

### New Capabilities

- `nhi-import` — 健保存摺醫療類 JSON 解析：14 節區、欄位對照、
  藥局調劑日期回退、品質報告、遮罩身分證歸戶。
- `apple-health-import` — Apple 匯出串流解析：健康與活動型別擷取、
  來源別單位正規化（如體脂率小數修正）、epoch 佔位日期標記。
- `incremental-merge` — 跨批次累加合併：兩側自然鍵、冪等匯入、
  視窗接續語意（健保 3 年滾動 vs Apple 全量）、重複計數防護（步數多來源）。
- `health-database` — 正規化 schema：profile_id 全表預留、來源追溯、
  quality_flags、檢驗名稱正規化欄位（test_name_normalized）。
- `dashboard-generator` — 單檔互動 dashboard：四件套視圖＋全文搜尋、
  嵌入分層策略、HTML 跳脫、體積上限、無障礙與雙色系。
- `knowledge-annotations` — 解讀對照表：檢驗/藥品說明、引用來源與日期、
  非結論式用語約束（規劃書 §10 用語規範落實為驗收條件）。

### Modified Capabilities

（無既有 specs，全部為新建。）

## Impact

- 新增 `src/`（正式模組）與 `cli` 入口；`phase0/` 保留為參照原型不再演進。
- 相依：Python 3.13 標準庫（sqlite3/xml/json）；前端 Preact + htm
  內嵌免 build（design.md 決策 D3，2026-08-08 定案）。
- 資料：`data/raw/`（原始下載）與 `data/mhb.sqlite` 均在 .gitignore；
  測試 fixture 一律去識別化後才入庫。
- 風險緩解已內建：HTML 跳脫（Phase 0 已知缺口）、個資不進 git、
  dashboard 含「僅供資料整理」聲明。

## 審查修正（G1，2026-08-08）

Self-Review：S2 抓到 design D5 與 health-database spec 對 unmapped 檢驗的處理矛盾
（會使未匹配項自趨勢圖消失），修正為「unmapped 以原名獨立成組」。
S6 依賴實證：Preact+htm 免 build 內嵌當日實測渲染成功（13KB）；
健保用藥品項資料集確認存在（data.gov.tw/dataset/23715，CSV 每月更新）。

Sub-Agent Review 第一輪 3 Critical / 4 Warning / 3 Info，修正：
- C1 品質報告結構 → Implementation Contract 定義固定 JSON 結構＋新增 task 1.5 產生模組。
- C2 `mhb quality` 職責未定義 → design D6 補齊（唯讀彙整、不重新解析）。
- C3 task 5.2 資料依賴不清 → 改為 SQL 匯出去識別化檢驗名 fixture 先行。
- W1-W4 → 6.3 逐項斷言驗收、響應式與搜尋 <500ms 入 contract、指紋碰撞防禦入 Risks。
- I2 → 7.4 明確清理 phase0 產物。I1（Open Questions 保留已結案 D3）為有意保留，未採納。

複審（第二輪）：Critical 歸零判 PASS。新增 2 Warning 與 1 Info 均已修正：
validate_palette.js 工具來源與固定版本方式入 task 6.3；fingerprint_collision
偵測驗證入 task 4.1；task 5.2 補前置依賴註記。殘留已知風險（複審 W3）：
四件套整體互動複雜度對 Preact 的假設待 apply 實作時驗證，已有 <500ms
效能指標與 browse 斷言把關。
