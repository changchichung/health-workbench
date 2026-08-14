# Tasks: CPAP 睡眠呼吸資料匯入（Phase 1）

精簡版（2026-08-12 裁示）：門控強度對準風險。**只有第 1 組是高風險**
（生產庫百 MB 量級遷移，失敗代價是資料庫打不開），其驗證不放鬆；其餘各組
錯了看得見改得快，由既有 153 測試＋schema parity＋before/after dump diff
接住。specs delta 延到 apply 完成後依實際落地行為撰寫（archive 前的
ingest 步驟）。

順序原則：地基（schema）→ 純函式（可單測、無 UI 依賴）→ adapter →
GUI／UI → 文案與文件。

---

## 1. schema 3→4 與遷移護欄（高風險，驗證不放鬆）

- [x] 1.1 `app/src/store/schema.js`：`SCHEMA_VERSION` 3→4；DDL 加
  `cpap_daily`／`cpap_events`／`cpap_oximetry` 三表與三個索引（逐字照
  design D3）；`MIGRATIONS[3]` 加同樣的 `CREATE TABLE`／`CREATE INDEX`
  語句。
- [x] 1.2 `src/store/schema.py`：逐字同步 DDL 與 MIGRATIONS。
  驗證：`node --test tests/store/schema_parity.test.mjs` 通過（兩邊空庫
  正規化 dump 全等）。
- [x] 1.3 `initSchema` 遷移迴圈移入 `driver.transaction`：版本註記與 DDL
  同進同出。`NoMigrationPath`／`SchemaTooNew` 訊息不變。
- [x] 1.4 遷移前 v3 快照：用既有 `exportDbSnapshot`（`VACUUM INTO`），
  **不可用 `fs.copyFile`**（design D8 理由）；檔名
  `mhb-premigrate-v3-YYYYMMDD.sqlite`，`fs.exists` 預檢同名時附序號；
  僅在既有版本低於程式版本時做；快照失敗中止遷移並明確告知。
- [x] 1.5 遷移測試（新檔 `app/tests/store/migration_v4.test.mjs`）：
  (a) v3 合成庫（各表若干列）升級後版本為 4、三表存在、**既有各表逐位元組
  不變**（before/after 排序 dump diff）；(b) 遷移中途拋錯時全庫回滾至 v3
  且三表不存在；(c) 全新庫直接建到 v4 且不產生快照。
- [x] 1.6 **真庫前的最後防線**：對生產庫的唯讀副本實跑一次 1.1-1.4 的
  升級，記錄升級前後各表筆數全等與新表為空，確認後才允許碰真庫。
  結論記入 `docs/verification/`（只寫結構性結論與是否相符）。

## 2. EDF 解析純函式與合成 fixture

- [x] 2.1 `app/src/adapters/edf.js`：`parseHeader(bytes)`（256＋ns×256）、
  `scaleValue(dig, sig)`（`phys = physmin + (dig−digmin)×(physmax−physmin)/(digmax−digmin)`）、
  `isSentinel(dig, sig)`（`dig < digmin`）、`parseTAL(bytes)`（EDF+D
  annotation）。標籤比對用截斷後字串（label 欄位 16 字元）。
- [x] 2.2 `app/tests/helpers/make_edf.mjs`：合成 EDF 產生器（純 JS 寫
  位元組），支援指定訊號、`dur`、`nsamp`、逐 record 的 dig 值與哨兵。
- [x] 2.3 `app/tests/adapters/edf_parse.test.mjs`：design D11 表列的
  fixture 情境全部覆蓋（縮放反推、逐欄哨兵、標籤截斷、跨午夜換算
  `Mask On=600`→22:00、五類事件含未分類 `Apnea`、不足 60 樣本尾桶、
  全哨兵分鐘不建列、多段 session）。全部為已知輸入對已知輸出的數值斷言。

## 3. ResMed adapter

- [x] 3.1 `app/src/adapters/resmed_edf.js`：`importSourceSet`（單一交易）、
  `detect`（EDF 判型）、`ADAPTER_VERSION`。`device` 取
  `Identification.tgt` 的 `#PNA`，讀不到回退 adapter id 並標
  `device_unknown`；序號不入庫。
  **讀檔大小上限在此實施**（`edf.js` 收到的已是位元組陣列，那時記憶體已耗，
  檢查只是形式）：逐檔讀入前先看 `source.size`，超過上限即跳過該檔並記
  品質旗標，記憶體峰值才不隨輸入成長（`app-import-engine` 的「大檔門檻」
  在多檔情境下的對應做法）。
- [x] 3.2 STR 每日摘要寫入：`summary_date` 取 record 起始日（正午邊界，
  design D4）；未使用日整筆跳過並計入 `skipped_unused`；逐欄哨兵存 NULL；
  `Mask On/Off` 10 槽位依 D3 存首段起／末段止／段數／`extra_json.segments`／
  `multi_session` 旗標。
- [x] 3.3 EVE 事件寫入：五類標籤，`Recording starts` 不入庫；
  `start_ts` 由檔頭時間加 TAL onset。
- [x] 3.4 SAD 逐分鐘聚合：一 record 一桶（`dur=60`／`nsamp=60`），
  `spo2_min`／`spo2_mean`／`pulse_mean`／`pulse_max`／`sample_count`，
  哨兵樣本不計入且整桶哨兵不建列；`dur≠60` 時依實際取樣率改切 60 秒桶。
- [x] 3.5 `source_documents` 每檔一列（design D2）；未解析的檔
  （`.crc`／`SETTINGS`／`PLD`／`BRP`）不建列；`finalizeImport` 對 STR 那列
  寫整批合計、DATALOG 各列寫自身筆數。
  驗證：重複匯入同一批零新增且既有列逐位元組不變；部分新檔只處理新檔。

## 4. registry 與 GUI 多檔

- [x] 4.1 `registry.js`：加 `detectSet(entries)`；`register` 介面檢查放寬為
  `importSource`／`importSourceSet` 至少一個。既有三 adapter 不改。
- [x] 4.2 `import_flow.js` 的 `offerFile`：資料夾先 `detectSet`（含 DATALOG
  一層、STR.edf 讀前 8KB），無結果才回退 `resolveAppleDirTauri`；兩者皆無
  時列出支援格式。**Apple 單檔與資料夾路徑行為一位元組不變**。
- [x] 4.3 確認面板檔名列改 `<資料夾名>（N 個檔案，合計 M MB）`；報告卡在
  `r.source.files` 存在時顯示批次名與檔數＋`<details>` 逐檔明細；整批重複
  顯示「N 個檔案先前都已匯入」，部分重複顯示「N 中 M 個是新的」。
  單檔呈現不變。
- [x] 4.4 進度：`totalBytes` 為整批合計、`readBytes` 跨檔累加，整批單調遞增。

## 5. payload 與檢視層

- [x] 5.1 `payload.js`：`meta.sources` 依 adapter＋`imported_at` 摺疊多檔為
  一列（`<rootName>（N 個檔案）`＋合計 `import_stats`），逐檔明細不進
  payload；新增 `cpap` 區塊（每日摘要序列、事件、逐分鐘血氧）。
- [x] 5.2 `trendBounds()` 的 `groups` 加入 CPAP 日期序列（否則新圖時間域
  與其他圖不一致）。
- [x] 5.3 新增「睡眠呼吸」分頁（`TABS` 五項）：AHI 與分項、使用時數、
  漏氣與治療壓力、睡眠期血氧、事件明細表；區間選擇沿用既有機制；
  圖下標注來源與「日期為入睡當晚」。
- [x] 5.4 趨勢頁插入每日 AHI 圖（堆疊共用 `domain`，不改 `LineChart`）；
  總覽新增一張卡（最近 AHI 與使用時數＋該筆日期）。
- [x] 5.5 同步 `src/dashboard/app.js`（既有雙份 app.js 慣例）。
  驗證：既有 viewer 渲染測試全綠；未匯入 CPAP 的庫不出現空白區塊。

## 6. 文案、文件與收尾

- [x] 6.1 新增文案納入禁用詞守衛掃描；AHI 等指標只顯示不解讀。
- [ ] 6.5 既有小缺陷（第 4 組 diff 全讀發現，非本輪引入）：`say()` 以
  `textContent` 呈現，但呼叫端傳的是已 `escapeHtml` 的字串，含 & 或 < 的
  檔名會顯示成 `&amp;`。兩處（單檔與資料夾未識別訊息）行為一致，修時一起改。
- [x] 6.2 README 產品定位含 CPAP（現為「健保存摺＋Apple 健康」）、倉庫
  描述同步、CHANGELOG。**依 design D12：不寫指向特定個人的健康敘述。**
- [x] 6.3 匯出單檔 HTML 涵蓋新區塊。
- [ ] 6.4 QA 收尾＋specs delta 撰寫（依實際落地行為）＋archive。
  archive 前記下各 spec 的 requirement／trace 數，archive 後補回
  （`spectra archive` 會吃掉 `@trace`，已連兩輪踩到）。
