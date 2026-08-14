# app-viewer — 成員切換與依人檢視

## ADDED Requirements

### Requirement: 成員切換與依人檢視

App MUST 提供全域成員切換器（含「管理成員…」入口）；檢視頁
（四分頁＋搜尋）與總覽狀態列 MUST 僅顯示當前成員的資料，切換
成員 MUST 即時刷新、毋須重啟。匯入紀錄卡屬資料庫管理視角，
MUST 依成員分組列出全部來源檔案（不隨切換器過濾），資料庫位置
等全庫資訊維持原樣。

#### Scenario: 切換即刷新
- **WHEN** 資料庫含兩位成員資料，使用者由「本人」切換至「媽媽」
- **THEN** 四分頁、搜尋與狀態列筆數即時改為「媽媽」的資料，
  不含「本人」任何紀錄；匯入紀錄卡仍列出兩位成員的來源檔案
  （各自分組）

#### Scenario: 匯入他人不動當前檢視
- **WHEN** 檢視「本人」時完成一筆歸屬「媽媽」的匯入
- **THEN** 檢視頁維持「本人」資料不變，切至「媽媽」即見新匯入
  內容

## MODIFIED Requirements

### Requirement: DataProvider 契約

檢視層 MUST 透過 DataProvider 介面取得資料，provider MUST 接受
成員 id（必填）並僅回傳該成員的資料（meta.profile ＝該成員顯示
名稱；counts 的 profiles 一欄維持全庫成員數）；回傳結構 MUST 與
既有單檔 dashboard 嵌入 JSON 同構並以 JSON Schema（shape.json）
鎖定；App 實作以 SQL 查詢組裝，聚合規則（活動類月聚合、每日單一
來源最大步數等）沿用 `dashboard-generator` spec 的既有 requirements。

#### Scenario: 契約驗證
- **WHEN** 對同一單成員資料庫分別執行 App provider（帶該成員 id）
  與 Python embed 產出
- **THEN** 兩者皆通過 shape.json 驗證，且數值內容全等（鍵順序除外）

#### Scenario: 成員隔離 marker 掃描
- **WHEN** 兩成員 fixture 庫中成員 B 的全部紀錄含唯一 marker
  字串，對成員 A 執行 provider
- **THEN** 成員 A 的 payload 序列化結果零出現該 marker（任一查詢
  漏加 profile 過濾即失敗）

### Requirement: 單檔 HTML 匯出（選用功能）

App MUST 提供「匯出單檔 HTML」：以 provider 當下**當前成員**的
資料序列化進既有模板，產出與 Python generate 同構的單檔（供 iPad
等外部檢視），MUST NOT 含其他成員資料。檔名 MUST 含成員名稱
（檔名不安全字元代換為底線）。匯出檔含個資，儲存對話框 MUST
預設至使用者文件目錄而非 repo。

#### Scenario: 匯出同構（單成員庫）
- **WHEN** 對同一單成員資料庫分別執行 App 匯出與 `mhb rebuild`
- **THEN** 兩份 HTML 嵌入的資料 JSON 數值全等（生成時間戳除外），
  於瀏覽器開啟行為一致

#### Scenario: 匯出僅當前成員
- **WHEN** 兩成員庫中檢視「媽媽」時匯出 HTML
- **THEN** 匯出檔僅含「媽媽」的資料（marker 掃描零出現另一成員
  紀錄），檔名含「媽媽」
