# app-viewer — 睡眠呼吸檢視與來源清單摺疊

## MODIFIED Requirements

### Requirement: DataProvider 契約

檢視層 MUST 透過 DataProvider 介面取得資料，provider MUST 接受
成員 id（必填）並僅回傳該成員的資料（meta.profile ＝該成員顯示
名稱；counts 的 profiles 一欄維持全庫成員數）；回傳結構 MUST 與
既有單檔 dashboard 嵌入 JSON 同構並以 JSON Schema（shape.json）
鎖定；App 實作以 SQL 查詢組裝，聚合規則（活動類月聚合、每日單一
來源最大步數等）沿用 `dashboard-generator` spec 的既有 requirements。

**payload 新增 CPAP 區塊**，且 shape.json MUST 一併涵蓋它（契約若不跟上
實作，日後移除該區塊不會被任何檢查抓到）。CPAP 區塊 MUST 包含每日摘要、
每日各類事件計數、逐筆事件、事件總數與截斷旗標、每晚血氧彙總。

**逐分鐘血氧 MUST NOT 進 payload**：payload 會嵌入單檔 HTML，數年的
逐分鐘資料會是數十萬列。改帶每晚彙總（整晚最低與平均），趨勢呈現需要
的正是這個粒度。

**逐筆事件 MUST 有數量上限**，超過時只帶最近的並在 payload 標明已截斷；
檢視層 MUST 據此顯示「僅列最近 N 筆」，MUST NOT 靜默截斷。

跨語言一致性：新增的彙總 MUST 以 SQL 計算而非在兩種語言各自實作四捨五入
（既有 payload 已有為了模擬另一語言捨入行為而存在的補丁，不應再增加）。

#### Scenario: 契約驗證
- **WHEN** 對同一單成員資料庫分別執行 App provider（帶該成員 id）
  與 Python embed 產出
- **THEN** 兩者皆通過 shape.json 驗證，且數值內容全等（鍵順序除外）

#### Scenario: 成員隔離 marker 掃描
- **WHEN** 兩成員 fixture 庫中成員 B 的全部紀錄含唯一 marker
  字串，對成員 A 執行 provider
- **THEN** 成員 A 的 payload 序列化結果零出現該 marker（任一查詢
  漏加 profile 過濾即失敗）

#### Scenario: 沒有 CPAP 資料時的契約
- **WHEN** 資料庫沒有任何 CPAP 資料
- **THEN** payload 仍含 CPAP 區塊（各項為空），MUST NOT 缺鍵

---
### Requirement: 單檔 HTML 匯出（選用功能）

（既有內容不變）匯出的單檔 HTML MUST 自包含、可離線開啟，且與 App 內
檢視共用同一份檢視程式與 payload。

**匯出 MUST 涵蓋 CPAP 區塊**：嵌入資料含 CPAP 內容、檢視程式含睡眠呼吸
分頁。沒有 CPAP 資料時匯出仍 MUST 為合法產物。

#### Scenario: 匯出涵蓋新區塊
- **WHEN** 對含 CPAP 資料的成員匯出單檔 HTML
- **THEN** 嵌入資料含每日摘要與事件，檢視程式含睡眠呼吸分頁，且不超過
  既有體積門檻

## ADDED Requirements

### Requirement: 睡眠呼吸分頁

有 CPAP 資料時 MUST 提供獨立分頁，內容為：每晚 AHI（可切換顯示阻塞、
中樞、低通氣分項）、使用時數、漏氣、治療壓力、睡眠期血氧與逐次事件表。
區間選擇 MUST 沿用趨勢頁既有的共用時間域機制，MUST NOT 自造一套。

**單位或數量級不同的序列 MUST NOT 疊在同一張圖**：圖表只有單一 y 軸，
上下界由全部序列共同決定，數量級小的序列會被壓成貼底的平線。需要對照時
MUST 改用上下堆疊、共用同一時間域的多張圖。

日期語意 MUST 於圖表旁明示為「入睡當晚」。

#### Scenario: 分項切換
- **WHEN** 使用者切換顯示分項
- **THEN** 阻塞、中樞、低通氣三條序列疊加於 AHI 圖上（同為次數／小時，
  數量級一致）

#### Scenario: 漏氣與壓力分開呈現
- **WHEN** 檢視漏氣與治療壓力
- **THEN** 兩者為各自獨立、共用同一時間區間的圖表

---
### Requirement: 沒有 CPAP 資料時不留空區塊

沒有 CPAP 資料的使用者 MUST NOT 看到睡眠呼吸分頁、總覽的 CPAP 卡片，
以及趨勢頁的 AHI 圖。空分頁與空卡片是雜訊，且會讓使用者誤以為功能故障。

有 CPAP 資料但缺少其中某一類（如來源未接血氧模組）時，該區塊 MUST 顯示
原因說明，MUST NOT 呈現一張空的圖表。

#### Scenario: 只有既有來源的資料庫
- **WHEN** 資料庫只有健保或 Apple 資料
- **THEN** 分頁清單、總覽與趨勢頁均無任何 CPAP 相關區塊，既有內容不受影響

---
### Requirement: 趨勢頁的睡眠呼吸對照

趨勢頁 MUST 提供每晚 AHI 圖，與同頁其他圖共用時間域與區間選擇。
CPAP 的日期 MUST 納入共用時間域的計算來源，否則新圖的 x 軸會與同頁其他
圖不一致，資料點被壓到繪圖區邊界。

#### Scenario: 時間域涵蓋 CPAP 日期
- **WHEN** CPAP 資料的起始日期早於其他所有序列
- **THEN** 共用時間域的下界為該日期，x 軸刻度涵蓋該區間

---
### Requirement: 來源清單的摺疊呈現

匯入紀錄的來源清單 MUST 將「同一 adapter 且同一匯入時刻」的多個檔案摺疊
為一列，顯示檔案數並可展開檢視逐檔。多檔來源一次匯入會產生數十列，逐列
呈現會使該區塊失去可讀性。

摺疊 MUST 做在檢視層，payload MUST 保留逐檔紀錄：payload 端摺疊會使匯出
的單檔 HTML 失去逐檔追溯，且分組邏輯需要在兩種語言各自實作並保持一致。

#### Scenario: 多檔來源的匯入紀錄
- **WHEN** 檢視含多檔來源的匯入紀錄
- **THEN** 該批顯示為一列「N 個檔案」，展開後可見逐檔檔名，統計為該批合計
