# G3 驗證：tasks 第 0 組（工具鏈與風險前置實測，2026-08-09）

## 0.1 工具鏈與 scaffold — PASS

- rustup 標準安裝：rustc 1.97.1、cargo 1.97.1；@tauri-apps/cli（npm）
- `app/` scaffold：src-tauri（僅插件註冊 sql/dialog/fs）＋ src/（免 build 前端，
  withGlobalTauri）；`npx tauri dev` 開出視窗（標題「健康資料工作台」，
  LSDisplayName 以 lsappinfo 驗證；shell 無螢幕錄製權限故無截圖，
  視窗於使用者桌面實際開啟）
- 首編一次失敗：`generate_context!` 需 icons/icon.png（bundle 關閉仍需），
  以 PIL 生成暫用 icon 後 `tauri icon` 補齊
- 業務邏輯守衛：`rg -n "parse|adapter|schema|fingerprint|knowledge|quality_flag"
  app/src-tauri/src/` 零命中

## 0.2 WKWebView 解析復驗 — PASS（門檻 <30s）

以檔案觸發式 dev spike（app/src/ui/spike.js，正式 GUI 落地後移除）在
真實 WKWebView 內執行，220MB／90.4 萬元素合成檔（fs plugin 4MB 分塊讀）：

| 環境 | 耗時 | 吞吐 | 命中筆數 |
|---|---|---|---|
| WKWebView（JSC）首跑 | **1.73s** | 127MB/s | 640,000（＝Node 版全等） |
| WKWebView 次跑 | 5.81s | 37.9MB/s | 640,000 |
| Node（V8）參照 | 2.97s | 74MB/s | 640,000 |

結論：JSC 未如預期慢 2-3 倍，且 fs plugin 分塊讀 IPC 吞吐無虞。
餘裕對門檻 ≥5 倍。

## 0.3 tauri-plugin-sql 批寫實測 — PASS（門檻 <10s；經策略修訂）

10 萬筆 apple_records、單一交易、真實 WKWebView：

| 策略 | 每批列數 | 耗時 | 判定 |
|---|---|---|---|
| 多列 VALUES（原設計） | 500 | 18.17s | ✗ 未過門檻 |
| 多列 VALUES | 1000 | 105.15s | ✗（參數綁定成本超線性） |
| 多列 VALUES | 100 | 34.75s | ✗ |
| **json_each 單參數展開** | 20000 | **2.21s** | ✓ |
| json_each | 100000（單呼叫） | 2.27s | ✓ |

根因：劣化來自 sqlx 千級參數的綁定/prepare 成本，非 IPC 本身。
決策：批次策略修訂為 json_each（design D2 已註記，兩 driver 統一
SQL 形狀），**D1 Rust 降級路徑毋需啟動**。

交易原子性 kill 演練：BEGIN＋10 萬筆寫入後不 COMMIT，`kill -9`
App，重開資料庫 `SELECT count(*)` ＝ **0**，整批回滾成立。

## 過程中修正的實作坑（記入工程記憶）

1. tauri-plugin-sql 的 `$N` 佔位每個 statement 獨立編號（批內列號，
   非全域列號），錯用會靜默補 NULL 直到撞 NOT NULL。
2. plugin 在 Rust 端快取連線池：刪除 DB 檔後舊池仍握著 → code 522
   disk I/O error；測試一律換新路徑。
3. withGlobalTauri 下 plugin 全域形狀不一：`__TAURI__.sql.Database.load`
   不存在時退 `default.load`／`load`（spike.js 相容層）。
4. dev spike 檔案觸發要先消費請求檔，否則 hot-reload 重入撞
   database is locked。

## 修訂二復驗（2026-08-09，task 4.x 期間）

GUI 情境測試抓到 tauri-plugin-sql（sqlx 預設 10 連線池）的幽靈讀：
重複檔提示引用不存在於任何已提交列的 imported_at，證實跨 invoke 的
BEGIN/COMMIT 可落在不同 pooled connection、頁面重載遺留孤兒交易。
棄用插件改 app 自有 SQLite 橋（rusqlite 單連線＋Mutex，
db_execute/db_select/db_close）。橋上復驗：

| 項目 | 結果 |
|---|---|
| driver 契約 smoke | 與 NodeDriver 全等（12 表、1000/0/1000/499500） |
| 10 萬筆單交易批寫 | **1.96s**（插件版 2.2s，更快且過門檻） |
| kill -9 回滾 | 筆數 0，原子性成立 |
| 幽靈讀 | 消失（重複檔提示時間戳與 DB 全等） |
