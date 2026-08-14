# 驗收紀錄：CPAP 匯入紀錄的批次新增筆數重複計算（2026-08-14）

change `viewer-and-history-refinement` archive 後的 QA 稽核發現，屬跨 change
的假設繼承缺陷。資料層一直正確，錯的是顯示的數字。

## 現象

匯入紀錄（資料管理分頁）把同一批的多個來源檔摺疊成一列，該列顯示的
「新增 N 筆」是實際筆數的近兩倍。展開批次看逐檔時，`STR.edf` 那一行也掛著
它自己並沒有插入的呼吸事件數。

實測（合成素材，1 個 STR ＋ 2 個 EVE ＋ 1 個 SAD）：

| | 修復前 | 修復後 | 資料庫實際 |
|---|---|---|---|
| 批次列顯示 | 新增 10 筆 | 新增 6 筆 | 6 筆 |
| `cpap_events` | 6 | 3 | 3 |
| `cpap_oximetry` | 2 | 1 | 1 |
| `cpap_daily` | 2 | 2 | 2 |

`cpap_daily` 不受影響：每日摘要只由 `STR.edf` 產生，那一列被整批合計覆蓋後
數值恰好相同。一張記錄卡的檔案數是數十的量級，每個 DATALOG 檔的事件都被算
兩次，所以實機批次的顯示值接近實際的兩倍。

## 根因：兩個 change 各自自洽的決定疊在一起

`cpap-sleep-therapy` 的 design D2 在同一節裡定了兩件事：

- 「摺疊做在檢視層。同一 adapter 且同一 `imported_at` 的多筆併為一行」
- 「`finalizeImport` 只對 **STR.edf 那一列**寫整批合計的 `import_stats`；
  DATALOG 各列的 `import_stats` 寫該檔自身的筆數」

兩點相隔十行，中間沒有任何一句處理「摺疊時這些列要相加，而其中一列已經是
合計」。`viewer-and-history-refinement` 實作摺疊時只寫「stats 取組內各檔的
合計」，沿用了「每列＝該檔自身」的假設，沒有回頭驗證前一輪的另一個決定。

## 為什麼三層檢視都沒有攔下

**測試**：共用測試向量 `tests/helpers/batch_vector.mjs` 把走查得到的事件
總數填進 STR 列，但那個數字本來就是**整批合計**，向量卻當成 STR 自身的統計，
另外又編了兩個 EVE 檔的筆數，期望值因此寫成「合計＋各檔」。
**雙重計算被固化成正確答案**，
兩份實作（App 端 `groupDocsByBatch` 與檢視層 `groupSources`）都照著錯的答案
通過。孿生守衛在此完全失效：兩份實作一致，錯的是餵給它們的資料形狀。

佐證：修復前把寫入端的行為整個改掉，245 條測試沒有任何一條轉紅。

**實機走查**：批次列只顯示加總後的「新增 N 筆」，沒有分表。同一張卡上方的
「全部資料」行是真實 count，兩個數字同框但沒有對照的理由，肉眼無從判斷。
走查表那一列記的是「批次摺疊：通過」，驗的是摺疊有沒有成形。

**G1／G3**：審查對象是本輪的 delta 與 tasks，`import_stats` 的寫入語意屬於
上一輪已 archive 的 spec，不在 diff 範圍內。跨 change 的假設繼承目前沒有
任何機制檢查。

## 修法

`resmed_edf.js`：每一列的 `import_stats` 只記該檔自己插入與略過了什麼。
未使用日的計數（`cpap_daily_unused`）改為在解析 `STR.edf` 的當下寫進該檔
自己那列。整批合計仍然算，但只餵給 `buildIncremental` 產生匯入當下的報告卡，
不再寫進任何 `source_documents` 列。

被移除的 `strDocId` 原本承擔「整批合計只寫本次新建的列」這個約束；逐檔寫入
在重複檔 `continue` 之後，天然只寫入本次新建的列，`app-import-engine`
「匯入不破壞既有資料」的白名單仍然滿足（突變 A 反向證實了這點，見下）。

## 驗證證據

**新增測試** `tests/adapters/resmed_import.test.mjs`「批次統計對帳」：用真實
匯入路徑產生統計，餵給上線那份 `groupDocsByBatch`，斷言批次合計逐表等於
資料庫實際筆數，並斷言 STR 那列不含事件或血氧、未使用日落在 STR 自己那列。
不再依賴人造的統計形狀。

**突變驗證**（兩次，皆轉紅且該條在第一位）：

| 突變 | 結果 |
|---|---|
| A：還原舊行為，迴圈後把整批合計寫回 STR 那列 | 對帳測試轉紅；另連帶打紅「部分新檔」（該寫法會覆寫既有列，反向印證了白名單約束） |
| B：未使用日不寫進 STR 自己那列 | 對帳測試轉紅（`dupTotal` 斷言） |
| C：只改 JS 的日期範圍、Python 不動 | 四條 parity 轉紅（證實兩端同構確實有守衛，不是靠人工比對） |
| D：`QUALITY_FLAG_TABLES` 漏掉 `cpap_daily` | 新增的欄位對帳測試轉紅 |

**測試向量修正**：批 A 改為 STR 只帶每日摘要與 unused 計數，事件分散在兩個
EVE 檔，期望值＝兩者相加。數值一律改用合成的圓整數（原本抄自真實庫），向量
檔頭加上形狀的硬約束與「不得抄真實資料量」的說明。

**測試總數** 245 → 248（本項 1 條、欄位對帳 2 條），pytest 67 不變，全綠。
parity 四條「報告全等」有實際執行（`skipped 0`），涵蓋改動後的兩端報告結構。

**真實庫複驗**：刪除整批後以修復版重新匯入，再用上線那份 `groupDocsByBatch`
對該批各列相加，與三張表的 `count(*)` 逐表比對，結果相符，且沒有任何一列
殘留舊的合計格式。（本文件不記錄該庫的實際筆數：repo 公開，CPAP 的使用天數
與事件數合起來是可辨識的個人健康資訊。）

## 同一輪一起修的三項

同一次 QA 稽核找出的另外三項，成因都是「以清單列舉」而清單沒跟上 schema。

### 品質旗標統計漏四張表

`qualityFlagCounts()` 掃的是 `FP_TABLES ＋ medications ＋ apple_records`，
而帶 `quality_flags` 欄位的表其實有 12 張。漏的是 CPAP 三表與
`apple_workouts`。後果不是「少一個功能」，是**匯入完成卡顯示「品質旗標：
無」**，讀起來像這批資料很乾淨。實測：`cpap_daily` 寫入 `multi_session`
後，統計回傳的物件裡沒有它。

修法：`store.js` 新增 `QUALITY_FLAG_TABLES`（Python `schema.py` 同步），
並在 `table_coverage.test.mjs` 以**欄位**對帳：從 DDL 解析出每個帶
`quality_flags` 欄位的建表語句，斷言都在清單裡，且清單不含沒有該欄位的表
（那會讓查詢直接拋錯）。兩條測試各有解析式失效的護欄（表數與帶旗標表數的
下限），避免解析式壞掉時全部假綠。

### 品質報告的日期範圍漏 CPAP 三表

同一份報告的 `date_ranges` 只列五張表。三張 CPAP 表的日期欄位名各不相同
（`summary_date`／`session_date`），無法像上面那樣用 DDL 自動對帳，改為
抽出 `DATE_RANGE_COLUMNS` 常數並在兩端註記「新增有日期的資料表時 MUST
手動評估」。

### 檔案權限收斂

`capabilities/default.json` 對 `fs:allow-write-text-file` 額外開放
`/private/tmp/**` 與 `/tmp/**`，並有一整條只為 `/tmp` 而存在的
`fs:allow-remove`。全 repo 沒有任何 `fs.remove` 呼叫，`writeTextFile` 的兩個
呼叫端一個寫 `$APPDATA`、一個寫儲存對話框選定的路徑。兩者都不需要這些授權，
已移除。

匯出路徑不受影響的依據（實地查證，不是推測）：
`tauri-plugin-dialog-2.7.2/src/commands.rs:252` 的 save 命令在使用者選定後
呼叫 `allow_file(&path)`，把該路徑動態加進 fs scope。這也推翻了稽核初期
「匯出 HTML 必然被 scope 擋下」的假設。

`fs:default` 只授予 app 專屬目錄的讀取與 mkdir（查 tauri-plugin-fs 的
`permissions/default.toml`），不會把移除的授權補回來。

**此項無自動化測試**：注入式測試對宿主權限層結構性地盲（見
`cpap_dotfile_scope_fix.md`）。MUST 實機驗證匯出 HTML、匯出資料庫檔、
變更設定三條路徑。

### spec 同步

`health-database` 的「匯入統計記錄」requirement 原本只約束「整批合計 MUST
只寫入本次新建的列」，字面上預設了「有某一列裝合計」。已改為明確要求每一列
只記該檔自身，並新增 scenario「多檔批次的統計相加等於實際筆數」。

## 已知限制

- 修復只改寫入端。既有資料庫裡先前匯入的 CPAP 批次，其 `STR.edf` 列仍存著
  舊的整批合計，那些批次的顯示數字**不會**因為這次修復而變正確。已於
  2026-08-14 以「刪除整批後重新匯入」處理，重匯後對帳相符。
- 對帳測試綁定 ResMed 這一個多檔 adapter。未來新增其他多檔來源時，同樣的
  不變量沒有自動守衛，需要各自補一條對帳測試。
- Python 端沒有 CPAP adapter，不涉及本次修復。
