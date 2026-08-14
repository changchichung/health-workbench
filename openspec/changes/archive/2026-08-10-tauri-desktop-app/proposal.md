# Proposal: Tauri 桌面 App（產品化：選檔匯入＋即時檢視）

## Why

MVP 的「CLI 匯入＋單檔 HTML」已在日常使用中驗證了資料管線與檢視介面，
但操作前提是會用終端機。2026-08-09 定案將定位升級為產品化：目標使用者
不懂程式，也要能自己選檔匯入（健保存摺、Apple 健康）並直接看到分析，
Mac 與 Windows 雙平台。單檔 HTML 模式無法承載「選檔、進度、結果回報」
的操作流，需要 App 容器。

## What Changes

- 新增 Tauri 2 桌面 App：繁中介面、深淺色、資料庫存於系統 App 資料目錄。
- 匯入邏輯以 JS 重寫進 App（2026-08-09 討論定案，spike 已驗證：220MB
  合成檔 2.97 秒解析、與 Python oracle 差分指紋全等，證據
  `docs/spikes/20260809_tauri_js_parse/`）。零 sidecar、零 Rust 業務碼。
- 新增健保 XML 匯入（既有管線僅 JSON；XML 缺 r9-r14 為官方格式事實，
  共同節區與 JSON 等價入庫）。adapter 註冊制延伸到 JS 端，保留未來
  格式（如 Excel）擴充點。
- 檢視改為 App 內即時渲染：開 App 直接讀資料庫顯示最新資料；既有
  Preact 四分頁＋搜尋元件原樣遷入；單檔 HTML 匯出降為選用功能保留。
- Python CLI 降級為開發者路徑與驗收 oracle：所有 JS 匯入行為以差分
  對帳（同輸入、兩實作、逐表 diff 全等）驗收，等價協定寫入 spec。
- 雙平台建置走 GitHub Actions（tauri-action matrix），產物不簽章
  （2026-08-09 定案：個人測試階段本機 build 不觸發 Gatekeeper，
  分發他人時再補簽章）。
- 不含（維持 backlog）：多 profile 操作介面、自動更新、回診摘要匯出、
  手動補充資料、iPad/iOS target。

## Capabilities

### New Capabilities

- `app-shell` — Tauri 2 桌面殼：視窗與介面規範、資料庫定位與首啟遷移、
  knowledge 資源隨 bundle、雙平台建置與 CI 零個資紀律。
- `app-import-engine` — JS 匯入引擎：儲存存取抽象（App 用 SQL plugin、
  測試用 node:sqlite）、批次交易寫入、adapter 註冊制（內容判型）、
  NHI JSON／NHI XML／Apple Health 三個 adapter、與 Python oracle 的
  差分等價協定。
- `app-import-gui` — 匯入操作介面：選檔與拖放、串流進度、增量結果
  報告卡、重複檔與歸戶防護的使用者呈現、部分失敗續行呈現。
- `app-viewer` — App 內即時渲染：資料 provider 契約（與既有嵌入 JSON
  同構，前端元件零改動）、四分頁＋搜尋、單檔 HTML 匯出（選用）。

### Modified Capabilities

（無。既有六個 specs 的行為要求不變；`app-import-engine` 以等價協定
引用 `nhi-import`、`apple-health-import`、`incremental-merge`、
`health-database` 的全部 requirements，JS 實作必須同樣滿足。）

## Impact

- 新增 `app/`（Tauri 專案：src-tauri Rust 殼＋前端與 JS 匯入引擎）；
  `src/`（Python）保留為 oracle 與開發者 CLI，不再新增使用者功能。
- 相依：Rust toolchain（apply 階段安裝）、Tauri 2.x、
  tauri-plugin-sql（sqlite）、tauri-plugin-dialog/fs；前端沿用
  Preact + htm 免 build；測試 harness 用 Node 內建 node:sqlite
  與 node:test（不出貨，experimental 風險已列入 design Risks）。
- 資料：資料庫移至系統 App 資料目錄；repo、CI、bundle 一律不含真實
  個資；差分對帳的真實資料演練只在本機跑。
- 風險緩解已內建：WKWebView 與 SQL plugin IPC 吞吐於 tasks 第 0 組
  實測把關，不過門檻即啟動 design 預留的 Rust command 降級路徑。

## 審查修正（G1，2026-08-09）

Self-Review：S2 抓到三處並修正：(1) design D4 的 DataProvider 鍵清單
原為憑記憶書寫，與 embed.py 實況不符，已對照原始碼改為實際 12 鍵；
(2) 差分對帳「排除自增 id」會漏檢外鍵錯位，改為外鍵先解析為參照列
自然鍵再 diff（design Implementation Contract 與 app-import-engine
spec 同步修正）；(3) drug_items.sqlite 隨 bundle 的 resources 配置
原無 task 落點，補進 task 2.6。S6 當日實證：spike（220MB 解析、
DecompressionStream）、node:sqlite 10 萬筆批寫、tauri-plugin-sql
v2.4.0 與 tauri-action 官方文件，記於 design Context。

Sub-Agent Review（haiku＋sequential-thinking）：0 critical、
3 warnings，全數修正：(W1) 業務邏輯守衛 grep 模式明確化並定為
0.1/6.1 共用 SSOT，禁用詞以 src/knowledge/forbidden.py 為 SSOT；
(W2) task 3.2 真實資料演練範圍界定（data/raw/ 全部健保檔＋
~/Downloads/apple_health_export/，2026-08-09 實測存在）；(W3) D1 降級路徑
改為兩門檻各自獨立判定、各自下沉。
