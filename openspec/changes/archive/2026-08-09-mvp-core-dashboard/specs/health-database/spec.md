# health-database — 正規化健康資料庫

## ADDED Requirements

### Requirement: 多人預留 schema
所有資料表 SHALL 含 profile_id 欄位並以其為複合索引首欄；
MVP SHALL 固定使用單一 profile（自遮罩身分證建立）。
profiles 表 SHALL 儲存顯示名稱與遮罩身分證，MUST NOT 儲存完整身分證字號。

#### Scenario: 未來加入家人不需遷移
- **WHEN** v2 以新 profile 匯入第二人資料
- **THEN** 既有表結構不變，查詢以 profile_id 篩選即隔離兩人資料

### Requirement: 來源追溯
每筆正規化資料 SHALL 帶 source_document 外鍵、來源節區/型別與
來源索引，足以還原至原始檔案中的位置。source_documents SHALL 記錄
檔名、SHA-256、匯入時間與 adapter 名稱及版本。

#### Scenario: 從圖表回到原始檔
- **WHEN** 查詢任一檢驗結果的來源
- **THEN** 可得原始檔名、節區（r7）與該筆在節區中的索引

### Requirement: 品質旗標貫穿
quality_flags SHALL 為每筆資料的可累加欄位，聚合查詢與趨勢 MUST
排除帶排除性旗標（epoch_placeholder_date、out_of_range）的資料，
品質報告 SHALL 按旗標統計筆數。

#### Scenario: 品質報告
- **WHEN** 執行 mhb quality
- **THEN** 輸出各旗標筆數、unmapped 檢驗名清單、superseded 對照組數

### Requirement: 檢驗名稱正規化欄位
lab_results SHALL 同時保存 test_name_raw 與 test_name_normalized；
正規化依 knowledge 別名表，未匹配者 normalized 為 NULL 並標 unmapped。
趨勢分組 MUST 使用 normalized 名稱；unmapped 者 MUST 以原名獨立成組
並標示 unmapped，MUST NOT 因未匹配而自趨勢圖消失；不同計算法的同名概念
（如 eGFR (CKD-EPI) 與 eGFR (MDRD)）MUST 維持獨立正規化名，
MUST NOT 合併為同一趨勢線。

#### Scenario: Hb 與 HB 合併
- **WHEN** 兩院所分別回報 Hb 與 HB
- **THEN** 兩者 normalized 同為 Hemoglobin，趨勢圖同一條線

#### Scenario: eGFR 不合併
- **WHEN** 資料含 eGFR (CKD-EPI) 與 eGFR (MDRD)
- **THEN** 兩者為不同正規化名、各自成線

### Requirement: schema 版本化
資料庫 SHALL 含 schema_version 表；CLI 開啟資料庫時版本不符 MUST
執行前向遷移或明確報錯，MUST NOT 以不符版本靜默讀寫。

#### Scenario: 舊庫開啟
- **WHEN** 以新版 CLI 開啟舊 schema 資料庫
- **THEN** 自動執行遷移並更新版本註記，或列出不可遷移原因後中止

### Requirement: 匯入統計記錄
source_documents SHALL 記錄每次匯入的統計（import_stats，JSON：
inserted/skipped_dup/collisions）；adapter 於匯入收尾 MUST 寫入。
schema 演進 SHALL 以 MIGRATIONS 前向遷移表實作，舊版資料庫開啟時
自動逐版升級。

#### Scenario: 匯入後留下統計
- **WHEN** 完成一次匯入
- **THEN** 該 source_documents 列的 import_stats 含本次新增與略過筆數

#### Scenario: v1 庫自動升級
- **WHEN** 以現行程式開啟 schema v1 資料庫
- **THEN** 自動遷移至現行版本且既有資料完整保留
