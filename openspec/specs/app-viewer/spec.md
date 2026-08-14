# app-viewer Specification

## Purpose

TBD - created by archiving change 'tauri-desktop-app'. Update Purpose after archive.

## Requirements

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

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/multi_profile_qa_closeout.md
  - docs/verification/cpap_viewer.md
-->

---
### Requirement: 即時檢視

開啟 App MUST 直接顯示資料庫最新資料（四分頁＋搜尋，元件沿用既有
app.js），匯入完成後 MUST 自動刷新，毋須重啟或手動重新整理。

#### Scenario: 開啟即見最新
- **WHEN** 使用者完成一次匯入後關閉並重新開啟 App
- **THEN** 總覽 tiles 與各分頁直接反映最新資料

#### Scenario: 匯入後自動刷新
- **WHEN** 檢視頁開啟狀態下完成一次匯入
- **THEN** 目前分頁資料自動更新，搜尋索引含新資料


<!-- @trace
source: tauri-desktop-app
updated: 2026-08-10
code:
  - docs/verification/app_qa_closeout.md
-->

---
### Requirement: 既有互動行為不退化

四分頁、全文搜尋、篩選連動、用藥三分類、處方時間軸展開、藥↔看診
雙向跳轉與捲動定位、匯入紀錄卡等 `dashboard-generator` spec 既有
requirements 在 App 內 MUST 全數成立。趨勢圖改為共用時間域定位、
標記降級與區間選擇後，總覽頁的體重趨勢卡（維持既有「最後 365 筆」
語意不變）、檢驗趨勢的項目下拉、最新檢驗表點入跳轉 MUST 維持既有行為；
步數圖在近一年與全部區間維持月平均（近三月改逐日，見「趨勢圖依
區間過濾資料點」）。

#### Scenario: 走查清單
- **WHEN** 依 dashboard-generator spec 的 scenario 清單逐項走查 App
- **THEN** 全數通過，無互動退化

#### Scenario: 總覽體重卡不受影響
- **WHEN** 趨勢頁區間切為「近三月」
- **THEN** 總覽頁的體重趨勢卡顯示內容不變（其資料範圍與趨勢頁的
  區間選擇無關）



<!-- @trace
source: trend-time-axis
updated: 2026-08-12
code:
  - docs/verification/app_qa_closeout.md
  - docs/verification/trend_time_axis_closeout.md
-->

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

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/multi_profile_qa_closeout.md
  - docs/verification/trend_time_axis_closeout.md
  - docs/verification/cpap_closeout.md
-->

---
### Requirement: 成員切換與依人檢視

App MUST 提供全域成員切換器（含「管理成員…」入口）；檢視頁
（四分頁＋搜尋）與總覽狀態列 MUST 僅顯示當前成員的資料，切換
成員 MUST 即時刷新、毋須重啟。匯入紀錄卡屬資料庫管理視角，
MUST 依成員分組列出全部來源檔案（不隨切換器過濾），資料庫位置
等全庫資訊維持原樣；每筆來源檔案列 MUST 提供「刪除」與
「改歸屬」操作入口（行為由 profile-management 的匯入紀錄刪除、
改歸屬與健保身分綁定守恆 requirements 定義），操作完成後匯入
紀錄卡 MUST 即時刷新，若影響當前檢視成員，檢視頁與狀態列 MUST
同步刷新。

#### Scenario: 切換即刷新
- **WHEN** 資料庫含兩位成員資料，使用者由「本人」切換至「媽媽」
- **THEN** 四分頁、搜尋與狀態列筆數即時改為「媽媽」的資料，
  不含「本人」任何紀錄；匯入紀錄卡仍列出兩位成員的來源檔案
  （各自分組）

#### Scenario: 匯入他人不動當前檢視
- **WHEN** 檢視「本人」時完成一筆歸屬「媽媽」的匯入
- **THEN** 檢視頁維持「本人」資料不變，切至「媽媽」即見新匯入
  內容

#### Scenario: 救援操作後即時刷新
- **WHEN** 檢視「媽媽」時，使用者將「媽媽」名下一筆來源檔案
  改歸屬至「爸爸」
- **THEN** 匯入紀錄卡該筆移入「爸爸」分組，檢視頁與狀態列筆數
  即時扣除該批資料，毋須重啟或手動重整

<!-- @trace
source: misattribution-rescue
updated: 2026-08-12
code:
  - docs/verification/misattribution_rescue_qa_closeout.md
-->

---
### Requirement: 趨勢圖以共用時間域定位

**本 requirement 適用於趨勢頁的圖表。** 總覽頁的體重趨勢卡沒有區間
控制項，其時間域 MUST 為該卡資料自身的首末日期。

趨勢頁的全部圖表 MUST 共用一組時間域 `[tMin, tMax]`，該時間域
MUST 由當前顯示區間的日曆邊界決定，MUST NOT 由個別序列自身的資料
範圍決定：近三月為 `[today - 90 日, today]`、近一年為
`[today - 365 日, today]`、全部為 `[趨勢序列集合中的最早日期, today]`。

`today` MUST 為 `max(meta.generated_at, 趨勢序列集合中的最新日期)`，
MUST NOT 取執行當下的系統時間（匯出的單檔 HTML 是「資料截至某日」的
快照，其區間與預設值 MUST NOT 隨開啟時間改變）。取 max 的理由：
`generated_at` 在 App 端與 Python 端的產生方式不同（一為 UTC 日期、
一為本地日期），且資料最新一筆可能晚於 `generated_at`；若上界不含
最新資料，該筆量測會被靜默隱藏。任何資料點 MUST NOT 因落在時間域
之外而被無聲剔除。

**趨勢序列集合**（`tMin`、`today` 與預設區間判定皆以此為準）MUST 為：
體重（自主量測與健保成健兩條）、收縮壓、舒張壓、步數、**全部**可繪圖
的檢驗項目（即有數值結果者；純文字結果不繪圖故不影響時間域）；
MUST NOT 只計入檢驗下拉當前選中的項目（否則切換檢驗項目會位移其他
圖表的 x 軸）。

資料點 x 座標 MUST 為 `(t - tMin) / (tMax - tMin)` 的線性映射，
使時間間隔與圖上水平距離成正比。x 軸刻度 MUST 依時間挑選（跨度
超過 2 年按年、超過 3 月按月、否則按週），MUST NOT 依資料點序位
挑選。刻度數 MUST 有上限，超過時 MUST 逐級降粒度直到不超過上限。粒度階梯
MUST 單調由細到粗（週→每 2 週→月→每季→每半年→年→每 2／5／10／20／
50 年），MUST NOT 在粗粒度用盡後回到更細的粒度；階梯全部用盡時
MUST 至少回傳首末兩個刻度，MUST NOT 回傳空刻度（跨度極大時 x 軸
整條標籤消失且不會報錯，屬無聲失敗）。年粒度且間隔大於 1 年時，
刻度 MUST 對齊該間隔的倍數年。刻度標籤格式 MUST 隨粒度
決定（年為 `YYYY`，季與月為 `YY-MM`，週與日為 `MM-DD`），
MUST NOT 讓同一個月內的多個刻度標成相同文字。

各序列的名稱與最新值 MUST 標示於繪圖區右側的固定位置（圖例式、
垂直排列不重疊），MUST NOT 緊貼折線末端（末端標籤在時間軸下會被
右邊界截斷，或落在圖中央壓住其他資料）。圖例可用寬度僅約 100px，
故名稱與數值 MUST 分行，名稱過長 MUST 截斷；格線右緣 MUST 收至
繪圖區右緣以免壓在圖例上。

區間跨度為零時 MUST 正常渲染而不除以零（資料點置於繪圖區左緣）。

#### Scenario: 停止記錄的序列不再看似最新
- **WHEN** 某序列最後一筆距 `today` 超過一年，顯示區間為「全部」
- **THEN** 該序列末點依其日期定位、明顯不在繪圖區右緣，右側空窗
  如實留白，使用者看得出資料已停止

#### Scenario: 不規則間隔的斜率正確
- **WHEN** 某檢驗項目僅 3 筆、分別相隔數月與一年以上
- **THEN** 各段折線的水平距離比例與實際天數比例相符，MUST NOT 鋪滿
  整個圖寬而看似連續趨勢

#### Scenario: 刻度不重疊
- **WHEN** 序列僅分佈於時間域左側三分之二（其後停止記錄）
- **THEN** x 軸刻度依時間分佈於整個時間域，相鄰刻度水平間距不小於
  文字寬度所需（實作以 40px 為驗收門檻）

#### Scenario: 極大跨度仍有刻度
- **WHEN** 時間域跨度超過 40 年（例如一筆年份被誤解析的老舊日期）
- **THEN** x 軸仍有至少兩個刻度，MUST NOT 變成沒有任何標籤

#### Scenario: 匯出檔的時間基準固定
- **WHEN** 同一份匯出的單檔 HTML 於產出後數個月再開啟
- **THEN** 時間域、預設區間與各點位置與產出當時完全相同

#### Scenario: 退化輸入
- **WHEN** 序列只有一個資料點，或全部點日期相同，或區間跨度為零
- **THEN** 圖表正常渲染（無 NaN 座標、無空白圖），資料點可見


<!-- @trace
source: trend-time-axis
updated: 2026-08-12
code:
  - docs/verification/trend_time_axis_closeout.md
-->

---
### Requirement: 趨勢頁時間區間選擇

趨勢頁 MUST 提供一組作用於該頁全部圖表的時間區間選擇（近三月、
近一年、全部）；單張圖表 MUST NOT 各自帶獨立的區間控制項，以維持
「同頁各圖恆為同一區間」的同期對照語意。切換區間 MUST 即時重繪、
毋須重新載入。

預設區間 MUST 依資料新舊自動決定：當前成員全部趨勢序列中最新的
一筆（各序列末筆取最大值）在 `today` 前 90 日內者預設為近一年，
否則預設為全部。

某圖在當前區間內無任何資料時，該圖 MUST 顯示無資料訊息並提供
「看全部」入口；使用該入口 MUST 將**整頁**區間切為全部，
MUST NOT 只切換單張圖表（否則破壞同期對照不變式）。

#### Scenario: 同期對照
- **WHEN** 使用者於趨勢頁選「近一年」
- **THEN** 該頁全部圖表同步改為近一年，各圖 x 軸起訖一致

#### Scenario: 整體陳舊資料的預設區間
- **WHEN** 成員全部趨勢序列的最新一筆距 `today` 超過 90 日
- **THEN** 預設區間為「全部」，圖表有內容可看

#### Scenario: 單一序列在區間內無資料
- **WHEN** 預設為近一年，但某序列最後一筆早於一年前
- **THEN** 該序列的圖顯示無資料訊息與「看全部」入口，其他圖照常顯示
  近一年；點擊該入口後整頁切為「全部」，該圖出現內容


<!-- @trace
source: trend-time-axis
updated: 2026-08-12
code:
  - docs/verification/trend_time_axis_closeout.md
-->

---
### Requirement: 趨勢圖依區間過濾資料點

各圖 MUST 只以落在當前時間域內（含邊界）的資料點繪製；y 軸上下界
MUST 只由這些點（與參考值區間）決定，否則切換區間後縱軸不縮放。
MUST NOT 保留區間外的相鄰點來延續折線（手寫 SVG 無裁切區域，跨界
點會畫出繪圖區）；此為明示選擇。

月粒度序列（如步數的月平均）MUST 以「該月與區間有交集」判定是否
納入，MUST NOT 以桶代表日期是否落在區間內判定，否則區間下界所在
月份的整桶會被丟棄，連帶失去該月落在區間內的資料。此類桶的代表日期
（該月一日）可能早於時間域下界，其 x 座標 MUST 夾在繪圖區內；
MUST NOT 讓資料點畫到繪圖區之外（極端情況會畫出 viewBox 而完全
不可見，並使折線自畫布外進入）。

步數圖的資料粒度 MUST 隨區間變化：近三月用逐日序列，近一年與全部
用月平均，圖說 MUST 標明當前粒度。理由：月粒度在近三月只剩約 3 點。

#### Scenario: 切區間後縱軸跟著縮放
- **WHEN** 由「全部」切到「近三月」
- **THEN** 各圖 y 軸上下界依近三月內的資料重算，非沿用全期範圍

#### Scenario: 下界所在月份的月桶不被丟棄且不出界
- **WHEN** 近一年區間下界為某月中旬，步數該月的月桶代表日期為該月 1 日
- **THEN** 該桶仍納入繪製，且其 x 座標不小於繪圖區左緣

#### Scenario: 步數粒度隨區間
- **WHEN** 切至「近三月」
- **THEN** 步數圖改以逐日序列繪製，圖說標明為逐日


<!-- @trace
source: trend-time-axis
updated: 2026-08-12
code:
  - docs/verification/trend_time_axis_closeout.md
-->

---
### Requirement: 密集序列的標記降級

折線圖 MUST 依序列在當前區間內的點數決定標記呈現：點數不超過
繪圖區可容納 r=3 標記的數量時以 r=3 繪製；超過但仍可容納 r=1.5
標記時以 r=1.5 繪製；再超過時 MUST NOT 繪製標記，僅繪製折線。
門檻 MUST 由標記直徑與繪圖區寬度**在程式中推導**（MUST NOT 硬編碼
數字，否則改動圖表尺寸時門檻不會跟著走），且 MUST 為單一套門檻
（MUST NOT 與其他半徑降級規則並存）。

**沒有區間控制項的圖表（總覽頁的體重趨勢卡）MUST NOT 套用「不繪標記」
那一段門檻**：該處沒有切換區間的手段，可讀性緩解在那裡不存在，使用者
無法把逐點數值提示要回來。其標記半徑仍依點數在 3 與 1.5 之間降級。

序列若顯式指定標記尺寸（如健保成健的獨立標記），MUST 沿用該指定值
而不套用上述門檻，以維持 `dashboard-generator` 對成健單點「以獨立
標記同圖顯示且圖例區分」的既有要求。

三項已知限制 MUST 記載於本 requirement，不得省略：
1. 本 requirement 不含時間桶聚合，折線頂點數不因此減少（效能面）；
   聚合延後至單日多次量測或逐分鐘序列進入資料庫後再評估。
2. **密集序列在「全部」區間下的可讀性由區間選擇承接，不由本
   requirement 解決**：不繪標記只降低節點數，密集序列仍為一條雜訊
   帶，使用者需切換至較短區間才看得清楚。
3. 不繪標記的序列同時失去掛在標記上的逐點數值提示；且門檻以區間內
   點數推導，隱含點在時間上大致均勻，時間集中的序列仍可能重疊。

#### Scenario: 密集序列只畫線
- **WHEN** 某序列在當前區間內的點數超過「不繪標記」門檻
- **THEN** 該序列僅繪製折線、不繪製標記，趨勢形狀維持可讀

#### Scenario: 無區間控制項的圖保留標記
- **WHEN** 總覽頁體重趨勢卡的資料點超過「不繪標記」門檻
- **THEN** 仍繪製標記與逐點數值提示（半徑可降至 1.5）

#### Scenario: 混合序列各自降級
- **WHEN** 體重圖同時含 Apple 每日量測（點數超過門檻）與健保成健（點數遠低於門檻）
- **THEN** Apple 序列僅繪製折線，成健序列繪製獨立標記，兩者以圖例
  區分（符合 dashboard-generator 對此圖的既有要求）

#### Scenario: 稀疏序列保留標記
- **WHEN** 某序列在當前區間內僅 32 點
- **THEN** 逐點繪製標記


<!-- @trace
source: trend-time-axis
updated: 2026-08-12
code:
  - docs/verification/trend_time_axis_closeout.md
-->

---
### Requirement: 趨勢圖日期健全性

繪製前 MUST 剔除日期為 null 或無法解析的資料點，並於圖說標示剔除
筆數；MUST NOT 讓此類點參與時間域計算（`new Date(null)` 為 1970,
單一筆即可把時間域下界拉到 1970 並使整張圖失去意義，且不會拋錯，
屬無聲失敗）。`"YYYY-MM"` 形式的日期 MUST 視為該月第一日。

#### Scenario: null 日期不污染時間域
- **WHEN** 某檢驗序列含一筆 `test_date` 為 null 的紀錄
- **THEN** 該點被剔除、圖說標示剔除 1 筆，時間域下界為其餘資料的
  最早日期而非 1970

#### Scenario: 月粒度日期
- **WHEN** 序列日期為 `"2026-08"` 形式
- **THEN** 該點定位於 2026-08-01

<!-- @trace
source: trend-time-axis
updated: 2026-08-12
code:
  - docs/verification/trend_time_axis_closeout.md
-->

---
### Requirement: 睡眠呼吸分頁

有 CPAP 資料時 MUST 提供獨立分頁，內容為：每晚 AHI（可切換顯示阻塞、
中樞、低通氣分項）、使用時數、漏氣、送氣壓力、睡眠期血氧、**每晚事件數**
與逐筆事件明細。區間選擇 MUST 沿用趨勢頁既有的共用時間域機制，
MUST NOT 自造一套。

**單位或數量級不同的序列 MUST NOT 疊在同一張圖**：圖表只有單一 y 軸，
上下界由全部序列共同決定，數量級小的序列會被壓成貼底的平線。需要對照時
MUST 改用上下堆疊、共用同一時間域的多張圖。

日期語意 MUST 於圖表旁明示為「入睡當晚」。

**每晚事件數 MUST 以每晚各類型的事件計數呈現**，且該序列 MUST NOT 受
逐筆保留範圍影響：它是聚合視角，庫內有事件的每一晚都要畫得出來，資料
累積多年也不會被截斷。

**逐筆事件明細 MUST 分層定位而非平鋪**：以「年 → 晚 → 逐筆」分層，
任一時刻只展開一層路徑，且**未展開的層 MUST NOT 渲染其內容**。平鋪或
「摺疊但仍全部渲染」都會使頁面節點數隨資料量線性增長（逐筆的上限情境
為數千列，每晚一行標頭則隨年數增長）。

#### Scenario: 分項切換
- **WHEN** 使用者切換顯示分項
- **THEN** 阻塞、中樞、低通氣三條序列疊加於 AHI 圖上（同為次數／小時，
  數量級一致）

#### Scenario: 漏氣與壓力分開呈現
- **WHEN** 檢視漏氣與送氣壓力
- **THEN** 兩者為各自獨立、共用同一時間區間的圖表

#### Scenario: 逐筆事件預設不渲染任何明細
- **WHEN** 進入睡眠呼吸分頁而未展開任何年份
- **THEN** 畫面只有年份層（各標明該年的晚數與筆數），沒有每晚標頭也沒有
  任何逐筆列

#### Scenario: 逐層展開
- **WHEN** 展開某一年，再展開該年某一晚
- **THEN** 展開年份時列出該年每一晚但仍無逐筆列；展開某晚後才出現該晚的
  逐筆明細（時刻、類型、持續）

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/cpap_viewer.md
  - docs/verification/viewer_history_refinement.md
-->

---
### Requirement: 沒有 CPAP 資料時不留空區塊

沒有 CPAP 資料的使用者 MUST NOT 看到睡眠呼吸分頁、總覽的 CPAP 卡片，
以及趨勢頁的 AHI 圖。空分頁與空卡片是雜訊，且會讓使用者誤以為功能故障。

有 CPAP 資料但缺少其中某一類（如來源未接血氧模組）時，該區塊 MUST 顯示
原因說明，MUST NOT 呈現一張空的圖表。

#### Scenario: 只有既有來源的資料庫
- **WHEN** 資料庫只有健保或 Apple 資料
- **THEN** 分頁清單、總覽與趨勢頁均無任何 CPAP 相關區塊，既有內容不受影響

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/cpap_viewer.md
-->

---
### Requirement: 趨勢頁的睡眠呼吸對照

趨勢頁 MUST 提供每晚 AHI 圖，與同頁其他圖共用時間域與區間選擇。
CPAP 的日期 MUST 納入共用時間域的計算來源，否則新圖的 x 軸會與同頁其他
圖不一致，資料點被壓到繪圖區邊界。

#### Scenario: 時間域涵蓋 CPAP 日期
- **WHEN** CPAP 資料的起始日期早於其他所有序列
- **THEN** 共用時間域的下界為該日期，x 軸刻度涵蓋該區間

<!-- @trace
source: cpap-sleep-therapy
updated: 2026-08-13
code:
  - docs/verification/cpap_viewer.md
-->

---
### Requirement: 來源清單的摺疊呈現

匯入紀錄的來源清單 MUST 將「同一 adapter 且同一匯入時刻」的多個檔案摺疊
為一列，顯示檔案數並可展開檢視逐檔。多檔來源一次匯入會產生數十列，逐列
呈現會使該區塊失去可讀性。

摺疊 MUST 做在檢視層，payload MUST 保留逐檔紀錄：payload 端摺疊會使匯出
的單檔 HTML 失去逐檔追溯，且分組邏輯需要在兩種語言各自實作並保持一致。

**此分組以 `imported_at` 為鍵的前提是同一批寫入同一個值**，該保證由匯入
端負責（見 `app-import-engine`）。若每筆各自取當下時間，批次大或機器慢
就會跨秒，同一批會被拆成數批而畫面上看不出異常。

檢視層與 App 的匯入紀錄卡各有一份分組實作（前者自包含嵌入單檔 HTML、
不能引用外部模組）。兩份 MUST 以**同一組測試向量**分別斷言，避免規則
各自漂移而沒有任何錯誤訊息。

#### Scenario: 多檔來源的匯入紀錄
- **WHEN** 檢視含多檔來源的匯入紀錄
- **THEN** 該批顯示為一列「N 個檔案」，展開後可見逐檔檔名，統計為該批合計

#### Scenario: 同 adapter 不同匯入時刻
- **WHEN** 同一位成員有兩次多檔匯入，匯入時刻不同
- **THEN** 兩批各自摺疊為一列，MUST NOT 合併為同一批

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/cpap_viewer.md
  - docs/verification/viewer_history_refinement.md
-->

---
### Requirement: 就醫時間軸的年份分層

就醫時間軸 MUST 依年份分層，任一時刻只展開一年，未展開的年份
MUST NOT 渲染其就醫列。就醫筆數隨年份累積，平鋪會使標頭數量線性增長。

從其他分頁跳轉至特定就醫紀錄時，MUST 自動展開該筆所在的年份並捲動至
該筆；否則跳轉目標會落在收起的年份內而使用者看不到任何對應內容。

篩選條件改變後，若原本展開的年份已不在結果中，MUST 退回展開結果中最近
的一年，MUST NOT 呈現全部收起而看似無資料的清單。

#### Scenario: 預設只展開最近一年
- **WHEN** 進入就醫時間軸且資料跨越多個年份
- **THEN** 各年份列出該年筆數，僅最近一年展開，其他年份不渲染就醫列

#### Scenario: 自其他分頁跳轉至舊年份的紀錄
- **WHEN** 於搜尋結果或用藥頁點選一筆屬於較早年份的就醫紀錄
- **THEN** 時間軸開啟時該年份已展開、該筆已展開並捲動至可見位置

#### Scenario: 篩選後原展開年份消失
- **WHEN** 套用類型或院所篩選，使原本展開的年份沒有任何符合的紀錄
- **THEN** 自動展開結果中最近的一年

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/viewer_history_refinement.md
-->
