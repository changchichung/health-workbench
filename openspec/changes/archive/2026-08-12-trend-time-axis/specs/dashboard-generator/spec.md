# dashboard-generator — 趨勢圖時間軸語意

同一份前端資產（`app/src/viewer/assets/app.js` 與
`src/dashboard/app.js` 逐位元組相同）同時是 App 檢視器與 Python
`mhb rebuild` 產出的單檔 dashboard 前端，故趨勢圖行為的變更同時
屬於本 capability。

## MODIFIED Requirements

### Requirement: 四件套視圖
dashboard SHALL 提供：(1) 總覽 tiles（各類筆數、資料期間、最近事件）；
(2) 就醫時間軸——依日期列出事件、可依類型/院所篩選、點入顯示該次
診斷與用藥明細及來源檔名；(3) 用藥清單——同健保代碼分組、顯示
處方日期/天數/院所、連結仿單查詢；(4) 趨勢圖——檢驗依正規化名分組
（顯示參考值）、身體數值將 Apple 量測與健保成健紀錄同圖呈現。
所有圖表 SHALL 支援深淺色並符合無障礙色彩驗證。

趨勢圖的 x 軸 SHALL 以時間比例定位（同頁共用時間域，上界為該檔的
`generated_at` 與其資料最新日期的較大者），SHALL NOT 依資料點序位
等距排列；趨勢頁 SHALL 提供作用於全頁的時間區間選擇。詳細行為由
`app-viewer` 的「趨勢圖以共用時間域定位」、「趨勢頁時間區間選擇」、
「趨勢圖依區間過濾資料點」、「密集序列的標記降級」與「趨勢圖日期
健全性」五個 requirements 定義，兩處 SHALL 一致。

#### Scenario: 時間軸點入明細
- **WHEN** 點擊時間軸上任一西醫門診事件
- **THEN** 顯示該次主診斷、醫囑用藥清單與來源（檔名＋節區）

#### Scenario: 成健與自主量測印證
- **WHEN** 開啟體重趨勢
- **THEN** Apple 連續量測為折線、健保成健單點以獨立標記同圖顯示且圖例區分

#### Scenario: rebuild 產出與 App 一致
- **WHEN** 以 `mhb rebuild` 產出單檔並以瀏覽器開啟趨勢頁
- **THEN** 時間軸定位、區間選擇與標記降級行為與 App 內完全一致

