# Proposal: 多人資料管理（成員切換、匯入歸屬、依人檢視）

## Why

v0.3.0 的 schema 從 MVP 起就全表帶 profile_id、去重鍵含 profile_id，
但操作層寫死單人假設：匯入一律歸入第一個 profile（getFirstProfile／
`LIMIT 1`）、檢視 provider 全表查詢無 profile 過濾、匯入紀錄卡不分人。
使用者於 6.3 走查明確提出多人需求（家人資料共用同一 App），並於
2026-08-10 common-ground 完成四項裁示（假設 #34-#41）：

1. 檢視＝全域成員切換器，一次看一人；跨人比較不在本輪。
2. 匯入歸戶＝每次手動選成員（健保與 Apple 一致）；健保檔遮罩身分證
   降為驗證護欄（所選成員已綁定的身分證與檔案不符即阻擋），不做
   自動歸戶。
3. 成員管理＝新增＋改名＋刪除（刪除連帶該成員全部資料，二次確認）。
4. HTML 匯出＝僅當前檢視中的成員，單檔單人。

## What Changes

- 引擎歸戶介面改造：adapter 匯入一律要求明確的 profileId，移除
  「自動歸入第一個 profile／自動建檔」捷徑；健保遮罩身分證護欄
  改為對「所選成員」驗證（未綁定→綁定、相符→通過、不符→阻擋
  零寫入）；重複檔案訊息附原歸屬成員。
- 檢視依人過濾：DataProvider 增加成員參數，所有查詢以 profile_id
  過濾；payload 結構（shape.json）不變，前端四分頁元件零改動。
- 全域成員切換器：切換即刷新檢視頁與總覽狀態列；當前成員跨啟動
  記憶（App 資料目錄 settings.json）。
- 成員管理介面：清單、新增、改名（非空且不重名）、刪除（顯示
  該成員各類筆數、輸入成員名稱確認，單一交易逐表清除）。
- 匯入 GUI：判型確認面板整合成員選擇器（必選、無預設、可就地
  新增成員）；健保檔即時顯示身分證比對三態提示。
- 匯入紀錄卡維持全庫視角、依成員分組列出全部來源檔案（沿用
  history.js 既有掛載點，不隨切換器過濾）。
- 單檔 HTML 匯出＝當前成員資料，檔名含成員名稱。
- 不含（維持 backlog 或明確排除）：跨人比較檢視、全家合併匯出、
  profiles 表新欄位（顏色／頭像等，本輪零 DDL 變更）、Python CLI
  的多人操作（維持凍結，僅作單人 oracle）。

## Capabilities

### New Capabilities

- `profile-management` — 成員清單／新增／改名／刪除（連帶資料、
  二次確認、交易原子）、當前成員狀態記憶與失效回退。

### Modified Capabilities

- `health-database` — 「多人預留 schema」升級為正式多人隔離：兩人
  資料以 profile_id 完全隔離、成員刪除交易內清除全部關聯列。
- `app-import-engine` — 等價協定邊界修訂（nhi-import「遮罩身分證
  歸戶」requirement 在 App 引擎由「匯入歸屬指定」取代，其餘不變）；
  新增匯入歸屬指定 requirement。
- `app-import-gui` — 新增匯入歸屬選擇 requirement；防護情境呈現
  修訂（歸戶不符改「所選成員」語意、重複檔附歸屬成員）。
- `app-viewer` — 新增成員切換與依人檢視 requirement；DataProvider
  契約與 HTML 匯出修訂為成員範圍。

（`nhi-import`、`apple-health-import`、`incremental-merge`、
`dashboard-generator`、`app-shell` 不動：Python CLI 凍結維持單人
oracle 行為，等價邊界由 app-import-engine 的修訂承接。）

## Impact

- 程式碼：`app/src/engine/`（新增 profiles 模組、store 歸戶介面）、
  `app/src/adapters/`（nhi_json、apple_health 歸戶語意）、
  `app/src/provider/payload.js`（全查詢過濾）、`app/src/ui/`
  （main／import_flow／viewer／history、新增成員管理元件）、
  `app/tests/`（單元＋parity 調整＋多人隔離測試）。
- 資料：**零 DDL 變更**（profiles 表現有欄位足用），Python
  `src/store/schema.py` 不動，schema parity 測試維持既有基準；
  既有單人資料庫零遷移，既有 profile 直接顯示為成員。
- 相依：無新外部依賴（settings.json 沿用既有 fs plugin 讀寫）。
- 驗收護欄：parity fixture 全集維持全等（harness 配合歸戶介面
  前置建立成員）；新增多人隔離 marker 掃描測試防過濾漏網；
  新增匯入非破壞性紅隊測試矩陣（design D7，2026-08-10 使用者
  指示：before/after 全庫 dump diff＋白名單斷言，涵蓋中途失敗、
  跨成員、畸形檔等邊緣情境，進 CI 常駐）。

## 審查修正（G1，2026-08-10）

Self-Review：S1/S3/S5 一次通過；S2/S4 抓到兩處並修正：(1) 匯入
紀錄卡語意矛盾（app-viewer delta 同時寫「僅當前成員」與「依成員
分組」），裁定視角劃分＝檢視頁與狀態列跟當前成員、匯入紀錄卡為
全庫管理視角依成員分組不隨切換過濾，design D3／proposal／tasks
1.3、2.2 同步修正；(2) GUI 歸戶不符 scenario 原寫「繞過面板停用」
不可構造，改為真實路徑（b1.1 預讀不可得時面板無法預判，引擎護欄
第二層把關），design D1 補 peek 降級註記。S6 當日實證：本輪零新
外部依賴（settings.json 沿用既有 fs plugin 生產路徑）、單人捷徑
清單為當日程式碼實讀、測試基準 58 node:test 當日重跑全綠。

Sub-Agent Review（haiku＋sequential-thinking，兩輪）：第一輪
1 critical、2 warnings，全數修正：(C1) registerSource 責任邊界
明確化（回傳擴充 { docId, importedAt, originProfileId,
originDisplayName }，sha256 命中 JOIN profiles 一次取得，adapter
不另發查詢，既有呼叫端向後相容）；(W1) provider 過濾邊界明文
（sources 僅當前成員、counts 各表過濾唯 profiles 維持全庫，
新增對應斷言）；(W2) settings 驗證層級單一化（loadSettings 純
解析，resolveCurrentProfile(settings, profiles) 為唯一 id 驗證
點）。第二輪複審（fresh context）逐項驗證修正落地：
0 critical、0 warning，PASS。
