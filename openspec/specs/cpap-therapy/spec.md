# cpap-therapy Specification

## Purpose

CPAP（陽壓呼吸器）記錄卡的匯入與檢視：入庫粒度（每日摘要、逐次呼吸
事件、睡眠期血氧逐分鐘聚合）、紀錄夜的日期歸屬、缺測值判定、呼吸事件
分類、多裝置共存，以及只顯示不解讀的呈現約束。分階段實作，Phase 1 為
ResMed 原生 EDF；schema 以跨廠牌共通的臨床量設計，避免後續階段被迫遷移
（change cpap-sleep-therapy，2026-08-13）。

## Requirements

### Requirement: CPAP 資料來源與入庫粒度

MUST 支援匯入 CPAP（陽壓呼吸器）記錄卡的整個資料夾，入庫粒度為
**每日摘要、逐次呼吸事件、睡眠期血氧逐分鐘聚合**三種。

高解析波形與逐分鐘的壓力／流量訊號 MUST NOT 入庫：單晚曲線的價值低於
資料量與介面成本。血氧 MUST 以每分鐘一列的聚合入庫（每分鐘的最低與平均
血氧、平均與最高脈搏，以及該分鐘的有效樣本數），MUST NOT 存逐秒原始值；
逐秒在有資料的來源上會達到與既有全庫相同的量級。

欄位 MUST 以不同廠牌機器共通的臨床量設計，MUST NOT 長成單一廠牌的形狀
（本 capability 分階段實作，後續階段會加入另一廠牌的來源；schema 若綁定
單一廠牌欄位，後續階段將被迫遷移）。廠牌專有的次要訊號 MUST 保留於
`extra_json` 而非主要欄位，資料才不會遺失且日後不需重新匯入。

#### Scenario: 匯入整張記錄卡
- **WHEN** 使用者選擇 CPAP 記錄卡的資料夾（含每日摘要檔與逐次紀錄目錄）
- **THEN** 每日摘要、呼吸事件與血氧分別入庫；未被解析的檔案（校驗碼檔、
  設定檔、排除的波形檔）MUST NOT 建立來源紀錄

#### Scenario: 廠牌專有訊號不佔主要欄位
- **WHEN** 來源含主要欄位未涵蓋的訊號（如面罩壓力、吐氣壓力）
- **THEN** 該值存入 `extra_json` 且不遺失，主要欄位維持跨廠牌共通的集合

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/cpap_resmed_adapter.md
  - docs/verification/cpap_closeout.md
-->

---
### Requirement: 一晚的日期歸屬

一個「紀錄夜」MUST 自正午起算：起始時刻在正午之後者歸屬當日，在正午
之前者歸屬**前一日**。每日摘要與逐次紀錄（事件、血氧）MUST 套用同一條
規則，且 MUST 以資料本身的起始時刻推導，MUST NOT 取檔名中的日期字串。

理由：午夜之後就寢時，檔名日期會與每日摘要相差一天，於是同一晚的事件與
摘要在畫面上成為兩天，且不會產生任何錯誤訊息。

檢視層 MUST 明示日期語意為「入睡當晚」，且說明文字 MUST 只描述機器行為
（正午為分界），MUST NOT 使用帶治療語氣的措辭。規格與程式註解一律使用
「紀錄夜」：舊術語留在規格裡，日後會被照著寫回介面，而用語守衛只掃
`app/src`。

#### Scenario: 午夜後就寢
- **WHEN** 某次紀錄的起始時刻為凌晨 01:00
- **THEN** 其歸屬日期為前一日，與該晚的每日摘要一致

#### Scenario: 跨月與跨年
- **WHEN** 起始時刻為某月一日凌晨、或一月一日凌晨
- **THEN** 歸屬日期分別為上月最後一日、前一年十二月三十一日

#### Scenario: 檢視層的日期說明
- **WHEN** 檢視睡眠呼吸分頁的每晚圖表
- **THEN** 圖說標明日期為「入睡當晚」並說明正午分界，且不出現治療語氣用語

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/cpap_resmed_adapter.md
  - docs/verification/viewer_history_refinement.md
-->

---
### Requirement: 缺測值判定

來源以特定數值表示「此欄位當日無資料」。判定 MUST 以**數位值低於該訊號
宣告的數位下界**為準。

MUST NOT 以物理值比對：各訊號的縮放係數不同，同一個缺測數位值會縮放成
不同的物理值，必然漏判。

MUST NOT 以「等於數位下界」比對：實測缺測值低於下界，而下界本身多半是
合法量測（分項指數為 0、壓力為最低設定值）。此寫法會同時**漏掉全部缺測
日**（於是趨勢圖畫出整片假點）並**誤刪大量合法的 0 值**。

整日未使用機器者 MUST NOT 入庫，且 MUST 於匯入報告揭露被跳過的天數，
使用者才不會誤以為資料變少。單一欄位缺測時該欄位存 NULL，該日其餘欄位
照常入庫。

#### Scenario: 未使用日不入庫但被揭露
- **WHEN** 來源含整日未使用機器的佔位紀錄
- **THEN** 該日不建立每日摘要列，匯入報告顯示被跳過的天數

#### Scenario: 合法的零值不得被當成缺測
- **WHEN** 某日的分項指數確實為 0、或壓力欄等於數位下界
- **THEN** 該值如實入庫，MUST NOT 被寫成 NULL

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/cpap_edf_parse.md
  - docs/verification/cpap_resmed_adapter.md
-->

---
### Requirement: 呼吸事件分類

事件類型 MUST 依來源標注原樣入庫，且 MUST 涵蓋**未分類**的呼吸中止事件。
標記錄製起點之類的非事件標注 MUST NOT 入庫為呼吸事件。

漏掉未分類事件會使每日摘要的合計指數與分項總和對不攏，而兩者都來自
同一份來源，對不攏時沒有任何錯誤訊息。

#### Scenario: 五類標注的處理
- **WHEN** 來源含阻塞型、中樞型、低通氣、未分類呼吸中止與錄製起點標注
- **THEN** 前四者入庫為事件，錄製起點不入庫

#### Scenario: 事件時刻
- **WHEN** 事件標注帶有相對於紀錄起點的位移秒數
- **THEN** 事件時刻為紀錄起始時刻加上該位移

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/cpap_edf_parse.md
  - docs/verification/cpap_resmed_adapter.md
-->

---
### Requirement: 多裝置共存

每日摘要、事件與血氧的去重鍵 MUST 包含**裝置識別**。不同機器的資料期間
可能重疊；鍵不含裝置時，重疊期間的同一天會被視為重複而靜默丟棄，且丟棄
的是哪一台不可控。

裝置識別 MUST 使用機型字串，MUST NOT 使用裝置序號（序號為識別碼，機型
已足以區分本情境的兩台機器）。讀不到機型時 MUST 回退為可辨識的預設值
並於匯入結果明確告知，MUST NOT 靜默使用空值。

#### Scenario: 讀不到機型
- **WHEN** 記錄卡缺少機型資訊
- **THEN** 匯入仍完成，裝置欄為預設值，訊息告知使用者已以預設值代替

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/cpap_resmed_adapter.md
-->

---
### Requirement: 只顯示不解讀

CPAP 的臨床指標 MUST 只呈現數值與趨勢，MUST NOT 附帶任何判定性描述
（嚴重程度、是否達標、是否需要就醫、控制良好或不佳等）。既有的非結論式
用語守衛 MUST 涵蓋本 capability 的新增文案。

**機器輸出的量值 MUST 以描述性名稱呈現**：以「送氣壓力」稱機器輸出的
壓力，MUST NOT 用「治療壓力」這類把數值與治療成效綁在一起的措辭。
「治療壓力」與「治療夜」MUST 列入用語守衛的禁用詞清單。清單 MUST 使用
精確詞，MUST NOT 加寬為「治療」二字：免責聲明本身含「不提供診斷、治療
或用藥建議」，加寬會使免責聲明自我違規。

用語守衛掃描 `app/src` 全部 js／html／json 的**檔案內容含註解**，因此
程式註解中的舊術語 MUST 先行改為新術語，否則加入禁用詞當下建置檢查即
失敗。守衛範圍不含 CHANGELOG 與規格文件，該兩處的用語 MUST 於改動時
人工確認。

數值編碼的枚舉欄位（治療模式等）在沒有公開對照表可查證時，MUST 原樣存入
資料庫但 MUST NOT 在介面顯示語意標籤：猜測的對照若猜錯，使用者無從察覺。

#### Scenario: 未知枚舉不顯示
- **WHEN** 來源含數值編碼的治療模式欄位且無公開對照表
- **THEN** 該值入庫供日後補對照，介面不顯示任何模式名稱

#### Scenario: 禁用詞守衛涵蓋新增用語
- **WHEN** 任何 `app/src` 下的檔案內容出現「治療壓力」或「治療夜」
- **THEN** 用語守衛的全域掃描失敗，指出命中的檔案與詞

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/cpap_closeout.md
  - docs/verification/viewer_history_refinement.md
-->

---
### Requirement: 已知限制的揭露

以下限制 MUST 於規格與使用者可見處明列，MUST NOT 以留白或看似正常的
空畫面呈現：

- 血氧的去飽和區段精確秒數不可還原（逐分鐘聚合的代價）。
- 來源未接血氧模組時完全沒有血氧資料，此時 MUST 顯示原因說明，
  MUST NOT 呈現一張空的圖表。
- 順從度以「有紀錄天數 ÷ 區間天數」呈現；未使用日不入庫，因此換機造成
  的空窗無法區分「沒有使用」與「用了另一台但尚未匯入」。
- **逐筆事件只保留最近一段期間**：超出保留範圍的夜晚在檢視層仍有每日
  摘要與每晚事件數，但沒有逐筆明細。保留範圍與庫內實際有事件的夜晚數
  MUST 在檢視層明示。

#### Scenario: 來源沒有血氧資料
- **WHEN** 來源的血氧檔結構完整但全部樣本皆為缺測（未接血氧模組）
- **THEN** 血氧不建立任何資料列（不是錯誤），檢視層顯示原因說明而非空圖

#### Scenario: 逐筆事件超出保留範圍
- **WHEN** 庫內有事件的夜晚數超過逐筆保留的晚數上限
- **THEN** 檢視層顯示「逐筆僅保留最近 N 晚（共 M 晚有事件）」並說明較早
  的夜晚仍有每日摘要與每晚事件數

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/cpap_viewer.md
  - docs/verification/cpap_closeout.md
  - docs/verification/viewer_history_refinement.md
-->
