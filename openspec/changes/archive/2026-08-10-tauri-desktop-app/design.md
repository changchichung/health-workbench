# Design: Tauri 桌面 App（產品化）

## Context

MVP（change `mvp-core-dashboard`，已 archive）交付了 Python 匯入管線
（1808 行、僅依賴 PyYAML）、SQLite schema v3、Preact 單檔 dashboard
（app.js 466 行）。2026-08-09 討論定案產品化方向與三個裁決：
D-A 匯入邏輯 JS 重寫（條件 spike 已過）、D-B App 內即時渲染、
D-C 雙平台先不簽章。common-ground 假設 #21-#33 已 ESTABLISHED。

當日依賴實證（G1-S6）：
- JS 串流解析 220MB 合成檔 2.97s、峰值 RSS 295MB、與 Python oracle
  指紋全等；zip 經 DecompressionStream('deflate-raw') 0.35s
  （`docs/spikes/20260809_tauri_js_parse/20260809_spike_findings.md`）。
- `node:sqlite` 本機實測（Node v25.5.0）：10 萬筆 prepared insert
  單交易可用；模組標 experimental。
- tauri-plugin-sql v2.4.0 存在且支援 sqlite（docs.rs 當日查證）；
  官方 tauri-action 支援 macOS/Windows matrix 建置（v2 官方文件）。

## Goals / Non-Goals

Goals：
- 不懂程式的使用者能：開 App、選檔（或拖放）匯入健保 JSON/XML 與
  Apple Health 匯出、看到匯入結果、直接檢視最新資料。
- JS 匯入行為與 Python 管線可證明等價（差分對帳全等）。
- Mac/Windows 雙平台可建置（CI），本機開發以 macOS 為主。

Non-Goals：
- 多 profile 操作介面、自動更新、回診摘要匯出、手動補充資料（backlog）。
- 簽章與公證（分發他人時另開 change）。
- iPad/iOS target。
- Python CLI 的新使用者功能（降級為 oracle 與開發者路徑）。

## Decisions

### D1: 匯入引擎＝JS 重寫進 App（2026-08-09 定案）

- **方案 1（採用）：匯入邏輯全 JS，跑在 WebView。** 選檔（dialog
  plugin）、讀檔（fs plugin 分塊）、SQLite（tauri-plugin-sql）都是
  官方插件；zip 用 Web 標準 DecompressionStream。零 sidecar、
  零 Rust 業務碼、bundle 最小、與前端同語言。spike 已證明吞吐與
  記憶體可行（見 Context）。
- **方案 2：PyInstaller sidecar。** 零重寫，但每次 release 雙平台
  各打一份 Python 執行檔，NSIS 重裝不更新 sidecar 的已知 issue、
  Windows 防毒誤判風險，打包複雜度永久化。
- **方案 3：Rust 重寫。** 單一執行檔最乾淨，但 repo 無 Rust 存量，
  1250 行含醫療資料正確性的邏輯重寫風險最高、工期最大。
- 個人測試階段（raw 檔保留、匯入冪等、可隨時重匯）＋差分對帳護欄
  （D3）使方案 1 的重寫風險可控。
- **降級路徑（escape hatch）**：tasks 第 0 組在真實 WebView 內復驗，
  兩項門檻各自獨立判定：解析 >30s → 下沉 XML 掃描段；批寫 10 萬筆
  >10s → 下沉批次寫入段；兩者皆超標則兩段皆下沉。每段為單一 Rust
  command，對外介面（adapter/StoreDriver）不變，其餘 JS 照舊。

### D2: 儲存存取抽象＝StoreDriver 介面、雙實作

- **方案 A（採用）：定義最小 StoreDriver 介面（execute/select/
  batchInsert/transaction），App 實作走 tauri-plugin-sql，測試與
  oracle harness 實作走 node:sqlite。** 匯入引擎與 adapter 只依賴
  介面，同一套業務碼在 Node 可測、在 App 可跑。批次策略：單交易＋
  **json_each 單參數展開**（每批 20000 列，整批序列化為一個 JSON
  字串參數，SQLite 端 `json_each` 展開 INSERT...SELECT）。
- **App 端 driver 修訂二（2026-08-09，task 4.x 實測）**：tauri-plugin-sql
  以 sqlx 預設 10 連線池服務，跨 invoke 的 BEGIN/COMMIT 可落在不同連線、
  頁面重載遺留孤兒交易造成幽靈讀（重複檔提示引用不存在的 imported_at
  實測抓到）。棄用該插件，改 app 自有 SQLite 橋（rusqlite，每 DB 路徑
  一條連線＋Mutex 序列化，shell 層 db_execute/db_select/db_close 三個
  command，無業務邏輯）。復驗：driver smoke 全等、10 萬筆批寫 1.96s、
  kill 回滾成立、幽靈讀消失。
- **批次策略修訂（2026-08-09，task 0.3 實測）**：原設計「每批 500
  多列 VALUES」實測 10 萬筆 18.2s 未過 10s 門檻，且劣化非 IPC 而是
  sqlx 千級參數綁定成本（values@1000 反而 105s）；json_each 實測
  **2.2s 過關（餘裕 4.5 倍）**，免 Rust 降級。兩 driver 統一用
  json_each SQL 形狀。數據見 docs/verification/g3_task0.md。
- **方案 B：業務碼直接呼叫 tauri-plugin-sql。** 少一層，但 Node 端
  無法跑同一套碼，差分對帳只能在 App 內手動做，喪失自動化驗收。
- **方案 C：測試層用 better-sqlite3。** node:sqlite 標 experimental，
  better-sqlite3 更穩，但引入 devDependency 與原生編譯。先用
  node:sqlite（僅 dev harness，不出貨），API 若變動再換
  better-sqlite3，StoreDriver 介面使替換成本為單檔。
- schema：JS 端 DDL 自 `src/store/schema.py` 移植，以「兩邊初始化
  空庫後正規化 schema dump 全等」為驗收，杜絕漂移。

### D3: 等價驗收＝差分對帳 harness（Python 為 oracle）

- **方案 1（採用）：同一輸入檔分別經 Python CLI 與 JS 引擎（Node
  harness）匯入兩個空庫，逐表（除自增 id 與 imported_at 時間戳外）
  排序 dump 後 diff，全等才 PASS。** fixture 全集（既有去識別化
  fixtures）進 CI；真實資料演練只在本機跑、結果不進 git。
- **方案 2：只比對筆數與抽樣欄位。** 便宜但漏欄位級差異（spike 已
  證明全量指紋對帳成本極低，沒有理由抽樣）。
- 數值契約：JS `parseFloat` 對畸形值比 Python `float()` 寬鬆，JS 端
  數值解析統一走嚴格函式（完整字串必須是合法數字，否則視為文字），
  以 Python 行為為準；差分測試含畸形值 fixture。
- NHI XML 無 Python oracle（Python 僅解析 JSON）：以「同批下載的
  JSON/XML 檔共同節區（r1-r8）交叉對帳」驗收；對齊鍵＝
  （section, record_fp），不得用列序（兩格式檔內排序不同，
  2026-08-09 真檔實測確認）。白名單僅 r8：官方 JSON 移除換行字元
  （非代換空白）故含換行報告跨格式指紋必不同，以弱鍵對齊後
  report_text 去空白全等（真檔 7/7 驗證）。XML 獨有行為以
  去識別化 fixture 單元測試覆蓋。

### D4: 檢視資料流＝provider 契約同構於嵌入 JSON

- **方案 1（採用）：定義 DataProvider 介面，回傳結構與現行
  `embed.py` 產出的嵌入 JSON 同構；App 實作以 SQL 查詢組裝，
  現行單檔模式視為「靜態 provider」。** app.js 元件零改動遷入，
  單檔 HTML 匯出＝把 provider 結果序列化進既有模板（與 Python
  `generate.py` 同構，選用功能）。
- **方案 2：前端改為逐視圖按需查詢。** 更省記憶體，但四分頁與搜尋
  元件全要改寫，違反「原樣遷入」的既定路徑；資料量級（醫療類全量
  ＋活動類聚合 <10MB）不需要。
- 聚合（活動類月聚合、每日單一來源最大步數）在 provider 的 SQL 層
  完成，規則沿用 `dashboard-generator` spec 既有 requirements。

### D5: 資料庫位置與資源打包

- **方案 A（採用）：資料庫固定於系統 App 資料目錄（Tauri
  `appDataDir()`：macOS `~/Library/Application Support/`、Windows
  `%APPDATA%` 下的 app 識別目錄）＋設定頁顯示實際路徑；首次啟動若
  資料庫不存在則建空庫，並提供「匯入既有資料庫檔」按鈕（檔案複製，
  服務既有 CLI 使用者一次性遷移）。** 開發模式可用環境變數覆寫路徑
  （沿用「路徑不可硬編碼」硬標準）。
- **方案 B：讓使用者自選資料庫位置。** 自由但支援成本高（iCloud
  同步目錄、權限問題），v1 不做，schema 與檔案格式不阻礙未來加。
- knowledge 資源：`drug_items.sqlite`（11MB）與 `labs.yaml` 建置期
  轉出的 `labs.json` 隨 bundle 為唯讀資源；藥品 join 用 ATTACH 唯讀
  連接；「每季 knowledge update」維持開發者流程，隨 App 版本更新
  發佈（v1 不做 App 內下載更新）。

### D6: 雙平台建置＝官方 tauri-action matrix、不簽章、CI 零個資

- **方案 1（採用）：GitHub Actions matrix（macos-latest、
  windows-latest）用官方 tauri-action 建置，artifacts 上傳 GitHub
  Release（private repo）。不配置任何簽章。** CI 僅用去識別化
  fixtures；差分對帳 CI job 跑 fixture 全集。
- **方案 2：本機只建 macOS、Windows 手動借機器建。** 不可重複、
  Windows 驗證斷鏈，放棄。
- Windows 端無實機可深度驗證屬已知風險（見 Risks），v1 驗收標準為
  CI 建置成功＋至少一次 Windows 實機冒煙（使用者或代測者）。

### D7: adapter 註冊制（JS 版）與格式擴充點

- 沿用 Python 側原則（每來源一 adapter、內容判型不看檔名）：
  `detect(header: Uint8Array, name: string) -> bool` 與
  `import(source, store, progress) -> stats`。註冊表驅動匯入 GUI 的
  「自動判型」與格式清單顯示。
- 新格式（如未來 Excel）＝新增一個 adapter 模組＋註冊一行，GUI 與
  引擎不改。此擴充點寫入 spec 為驗收條件（以假 adapter 注入測試）。
- NHI XML adapter 為本輪新增：解析 r1-r8（XML 官方格式無 r9-r14），
  欄位對照沿用 `nhi_fieldmap` 移植，r8 報告保留原始換行。

## Implementation Contract

- 目錄：`app/`（Tauri 專案根）：`app/src-tauri/`（Rust 殼與插件註冊，
  業務碼零）、`app/src/`（前端與匯入引擎 JS：`engine/`、`adapters/`、
  `store/`、`ui/`、`provider/`）、`app/tests/`（node:test＋差分 harness）。
- StoreDriver 介面：`execute(sql, params)`、`select(sql, params)`、
  `batchInsert(table, columns, rows, {ignore})`（json_each 單參數
  展開，內部分批 20000）、`transaction(fn)`。兩實作：
  `store/tauri_driver.js`、`store/node_driver.js`。
- DataProvider 契約：回傳物件頂層鍵與現行 `embed.py` build_payload
  一致（meta/encounters/meds_by_enc/medications/labs/reports/
  immunizations/nhi_body/knowledge/activity/measures/workouts，
  2026-08-09 對照原始碼確認），以 JSON Schema 檔
  （`app/src/provider/shape.json`）鎖定，前端與 HTML 匯出共用。
- 差分 harness 入口：`node --test app/tests/`；
  `app/tests/parity/run_parity.mjs <fixture|真實檔> <python_db> <js_db>`
  輸出逐表 diff 摘要，exit code 非零即 FAIL。dump 規則：排除
  imported_at 時間戳；自增主鍵不直接比對，外鍵欄位（如
  medications.encounter_id）先 join 解析為參照列的自然鍵
  （record_fp 等）再 diff，確保關聯正確性不因 id 排除而漏檢。
- 進度回報：adapter 每處理 N 筆（預設 5000）呼叫 progress(done,
  totalBytes, readBytes)，GUI 以讀取位元組數顯示百分比。
- 品質報告：JS 版增量報告結構沿用既有 Implementation Contract
  （source/sections/date_ranges/quality_flags/unmapped_lab_names/
  superseded_candidates/stale_knowledge/dedup），欄位齊全順序固定，
  差分對帳含報告 JSON（時間戳除外）。

## Risks / Trade-offs

- **WKWebView（JSC）與 IPC 吞吐未在真實 App 內實測**（spike 在
  Node/V8；Windows WebView2 同 V8 等價）→ tasks 第 0 組建 dev App
  重跑 220MB spike＋10 萬筆批寫實測，門檻：解析＋入庫合計 <60s、
  批寫 10 萬筆 <10s；不過即啟動 D1 降級路徑。
- **node:sqlite experimental**（僅 dev harness、不出貨）→ StoreDriver
  介面隔離，必要時單檔換 better-sqlite3。
- **Windows 無本機驗證環境** → CI 建置＋一次實機冒煙為 v1 驗收；
  NSIS 安裝器沿用 tauri 預設，不用 sidecar 故避開已知 NSIS sidecar
  issue。
- **app.js 對嵌入全域變數的隱藏耦合** → D4 以 shape.json 鎖契約，
  遷移 task 含四分頁＋搜尋逐項 dogfood 走查。
- **雙實作長期漂移（Python oracle 與 JS 引擎）** → 差分對帳進 CI；
  Python 側凍結新功能（僅修 bug），格式演進以 JS 為主、oracle 隨修。
- **大檔記憶體**：spike 峰值 295MB 可接受；adapter 實作維持分塊
  串流，禁止一次性 readFile 整檔（spec 驗收含 220MB 合成檔門檻）。

## Migration Plan

1. 既有使用者（CLI）：App 首啟用「匯入既有資料庫檔」複製
   `data/mhb.sqlite` 至 App 資料目錄；CLI 與 App 不共寫同一檔。
2. `src/`（Python）進入凍結：只修 bug 與 oracle 對齊，README 標註
   開發者路徑。
3. 單檔 HTML 使用者流程（iPad 檢視）不受影響：App 匯出功能產出
   同構單檔。

## Open Questions

（無阻塞項。簽章、自動更新、多 profile 於分發前另開 change。）
