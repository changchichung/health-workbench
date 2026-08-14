# app-import-engine — 匯入歸屬指定與等價邊界修訂

## MODIFIED Requirements

### Requirement: 與既有匯入 specs 的行為等價

JS 匯入引擎 MUST 滿足既有 `nhi-import`、`apple-health-import`、
`incremental-merge`、`health-database` specs（openspec/specs/）的
requirements，**唯一例外為 `nhi-import` 的「遮罩身分證歸戶」
requirement**：該條描述 Python CLI 的單人自動歸戶行為（維持凍結），
App 引擎改由本 spec 的「匯入歸屬指定」requirement 約束。其餘
requirements 的行為描述對本引擎具約束力，本 spec 不重抄。

#### Scenario: 差分對帳全等（fixture 全集）
- **WHEN** 將既有去識別化 fixture 全集分別經 Python CLI 與 JS 引擎
  （node:sqlite driver）匯入兩個空庫；JS 側先建立顯示名稱「本人」
  的成員並以其 id 為匯入歸屬（健保檔匯入時綁定 b1.1，終態與
  oracle 自動建檔結果一致）
- **THEN** 逐表排序 dump diff 全等（含 profiles 表；排除
  imported_at 時間戳；自增主鍵不直接比對，外鍵欄位先解析為參照列
  自然鍵再比，關聯正確性必須被覆蓋），增量品質報告 JSON（時間戳
  除外）全等，harness exit code 0

#### Scenario: 畸形數值契約
- **WHEN** fixture 含 value="12abc" 的紀錄
- **THEN** JS 引擎與 Python 一致視為文字值（value_text），
  MUST NOT 以 parseFloat 前綴寬鬆解析為 12

## ADDED Requirements

### Requirement: 匯入歸屬指定

adapter 匯入 MUST 接受明確的成員 id（opts.profileId，必填）並於
開頭驗證該成員存在，MUST NOT 自動歸入第一個成員或自動建立成員。
健保檔 MUST 對所選成員執行遮罩身分證護欄：成員未綁定身分證則於
匯入時綁定檔案 b1.1，但綁定前 MUST 檢查該身分證未綁定於其他成員
（已綁他人＝選錯成員，中止並提示該身分證所屬成員）；已綁定且
相符則通過；不符 MUST 中止且零寫入（訊息列出成員名稱與兩個
遮罩值）；檔案缺 b1.1 MUST 中止。
Apple 檔（無身分識別）直接歸入所選成員。重複檔案（全庫 SHA-256
命中）MUST 於訊息中附原歸屬成員名稱與原匯入時間後跳過。

#### Scenario: 身分證護欄阻擋
- **WHEN** 成員「爸爸」已綁定 A12345****，匯入檔 b1.1=B98765****
  且歸屬選「爸爸」
- **THEN** 中止並顯示成員名稱與兩個遮罩值，資料庫零寫入

#### Scenario: 首次綁定
- **WHEN** 成員「媽媽」尚未綁定身分證，歸屬選「媽媽」匯入
  b1.1=B98765**** 的健保檔
- **THEN** 匯入完成且「媽媽」綁定 B98765****，後續不符檔案被護欄
  阻擋

#### Scenario: 綁定衝突（選錯未綁定成員）
- **WHEN** 成員「本人」已綁定 A12345****，新成員「媽媽」未綁定，
  歸屬選「媽媽」匯入 b1.1=A12345**** 的健保檔
- **THEN** 中止並提示該身分證已屬成員「本人」，「媽媽」不被綁定，
  資料庫零寫入

#### Scenario: 缺 profileId 即錯
- **WHEN** 呼叫 adapter 未帶 opts.profileId（或 id 不存在）
- **THEN** 匯入立即失敗（明確錯誤），MUST NOT 回退至第一個成員

#### Scenario: 跨成員重複檔案
- **WHEN** 一份已歸屬成員「本人」的檔案再次匯入且歸屬選「媽媽」
- **THEN** 跳過並顯示「已於（時間）匯入至成員『本人』」，零寫入

### Requirement: 匯入不破壞既有資料

任何一次匯入（成功、冪等跳過、中止、中途失敗）對資料庫既有資料
的變更 MUST 侷限白名單：新增列（本次歸屬成員的資料列與
source_documents 列）、所選成員 masked_id 首次綁定、指紋碰撞時
既有列 quality_flags 追加 fingerprint_collision、本次新建
source_documents 列的 import_stats 收尾寫入。其他成員的既有列
MUST 逐位元組不變；中止或失敗 MUST 使全庫狀態與匯入前全等。
此不變量 MUST 以 before/after 全庫排序 dump diff 的對抗情境
測試矩陣持續驗證（進 CI）。

#### Scenario: 中途失敗全庫全等
- **WHEN** 匯入於任一節區中途拋出例外（含畸形／截斷檔案）
- **THEN** 全庫排序 dump 與匯入前全等（單交易回滾，無半寫狀態）

#### Scenario: 追加匯入不改舊列
- **WHEN** 對已有資料的成員匯入新一批下載檔（含與既有重疊的紀錄）
- **THEN** 既有列除白名單（碰撞 quality_flags 追加）外逐位元組
  不變，重疊紀錄冪等跳過、新紀錄純新增

#### Scenario: 同內容紀錄分屬兩成員不互擾
- **WHEN** 成員 A 已有某筆紀錄，成員 B 匯入內容完全相同的紀錄
- **THEN** 成員 B 正常新增（UNIQUE 鍵含 profile_id，不被跨成員
  去重），成員 A 的列逐位元組不變
