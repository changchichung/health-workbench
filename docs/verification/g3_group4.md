# G3 驗證：tasks 第 4 組（匯入 GUI，2026-08-09）

驗證方法：dev spike 無頭驅動（req.gui_import → 與拖放完全同一條
offerFile→runImport 路徑），回傳報告卡 DOM 快照＋外部 sqlite3 對帳。
全部情境於 SQLite 橋（D2 修訂二）之上復驗。

## 4.1 選檔/拖放＋判型確認流 — PASS

| 情境 | 結果 |
|---|---|
| 健保 JSON | 判型 nhi_json → 確認面板（格式名＋檔名＋大小）→ 匯入 |
| 改名/內容判型 | node:test 判型矩陣覆蓋（.txt 健保 JSON 仍識別） |
| 照片（jpg） | 「無法識別」＋支援格式清單（自註冊表產生，3 格式） |
| Apple zip | 正確解成員匯入（9 筆＋1 workout） |
| 資料夾 | resolveAppleDirTauri 解析非 cda XML（node 版單元測試同邏輯） |

原生拖放事件（tauri://drag-drop）已接線，與選檔按鈕走同一 offerFile；
實際拖放手感留 6.3 使用者日常演練確認。

## 4.2 進度與結果報告卡 — PASS

- 220MB 合成檔經 GUI 匯入：**56 個進度事件**（每資料塊一次，readBytes
  單調），完成出報告卡，64 萬筆掃描、639,932 寫入與引擎層全等；
  spec 進度門檻依實測校準（≥50）
- 報告卡欄位：節區筆數（含新增數與 XML 格式註記）、冪等跳過統計、
  品質旗標、未對照檢驗名、部分失敗明細（details 可展開）
- 匯入完成 → 狀態列筆數自動刷新
- 防重入：匯入中 offerFile 回 busy 拒收（邏輯層；importing 旗標）

## 4.3 防護情境 UX — PASS

| 情境 | 呈現 | 零寫入驗證 |
|---|---|---|
| 重複檔 | 「已於 {imported_at} 匯入過（SHA-256 相同）」，時間戳與 DB 全等（幽靈讀已除） | source_documents 筆數不變 |
| 歸戶不符 | 顯示雙方遮罩值＋中止說明 | 外部查 source_documents 無新列 |
| 部分失敗續行 | parse_errors 1 筆記錄、其餘節區正常入庫、明細可展開 | r1 records 4、正常 3 筆入庫（指紋去重） |

首匯 profile 確認走 dialog.ask 原生對話框；無頭驗證用
`__MHB_TEST_ASSUME_PROFILE__` 旗標（dev spike 專用，隨 spike.js 移除）。

## 6.1 CI 雙平台建置 — PASS（2026-08-10，補記於本檔）

- 本機 release build：MyHealthBank.app＋6.4MB dmg；bundle 含
  resources/drug_items.sqlite，個資掃描（*.sqlite 非藥品/含 private/
  含健保存摺檔名）零命中；業務邏輯守衛 grep 零命中
- GitHub Actions 首跑全綠：test job（node 55 測試＋parity fixture＋
  雙守衛）→ macos/windows matrix 建置；artifacts：
  myhealthbank-windows-latest 10.6MB、myhealthbank-macos-latest 12.9MB
- workflow 定義無個資目錄引用（自指守衛以字串拼接避開）

## 6.3 走查回饋修正（2026-08-10）

使用者實測回饋三項，全數修復並復驗：
1. Apple 匯入起手約 5 秒無說明（指紋雜湊階段無進度）→ 雜湊階段回報
   progress（processed=0 語意），GUI 顯示「正在檢查檔案（計算指紋）…%」；
   220MB 實測事件 56→112（雜湊＋解析兩段）
2. 檢視器 iframe 太小、上方留白過多 → 版面改 flex 滿版，檢視器吃主要
   高度，匯入面板限高 34vh 可捲動，標頭緊湊化
3. 首匯身分證原生對話框突兀 → 歸戶確認整合進判型確認面板（顯示遮罩
   身分證與動作說明，「開始匯入」即確認）；fresh db 無頭實測全程無
   對話框、profile 正確建立；歸戶不符預警也在面板顯示，引擎層防護不變

## 6.3 使用者日常演練 — PASS（2026-08-10）

正式 App（appDataDir）清空重測：健保 JSON、健保 XML、Apple 真檔匯入
全部正常，檢視分頁互動正常。四輪回饋全數修復（進度說明、滿版版面、
歸戶面板整合、匯入/檢視雙分頁、XML 來源標籤、資料庫與匯入紀錄卡、
文案白話化、視覺打磨沿用 dashboard token）。多人管理介面確認為
下一輪 change 主題。

## 6.2 Windows 冒煙 — 未執行，轉列 backlog

CI Windows 建置綠（NSIS/MSI artifact 10.6MB），實機冒煙需 Windows
機器，2026-08-10 使用者裁示先收尾；**分發他人前必做**，記入 handoff。
