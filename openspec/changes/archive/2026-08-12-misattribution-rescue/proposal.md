# Proposal: 誤歸屬救援（刪除單筆匯入、改歸屬）

## Why

v0.4.0 QA 稽核列為唯一可能造成永久資料遺失的情境（Karen L-4）：
檔案匯錯成員後，因 sha256 全庫 UNIQUE（schema.js:22），同檔重匯
直接被檔層去重擋下（engine/store.js registerSource 命中即回傳原
doc）；現況唯一救援手段是「刪除整個成員重建」，若該成員名下已有
其他正確資料即不可行；若原始檔已刪，資料等於永久卡死在錯的成員
名下。

2026-08-10 common-ground 對齊（假設 #43-#52），三項決定：

1. 範圍＝刪除＋改歸屬：原始檔還在，刪錯的重匯即可；原始檔已刪，
   改歸屬直接搬資料（唯一能救回「已刪原始檔」情境的路徑）。
2. 健保錯誤綁定解綁納入本輪：健保檔誤匯到未綁身分證的成員會綁上
   錯的 masked_id（nhi_json.js:94-111 首匯即綁），不解綁則救援後
   正主的健保檔仍被護欄阻擋。
3. 確認 UX＝明細預覽＋一般二次確認（列各表影響筆數與警告）；
   名稱輸入級確認保留給刪成員。

程式碼對帳確認的兩個設計前提（詳 design D2/D3）：

- 去重紀錄掛在首見 doc 上（insertFpRecord duplicate 不更新
  doc_id），健保 3 年滾動視窗與 Apple 累積全量匯出大量重疊，
  刪除或搬走一筆匯入都可能使來源成員失去其他檔案也含有的紀錄，
  且該些檔案因檔層 sha256 已登記無法重匯回補：刪除與改歸屬的
  預覽 MUST 帶重疊警告。
- medications 只在母 encounter 新插入時寫入（nhi_json.js），
  子表與母表必同 doc：按 doc_id 刪除／搬移 FK 安全。

## What Changes

- 引擎新增 doc 級救援原語（`app/src/engine/doc_rescue.js`）：
  - 預覽：單筆 source_document 的各表關聯筆數、重疊風險警告、
    改歸屬時與目標成員的重複合併筆數、健保綁定守恆判定結果。
  - 刪除單筆匯入：單一交易刪除該 doc 全部關聯列（先 medications
    後各表）與 source_documents 列；sha256 隨之釋放可重匯。
  - 改歸屬：單一交易將該 doc 與其全部關聯列改掛目標成員；與目標
    既有紀錄重複者採合併語意（沿用匯入去重規則，刪來源列保留
    目標列）。
  - 健保身分綁定守恆：健保 doc 改歸屬僅允許目標成員未綁定身分證；
    來源成員失去最後一份健保 doc 時自動解綁，改歸屬同時轉綁目標。
    刪除後來源成員無任何健保 doc 亦自動解綁。
- 匯入紀錄卡（history.js）：每筆來源檔案列新增「刪除」「改歸屬」
  操作，開啟明細預覽確認面板；完成後刷新匯入紀錄與檢視頁（若
  影響當前成員），失敗以既有通知列上浮。
- 測試：doc_rescue 單元測試（交易回滾、sha256 釋放、合併語意、
  綁定守恆、他成員資料逐位元組不變）；D7 非破壞性紅隊 harness
  擴充刪除／改歸屬中途失敗情境。
- 匯出資料庫檔（2026-08-11 走查時使用者提出，與既有「匯入既有
  資料庫檔」同區）：管理成員面板進階區「匯出資料庫檔…」，
  VACUUM INTO 一致性快照到使用者指定位置，預設檔名含日期，
  目標已存在拒絕零寫入。
- 不含（維持 backlog 或明確排除）：DDL 變更（全部 DML）、精確
  doc↔紀錄多重歸屬追蹤（需新表，見 design D2）、Python CLI 的
  救援操作（維持凍結）、批次多 doc 救援、匯入紀錄卡以外的救援
  入口。

## Capabilities

### Modified Capabilities

- `profile-management` — 新增三個 requirements：匯入紀錄刪除
  （單筆 doc 連帶資料、預覽與重疊警告）、匯入紀錄改歸屬（合併
  語意、預覽）、健保身分綁定守恆（改歸屬護欄與自動解綁）。
- `app-viewer` — 「成員切換與依人檢視」requirement 修訂：匯入
  紀錄卡自資料庫管理視角升級為可操作（每筆來源檔案列提供刪除
  與改歸屬入口），其餘語意不變。
- `app-shell` — 「資料庫定位與首次啟動」requirement 修訂：新增
  「匯出資料庫檔」入口（VACUUM INTO 一致性快照、預設檔名含
  日期、同名拒絕）。

（`health-database`、`app-import-engine`、`app-import-gui`、
`nhi-import`、`apple-health-import`、`incremental-merge`、
`dashboard-generator`、`app-shell` 不動：零 DDL、匯入流程零
變更，救援為既有資料的事後操作。）

## Impact

- 程式碼：`app/src/engine/doc_rescue.js`（新增）、
  `app/src/engine/profiles.js`（複用其交易模式，不改既有函式）、
  `app/src/ui/history.js`（操作鈕＋預覽確認面板）、
  `app/src/ui/main.js`（救援後刷新掛鉤）、`app/tests/engine/`
  （新增 doc_rescue 測試、擴充 nondestructive 紅隊矩陣）。
- 資料：**零 DDL 變更**；既有資料庫零遷移。
- 相依：無新外部依賴。
- 驗收護欄：既有 100 node:test 維持全綠（2026-08-10 當日實測
  基準）；所有救援操作 before/after 全庫 dump diff 斷言「僅白
  名單差異」（D7 模式）；Python CLI 與 parity 基準不動。

## 審查修正（G1/G2，2026-08-10）

Self-Review：S1/S3/S5/S6 一次通過；S2/S4 抓到兩處並修正：
(1) 去重共用紀錄風險原只寫刪除路徑，改歸屬把 doc 搬走同樣使
來源成員失去其他檔案也含有的紀錄，design D2／proposal／
profile-management 改歸屬 requirement 統一為兩路徑皆出重疊
警告；(2) 綁定守恆 spec 文字歧義（「救援操作後已無健保檔即
解綁」未限定操作對象、轉綁條件冗詞），改為「健保來源檔案的
救援操作」觸發、轉綁僅隨來源解綁發生、非健保檔操作 MUST NOT
影響綁定，與 design D4／tasks 0.2 對齊。S6 當日實證：零新外部
依賴；引用的程式碼行為全部當日實讀（sha256 UNIQUE、去重掛首見
doc、medications 同 doc、encounter 指紋含用藥子陣列、兩 adapter
的 import_stats 均記 skipped_dup、masked_id 首匯綁定）；測試
基準 100 node:test 當日重跑全綠。

Sub-Agent Review（haiku＋sequential-thinking）：0 critical、
2 warnings，均修正：(W1) encounters 合併措詞指稱不明，design
D3／tasks 0.3 改為明確的「刪來源 encounter 及其 medications、
目標 encounter 與其用藥完整保留」；(W2) merge 回傳結構未定義，
tasks 0.1 定為 `{ perTable, total }`、0.3 回傳 `{ moved, merged,
binding }` 並逐表對帳、1.1 文案 M＝merge.total。

G2 Coverage：D1→0.1-0.3、D2→0.1+1.1、D3→0.3+0.1、D4→0.1-0.3、
D5→1.1-1.2、D6→0.1-0.4+1.1+2.1，零 gap；Risks 四項各有
mitigation task（design Risks 表）；Type Check 修正 nhiGuard
回傳形狀未定義（統一為 `{ blocked, reason, willUnbindSource,
willBindTarget }`）。
