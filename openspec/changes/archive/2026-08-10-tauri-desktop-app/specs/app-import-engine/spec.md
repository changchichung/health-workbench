# app-import-engine — JS 匯入引擎與等價協定

## ADDED Requirements

### Requirement: 與既有匯入 specs 的行為等價

JS 匯入引擎 MUST 滿足既有 `nhi-import`、`apple-health-import`、
`incremental-merge`、`health-database` specs（openspec/specs/）的全部
requirements；該四份 specs 的行為描述對本引擎具約束力，本 spec 不重抄。

#### Scenario: 差分對帳全等（fixture 全集）
- **WHEN** 將既有去識別化 fixture 全集分別經 Python CLI 與 JS 引擎
  （node:sqlite driver）匯入兩個空庫
- **THEN** 逐表排序 dump diff 全等（排除 imported_at 時間戳；自增
  主鍵不直接比對，外鍵欄位先解析為參照列自然鍵再比，關聯正確性
  必須被覆蓋），增量品質報告 JSON（時間戳除外）全等，harness
  exit code 0

#### Scenario: 畸形數值契約
- **WHEN** fixture 含 value="12abc" 的紀錄
- **THEN** JS 引擎與 Python 一致視為文字值（value_text），
  MUST NOT 以 parseFloat 前綴寬鬆解析為 12

### Requirement: 儲存存取抽象與批次寫入

匯入引擎與 adapter MUST 僅透過 StoreDriver 介面（execute/select/
batchInsert/transaction）存取資料庫；App 實作走 app 自有 SQLite 橋
（rusqlite 單連線＋Mutex，design D2 修訂二），測試實作走 node:sqlite。批次寫入 MUST 於單一交易內以 json_each
單參數展開分批（每批 20000 列）執行（2026-08-09 task 0.3 實測定案；
多列 VALUES 因 sqlx 參數綁定成本被否決）。

#### Scenario: 同一套業務碼雙環境執行
- **WHEN** 以 node:sqlite driver 執行完整匯入測試套件
- **THEN** 全部通過，且被測模組與 App 打包進 bundle 的引擎模組為同一
  份檔案（非複製）

#### Scenario: 批次效能門檻
- **WHEN** 在真實 App（WKWebView）內經 SQLite 橋批次寫入
  10 萬筆 apple_records（2026-08-09 橋接後復驗 1.96s）
- **THEN** 10 秒內完成且交易原子（中斷即整批回滾）

### Requirement: 串流解析與大檔門檻

adapter MUST 分塊串流讀檔與解析（禁止一次性讀入整檔）；zip MUST 以
DecompressionStream 串流解壓。220MB 合成 Apple 匯出檔於真實 App 內
解析＋入庫 MUST 於 60 秒內完成。

#### Scenario: 大檔匯入
- **WHEN** 在 App 內匯入 220MB 去識別化合成 export.xml（90 萬元素）
- **THEN** 60 秒內完成，過程中記憶體峰值不隨檔案大小線性成長
  （分塊上限固定），結果與 oracle 對帳全等

#### Scenario: zip 直接匯入
- **WHEN** 使用者選擇 export.zip（含中文檔名成員、cp437 旗標未設）
- **THEN** 正確找到 XML 成員並串流解壓匯入，毋須使用者先解壓

### Requirement: adapter 註冊制與格式擴充點

MUST 以註冊表管理 adapter，每個 adapter 提供內容判型
`detect(header, name)` 與 `import(source, store, progress)`；
新增格式 MUST 只需新增 adapter 模組與註冊項，引擎與 GUI 不改。

#### Scenario: 內容判型
- **WHEN** 使用者選擇副檔名改為 .txt 的健保 JSON 檔
- **THEN** 仍被 NHI JSON adapter 正確識別並匯入（判內容不判檔名）

#### Scenario: 擴充點驗證
- **WHEN** 測試注入一個假格式 adapter（detect 匹配魔術位元組）
- **THEN** 引擎自動判型並路由至該 adapter，GUI 格式清單自動含其名稱

### Requirement: 健保 XML 匯入

MUST 新增 NHI XML adapter：解析 XML 版共同節區（r1-r8，官方 XML 格式
無 r9-r14），欄位對照與 JSON 版一致，r8 報告 MUST 保留原始換行。

#### Scenario: 同批 JSON/XML 交叉對帳
- **WHEN** 將同批下載的 JSON 與 XML 檔分別匯入兩個空庫，以
  （section, record_fp）對齊紀錄（兩格式檔內排序不同，不得以列序對齊）
- **THEN** r1-r7 全部紀錄指紋對齊且欄位全等；白名單僅 r8：官方 JSON
  移除換行字元（非代換空白），故含換行報告的指紋跨格式必然不同，
  以弱鍵（test_date＋order_code＋facility_name）對齊後 report_text
  去除全部空白後 MUST 全等（2026-08-09 真實同批檔實測：65 encounters
  ＋68 labs＋4 immunizations 指紋全對齊零差異；r8 7 筆中 6 筆含換行）

#### Scenario: XML 節區缺漏事實
- **WHEN** 匯入 XML 檔
- **THEN** r9-r14 節區標記 no_data 且品質報告註明「XML 格式無此節區」，
  不誤報為資料異常

### Requirement: 匯入進度回報

adapter MUST 以已讀位元組數回報進度（每處理 5000 筆呼叫一次
progress），供 GUI 顯示百分比；進度回報失敗 MUST NOT 影響匯入結果。

#### Scenario: 進度單調
- **WHEN** 匯入 220MB 合成檔並記錄 progress 事件
- **THEN** readBytes 單調遞增至 totalBytes，事件數 ≥ 50（進度以資料塊為
  週期回報，220MB／4MB 塊＝56 事件，2026-08-09 實測校準）
