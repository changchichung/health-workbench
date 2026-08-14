# app-import-engine — 多檔來源匯入

## MODIFIED Requirements

### Requirement: adapter 註冊制與格式擴充點

MUST 以註冊表管理 adapter，每個 adapter 提供內容判型
`detect(header, name)` 與 `import(source, store, progress)`；
新增格式 MUST 只需新增 adapter 模組與註冊項，引擎與 GUI 不改。

**多檔來源** MUST 另以可選介面支援：集合判型與集合匯入。註冊表的介面
檢查 MUST 接受「單檔匯入與集合匯入至少實作其一」，MUST NOT 要求多檔
adapter 實作單檔匯入（半批匯入沒有意義）。

集合判型收到的項目 MUST 以**惰性方式**提供檔頭，由 adapter 自行決定要
讀哪幾個檔。MUST NOT 由呼叫端預先讀取全部檔頭：資料夾可能含上千個與該
adapter 無關的檔案（如另一個來源的匯出目錄），逐檔讀取會讓其他來源的
每次匯入都多出上千次輸入輸出。

只實作單檔匯入的既有 adapter MUST NOT 因本擴充而需要修改。

#### Scenario: 內容判型
- **WHEN** 使用者選擇副檔名改為 .txt 的健保 JSON 檔
- **THEN** 仍被 NHI JSON adapter 正確識別並匯入（判內容不判檔名）

#### Scenario: 擴充點驗證
- **WHEN** 測試注入一個假格式 adapter（detect 匹配魔術位元組）
- **THEN** 引擎自動判型並路由至該 adapter，GUI 格式清單自動含其名稱

#### Scenario: 集合判型只讀必要的檔
- **WHEN** 對一個含大量無關檔案的資料夾進行集合判型
- **THEN** 不符合該 adapter 特徵時一個檔案都不讀取；符合時只讀取該
  adapter 需要的那幾個檔

#### Scenario: 多檔 adapter 的註冊
- **WHEN** 註冊一個只實作集合匯入的 adapter
- **THEN** 註冊成功；兩種匯入介面都沒有時才拒絕

---
### Requirement: 匯入進度回報

adapter MUST 以已讀位元組數回報進度（每處理 5000 筆呼叫一次
progress），供 GUI 顯示百分比；進度回報失敗 MUST NOT 影響匯入結果。

**多檔來源** MUST 以整批合計位元組為總量、跨檔累加已讀位元組，進度在
整批匯入過程中 MUST 維持單調遞增。

#### Scenario: 進度單調
- **WHEN** 匯入 220MB 合成檔並記錄 progress 事件
- **THEN** readBytes 單調遞增至 totalBytes，事件數 ≥ 50（進度以資料塊為
  週期回報，220MB／4MB 塊＝56 事件，2026-08-09 實測校準）

#### Scenario: 多檔進度單調
- **WHEN** 匯入含多個檔案的來源
- **THEN** 已讀位元組跨檔累加且不回退，總量為整批合計

## ADDED Requirements

### Requirement: 多檔來源的原子性與逐檔韌性

一次多檔匯入 MUST 在**單一交易**內完成：中途失敗時全庫回滾，連來源紀錄
都不留下。逐檔失敗 MUST NOT 使整批中止：單一檔案解析失敗時該檔跳過並
計數，其餘檔案照常入庫，失敗清單 MUST 出現在匯入結果中。

單檔讀入 MUST 有大小上限，且上限 MUST 在**決定是否讀入該檔**的那一層
把關。在解析層檢查沒有意義：該層收到的已經是位元組陣列，記憶體已經耗掉。

#### Scenario: 整批原子
- **WHEN** 多檔匯入因缺少必要參數而失敗
- **THEN** 三張資料表與 source_documents 皆零寫入

#### Scenario: 壞檔不拖垮整批
- **WHEN** 批次中有一個檔案內容損毀無法解析
- **THEN** 其餘檔案正常入庫，該檔在結果中標示為解析失敗並計入錯誤數

#### Scenario: 超過單檔上限
- **WHEN** 批次中某個檔案超過單檔讀入上限
- **THEN** 該檔跳過並在結果中標示，不影響其他檔案
