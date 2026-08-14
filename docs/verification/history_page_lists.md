# 驗收紀錄：紀錄頁的三處清單都漏了 CPAP（2026-08-13 實機走查）

## 現象

CPAP 匯入成功後，「資料庫與匯入紀錄」頁看起來很亂。追下去發現不只是版面
問題，`history.js` 有三處清單在新增 CPAP 能力時全部沒跟上：

| 清單 | 缺什麼 | 畫面上的後果 |
|------|--------|-------------|
| `refresh()` 內的 counts 硬編清單 | **六張表**：CPAP 三表、`apple_workouts`、`body_measurements`、`cancer_screenings` | 「全部資料」那行少算五張有資料的表（其中 `cpap_daily` 259、`cpap_events` 286、`apple_workouts` 191、`cancer_screenings` 2、`body_measurements` 1） |
| `ADAPTER_LABELS` | `resmed_edf` | 格式欄顯示原始 id `resmed_edf` 而非中文 |
| `RESCUE_TABLE_LABELS` | CPAP 三表 | 刪除／改歸屬的確認面板會顯示原始表名 |

三者疊起來的效果：畫面列出 41 個 CPAP 來源檔（格式欄還是英文 id），而
「全部資料」那行一筆 CPAP 都沒算。缺存在感會放大雜亂感。

上一輪的交接文件記過「表清單在四處各有一份，本輪四處都補了 CPAP 三表」
（`ALL_TABLES`、Python `table_counts`、`payload.js TABLES`、
`store.js tableCounts`）。紀錄頁這處是**第五處**，當時沒被算進去。

## 修法

- `ADAPTER_LABELS` 補 `resmed_edf`，`RESCUE_TABLE_LABELS` 補 CPAP 三表。
- counts 的硬編清單抽成導出常數 `COUNT_TABLES`（只列表名），標籤改查
  `RESCUE_TABLE_LABELS`，不再多養一份標籤對照。抽成導出的另一個目的是
  讓它可被測試對帳：原本埋在依賴 DOM 的 `refresh()` 裡，測不到。
- `COUNT_TABLES` 補齊全部十二張資料表。

副作用（使用者可見）：「全部資料」那行的 `apple_records` 標籤由
「Apple 健康」變成「Apple 紀錄」。「Apple 健康」是 adapter 名，該行列的
是表筆數，所以新的措辭更精確。

## 驗證證據

補值本身不能防再犯（這次就是四處補了、第五處沒補），所以把「清單要跟上
schema 與 registry」變成機器可驗，新增兩條對帳測試（210 → 213 → **215**）：

| 測試 | 斷言 |
|------|------|
| 全部資料統計：涵蓋 DDL 的每一張資料表，且都有中文標籤 | 從 `DDL` 解析 `CREATE TABLE`，扣掉三張元資料表後，每一張都必須在 `COUNT_TABLES`；`COUNT_TABLES` 每項都必須有標籤；且不得列出 `DDL` 沒有的表（count 查詢會拋錯） |
| 格式標籤：涵蓋 registry 註冊的每個 adapter | `registry.list()` 的每個 id 都必須在 `ADAPTER_LABELS` |

第一條測試內含一道**防假綠護欄**：先斷言 `DDL` 至少解析出 15 張表。少了
這道，未來若 `CREATE TABLE` 的寫法變動導致解析式失效，`ddlTables` 會是
空陣列，後面三條 filter 全部回空陣列，測試會通過而什麼都沒驗到。

突變驗證三次（自備份復原）：

| 突變 | 結果 |
|------|------|
| `COUNT_TABLES` 移除 `cpap_daily` | 第一條轉紅 |
| `ADAPTER_LABELS` 移除 `resmed_edf` | 第二條轉紅 |
| `RESCUE_TABLE_LABELS` 移除 CPAP 三表標籤 | 第一條轉紅（標籤斷言） |

測試總數 **215 node ＋ 67 pytest 全綠**。

## 安全檢查

`SELECT count(*) c FROM ${t}` 是字串插值，但 `t` 只來自 `COUNT_TABLES`
這個模組常數，沒有使用者輸入的路徑；對帳測試另外斷言了
`COUNT_TABLES ⊆ DDL 表名`。與 `store.js` 的 `FP_TABLES` 同模式（那邊
使用時另有 `includes` 白名單檢查）。抽成導出常數理論上多了被其他模組
mutate 的面，但這是本地前端 app，沒有外部輸入到得了這裡。

## 未處理

版面本身沒動：41 列仍然平鋪。批次摺疊（同 adapter ＋ 同 `imported_at`
視為一批，主列顯示批次摘要、展開看逐檔，且刪除／改歸屬對整批生效）需要
動到 `doc_rescue` 的批次路徑與確認面板，範圍超出缺陷修復，另開變更處理。
