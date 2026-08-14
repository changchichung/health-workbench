# app-viewer — App 內即時渲染與匯出

## ADDED Requirements

### Requirement: DataProvider 契約

檢視層 MUST 透過 DataProvider 介面取得資料，回傳結構 MUST 與既有
單檔 dashboard 嵌入 JSON 同構並以 JSON Schema（shape.json）鎖定；
App 實作以 SQL 查詢組裝，聚合規則（活動類月聚合、每日單一來源最大
步數等）沿用 `dashboard-generator` spec 的既有 requirements。

#### Scenario: 契約驗證
- **WHEN** 對同一資料庫分別執行 App provider 與 Python embed 產出
- **THEN** 兩者皆通過 shape.json 驗證，且數值內容全等（鍵順序除外）

### Requirement: 即時檢視

開啟 App MUST 直接顯示資料庫最新資料（四分頁＋搜尋，元件沿用既有
app.js），匯入完成後 MUST 自動刷新，毋須重啟或手動重新整理。

#### Scenario: 開啟即見最新
- **WHEN** 使用者完成一次匯入後關閉並重新開啟 App
- **THEN** 總覽 tiles 與各分頁直接反映最新資料

#### Scenario: 匯入後自動刷新
- **WHEN** 檢視頁開啟狀態下完成一次匯入
- **THEN** 目前分頁資料自動更新，搜尋索引含新資料

### Requirement: 既有互動行為不退化

四分頁、全文搜尋、篩選連動、用藥三分類、處方時間軸展開、藥↔看診
雙向跳轉與捲動定位、匯入紀錄卡等 `dashboard-generator` spec 既有
requirements 在 App 內 MUST 全數成立。

#### Scenario: 走查清單
- **WHEN** 依 dashboard-generator spec 的 scenario 清單逐項走查 App
- **THEN** 全數通過，無互動退化

### Requirement: 單檔 HTML 匯出（選用功能）

App MUST 提供「匯出單檔 HTML」：以 provider 當下資料序列化進既有
模板，產出與 Python generate 同構的單檔（供 iPad 等外部檢視）。
匯出檔含個資，儲存對話框 MUST 預設至使用者文件目錄而非 repo。

#### Scenario: 匯出同構
- **WHEN** 對同一資料庫分別執行 App 匯出與 `mhb rebuild`
- **THEN** 兩份 HTML 嵌入的資料 JSON 數值全等（生成時間戳除外），
  於瀏覽器開啟行為一致
