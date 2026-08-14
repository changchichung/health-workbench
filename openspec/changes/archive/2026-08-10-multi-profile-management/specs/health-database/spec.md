# health-database — 多人正式支援

## MODIFIED Requirements

### Requirement: 多人預留 schema

所有資料表 SHALL 含 profile_id 欄位並以其為複合索引首欄；多成員
資料 SHALL 以 profile_id 完全隔離（去重 UNIQUE 鍵含 profile_id，
成員間冪等互不干擾）。profiles 表 SHALL 儲存顯示名稱與遮罩身分證，
MUST NOT 儲存完整身分證字號。刪除成員 MUST 於單一交易內清除該
成員在全部資料表（含 source_documents）的所有列。本輪 MUST NOT
變更 DDL（schema 維持 v3；Python 側 schema.py 不動，schema parity
測試基準不變）。

#### Scenario: 兩人資料隔離
- **WHEN** 同一資料庫含兩位成員的資料，查詢以 profile_id 篩選
- **THEN** 任一成員的查詢結果不含另一成員任何紀錄；同內容紀錄
  分屬兩成員時各自入庫，不被跨成員去重

#### Scenario: 刪除成員交易原子
- **WHEN** 刪除成員的逐表清除進行中發生中斷
- **THEN** 整批回滾，該成員資料完整保留，無半刪狀態
