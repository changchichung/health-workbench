# health-database — CPAP 三表與遷移安全

## ADDED Requirements

### Requirement: CPAP 資料表

SHALL 含每日摘要、呼吸事件與睡眠血氧三張表，均帶 `profile_id` 與
`doc_id`（沿用「多人預留 schema」與「來源追溯」既有 requirement）。

三張表的 UNIQUE 鍵 MUST 包含裝置識別欄位：不同機器的資料期間可能重疊，
鍵不含裝置時重疊期間的同一天會被視為重複而靜默丟棄。

每日摘要的多段使用資訊（同一天中途取下面罩再戴回）MUST 保留段數與完整
逐段起訖，MUST NOT 只存首段：機器提供的使用時數是全天合計，只存首段會
使「就寢到起床」與使用時數自相矛盾。

#### Scenario: 兩台機器的重疊日期
- **WHEN** 兩台不同機型在同一天都有每日摘要
- **THEN** 兩筆各自入庫，MUST NOT 因日期相同而丟棄其中一筆

#### Scenario: 一天分多段使用
- **WHEN** 某日的來源含多段使用區間
- **THEN** 段數、首段起、末段止與完整逐段資料都被保留，且該列標記為多段

## MODIFIED Requirements

### Requirement: schema 版本化
資料庫 SHALL 含 schema_version 表；CLI 開啟資料庫時版本不符 MUST
執行前向遷移或明確報錯，MUST NOT 以不符版本靜默讀寫。

**前向遷移 MUST 在單一交易內完成**：版本註記與結構變更同進同出。未交易化
時，若結構變更執行到一半中斷，資料庫會停在「版本已寫新值但結構只完成
一部分」的狀態，之後每次開啟都會略過遷移而讀寫缺表的資料庫。

**版本紀錄存在但為空 MUST 明確報錯**（`schema_version` 表存在卻沒有任何
列）。此時「最大版本」為 null，而 null 與數字的所有比較都是 false，
不明確攔下就會靜默通過並讓後續操作跑在缺表的資料庫上。

#### Scenario: 舊庫開啟
- **WHEN** 以新版 CLI 開啟舊 schema 資料庫
- **THEN** 自動執行遷移並更新版本註記，或列出不可遷移原因後中止

#### Scenario: 遷移中途中斷
- **WHEN** 前向遷移執行到一半發生錯誤
- **THEN** 整段回滾至遷移前的版本，新結構不存在，既有資料逐位元組不變

#### Scenario: 版本紀錄被清空
- **WHEN** `schema_version` 表存在但沒有任何列
- **THEN** 明確報錯並指引使用者以備份還原，MUST NOT 靜默視為最新版

---
### Requirement: 匯入統計記錄
source_documents SHALL 記錄每次匯入的統計（import_stats，JSON：
inserted/skipped_dup/collisions）；adapter 於匯入收尾 MUST 寫入。
schema 演進 SHALL 以 MIGRATIONS 前向遷移表實作，舊版資料庫開啟時
自動逐版升級。

**遷移前 MUST 自動產生升級前的資料庫快照**，且僅在偵測到既有版本低於
程式版本時產生（全新資料庫不做）。快照失敗 MUST 中止遷移並明確告知
（含目標路徑），MUST NOT 靜默續行。

快照 MUST 以資料庫自身的一致性快照機制產生，MUST NOT 以檔案複製實作：
複製前必須先關閉主資料庫連線，而遷移發生在開啟流程之中，連線必然是開著的。

**多檔來源的每個被解析檔案各佔一列** `source_documents`：沿用既有的
單檔內容雜湊唯一性，下次匯入同一批時只有新檔會被處理，且來源追溯精確
到檔案。整批合計的統計 MUST 只寫入本次新建的列，MUST NOT 覆寫既有列的
統計（違反「匯入不破壞既有資料」的白名單）。

#### Scenario: 匯入後留下統計
- **WHEN** 完成一次匯入
- **THEN** 該 source_documents 列的 import_stats 含本次新增與略過筆數

#### Scenario: v1 庫自動升級
- **WHEN** 以現行程式開啟 schema v1 資料庫
- **THEN** 自動遷移至現行版本且既有資料完整保留

#### Scenario: 升級前自動快照
- **WHEN** 開啟一個版本落後於程式的既有資料庫
- **THEN** 先產生一份升級前的快照再遷移；快照可被「匯入既有資料庫檔」
  讀回且維持升級前的版本

#### Scenario: 部分新檔的批次匯入
- **WHEN** 同一個多檔來源第二次匯入，其中只有部分檔案是新的
- **THEN** 只有新檔被解析，既有檔案的來源列與其統計逐位元組不變
