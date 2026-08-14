# Tasks: 檢視層用語中性化、呼吸事件聚合與匯入紀錄批次摺疊

## 前置條件

工作樹目前有 2026-08-13 實機走查的兩批修復未 commit（dotfile scope 修復、
紀錄頁清單修復，共 9 個檔案）。**apply 前先 commit**，否則本 change 的
diff 會與那批混在一起，六點自審的「diff 全讀」無法分辨範圍。

基準測試數：**215 node ＋ 67 pytest 全綠**。

---

## 組 1：用語中性化

### T1.1 先改註解，否則加詞即測試轉紅

- `app/src/adapters/resmed_edf.js:34` 註解「治療壓力（機器輸出）」→
  「送氣壓力（機器輸出）」。
- 同檔 `:81` 註解「一個『治療夜』自正午起算」→「一個『紀錄夜』自正午
  起算」。
- 順序重要：禁用詞守衛掃描 `app/src` 全部 js 的**檔案內容含註解**
  （`forbidden_guard.test.mjs` walk APP_SRC 讀全文），T1.3 加詞後這兩行
  會直接違規。
- 預期：`cd app && npm test` 仍 215 全綠（此步不改行為）。

### T1.2 兩份 app.js 的 UI 文案

- `app/src/viewer/assets/app.js:675` 與 `src/dashboard/app.js:675`：
  `<h2>治療壓力（95 百分位）</h2>` → `<h2>送氣壓力（95 百分位）</h2>`。
- 兩份的 `:667` note：`日期為入睡當晚（一個治療夜自正午起算）` →
  `日期為入睡當晚（機器以正午為分界劃分一晚）`。
- **MUST 保留「入睡當晚」字樣**：`cpap-therapy` 的「一晚的日期歸屬」
  要求檢視層明示該語意。
- 預期：`npm test` 全綠；`sleep_render.test.mjs` 既有斷言「標注『日期為
  入睡當晚』」仍通過（該斷言只查「入睡當晚」，不含被改掉的詞）。

### T1.2b CHANGELOG 的使用者可見文案

- `CHANGELOG.md`「未發布（開發中）」段的 CPAP 小節有兩處舊詞：
  「使用時數、漏氣、**治療壓力**、血氧與逐次事件表」與「日期以『入睡當晚』
  為準（**一個治療夜**自正午起算…）」。改為「送氣壓力」與「機器以正午為
  分界劃分一晚」。
- CHANGELOG **不在**禁用詞守衛的掃描範圍（守衛掃 `app/src` 與
  `packaging/`），所以漏改不會有任何測試轉紅，必須手動確認。
- 已發布版本段（0.5.0 及更早）**不改**：那是歷史紀錄，當時的介面確實是
  那個字。同理 `docs/verification/` 的既有驗證紀錄不改。
- 預期：`grep -n "治療壓力\|治療夜" CHANGELOG.md` 僅命中已發布段（若有），
  未發布段零命中。

### T1.3 禁用詞入清單（SSOT 在 Python）

- `src/knowledge/forbidden.py` 的清單加 `"治療壓力"`, `"治療夜"`。
- `app/src/knowledge/forbidden.js` 同步加同兩詞、同順序。
- **MUST 用精確詞**，NEVER 加寬成「治療」：`app/src/index.html:41` 與
  `app.js:784` 的免責聲明含「不提供診斷、治療或用藥建議」，加寬會讓
  免責聲明自我違規。
- 預期：`npm test` 全綠（清單同步守衛 ＋ `app/src` 全域掃描零命中）；
  `python3 -m pytest -q` 67 全綠。

### T1.4 組 1 突變驗證

- 突變 a：把 `app.js:675` 改回「治療壓力」→ 預期 `forbidden_guard`
  的全域掃描測試轉紅。
- 突變 b：只改一份 app.js（另一份留舊文案）→ 預期雙份同步守衛轉紅。
- 突變 c：`forbidden.js` 少加一個詞 → 預期清單同步守衛轉紅。
- 三次突變後自備份復原，`grep -c` 確認復原完整。

---

## 組 2：呼吸事件聚合與按晚定位

### T2.1 payload 上限語意改為晚數（D3）

- `app/src/provider/payload.js`：`CPAP_EVENT_LIMIT = 2000`（筆）改為
  `CPAP_EVENT_NIGHTS = 90` 與 `CPAP_EVENT_ROWS_CAP = 8000`。
- 查詢改為：先取最近 90 個有事件的 `session_date`，再取這些晚的全部事件；
  若總筆數超過 8,000，**從最舊的晚整晚剔除**直到不超過。
- payload 新增欄位：`events_nights`（實際帶入的晚數）、
  `events_nights_total`（庫裡有事件的晚數總計）。保留既有
  `events_total`／`events_truncated`。
- `app/src/provider/shape.json` 同步新增兩個欄位的型別。
- 預期：對生產庫副本跑 `buildPayload` 得 `events_nights = 17`、
  `events_nights_total = 17`、`events_truncated = false`（本機只有 17 晚）。

### T2.2 Python 端同步（D1 第一對孿生）

- `src/dashboard/embed.py:45-46` 的 `CPAP_EVENT_LIMIT` 換成同樣兩個常數與
  同樣的查詢語意，並更新「與 payload.js 同值」的註解。
- 預期：`python3 -m pytest -q` 67 全綠；provider parity 測試全綠。

### T2.3 補孿生同步守衛（D1 方案 A）

- 新增測試：解析 `src/dashboard/embed.py` 取出兩個常數值，斷言與
  `payload.js` 的導出常數相同。
- 護欄：先斷言解析到的常數個數為 2，避免解析式失效時假綠（本輪走查已
  踩過一次「解析失效導致斷言恆真」）。
- 預期：測試數 +1 全綠。

### T2.4 檢視層：每晚事件數與按晚摺疊（D4、D6）

- 兩份 app.js 的 `Sleep()`：
  - 新增 `<h2>每晚事件數</h2>` ＋ `LineChart`，四條線（阻塞／中樞／
    低通氣／未分類），資料來自既有但未使用的 `CPAP.event_daily`，
    共用 AHI 分項圖的色票。
  - 逐筆區塊改為：列出有事件的晚（日期＋該晚筆數），每晚一個
    `<details>` 展開該晚完整逐筆（時刻／類型／持續）。移除「最近 300
    筆」平鋪與其上限提示。
  - 上限揭露文案：`events_truncated` 為真時顯示「逐筆僅保留最近
    ${events_nights} 晚；較早的晚仍有每日摘要與每晚事件數」。
- 預期：`sleep_render.test.mjs` 需更新既有「事件明細列出」斷言（改為
  斷言按晚摺疊的結構），測試全綠。

### T2.5 組 2 邊界測試與突變

- 新增測試（fixture 造資料，不用真實素材）：
  - 恰好 90 晚 → 全部帶入，`events_truncated = false`。
  - 91 晚 → 只帶最近 90 晚，**最舊那晚完全不在** payload（不得有半晚）。
  - 每晚 200 筆 × 90 晚 = 18,000 筆 → 觸發 8,000 筆硬上限，且剔除以
    整晚為單位（帶入的晚數 < 90，每一晚都完整）。
  - `event_daily` 為空 → 不畫圖、顯示無逐次紀錄說明。
- 突變 a：晚數上限改回按筆數 `LIMIT` → 預期「不得有半晚」測試轉紅。
- 突變 b：硬上限剔除改為按筆數截斷 → 預期同一測試轉紅。
- 突變 c：`event_daily` 改為不渲染 → 預期每晚事件數測試轉紅。
- **每次突變後確認轉紅的是預期那條**，並自備份復原。

---

## 組 3：匯入紀錄批次摺疊與批次操作

### T3.1 `imported_at` 統一寫入（D2）

- `app/src/engine/store.js` 的 `registerSource()` 新增 `importedAt` 參數，
  寫入 INSERT 欄位；新插入時回傳該值（現況回 `null`）。
- 呼叫端：`resmed_edf.js:327` 在 `importSourceSet()` 開頭算一次時間戳整批
  共用；`apple_health.js:142`、`nhi_json.js:80`（及 nhi_xml 共用路徑）
  各自傳入當下時間。
- `src/store/db.py:87` 的 INSERT 同步加欄位，Python 呼叫端同樣一批一值。
- 預期：JS 與 Python 各匯入同一份多檔素材後，
  `SELECT COUNT(DISTINCT imported_at) FROM source_documents WHERE adapter=?`
  回 **1**；parity 測試全綠。

### T3.2 `groupDocsByBatch` 純函式與一致性守衛（D7）

- `app/src/ui/history.js` 新增導出純函式 `groupDocsByBatch(docs)`：依
  「同 adapter ＋ 同 imported_at」分組，組內維持傳入順序，回傳
  `[{ adapter, importedAt, docs, statsTotal }]`，`statsTotal` 為組內
  `import_stats.inserted` 各表合計。
- 新增守衛測試（D7 方案 A，**共用測試向量**；不可改用「取出 viewer 的
  `groupSources` 直接呼叫」，該函式在 IIFE 內、沙箱外取不到）：
  - helper 定義一組來源列：同批 3 檔、另一批同 adapter 2 檔（不同
    `imported_at`）、單檔批次 1 檔、另一成員 1 檔；並定義期望分組。
  - App 端：餵 `groupDocsByBatch()`，斷言分組數、每組 key 與組內檔名序列。
  - viewer 端：同一組資料放進 payload 的 `meta.sources`，以 vm sandbox
    真渲染（比照 `sleep_render.test.mjs`），斷言表格列數等於分組數、
    展開後可見組內檔名。
- 預期：測試數 +2 全綠。

### T3.3 紀錄頁渲染摺疊

- `history.js` 的 `refresh()` 改用 `groupDocsByBatch`：單檔批次維持原本
  一列；多檔批次主列顯示「N 個檔案」＋批次合計，`<details>` 展開逐檔。
- 主列右側為批次操作按鈕；逐檔列保留既有單檔按鈕（D5）。
- 預期：實機拖入 CPAP 資料夾後，紀錄頁該批顯示為 **1 列「41 個檔案」**，
  展開可見 41 個檔名。

### T3.4 引擎層批次操作（D5 實作形狀）

- `app/src/engine/doc_rescue.js` 新增三個導出：
  `previewBatchRescue(driver, docIds, opts)`、
  `deleteSourceBatch(driver, docIds)`、
  `reattributeSourceBatch(driver, docIds, targetProfileId)`。
- 實作方式：**在單一 transaction 內對每個 docId 套用既有單檔邏輯**並合計
  結果，不另寫一套刪除／搬移邏輯。
- 批次的 docIds 由檢視層算出後傳入；引擎層不重新推導批次。
- 預期：新增測試斷言（a）批次刪除後該批全部消失且各表筆數合計正確；
  （b）**中途失敗全回復**。
- 注入失敗照既有手法（`nondestructive.test.mjs:125-133`）：
  `Object.create(driver)` 覆寫 `execute`，對第 3 次命中
  `DELETE FROM source_documents` 拋「模擬中途故障」，並讓 `transaction`
  以真 driver 執行而把 sabotaged 傳進回呼；斷言 `assert.rejects` 後
  用匯入前快照比對，全部檔案與資料列都還在。

### T3.5 批次確認面板

- `history.js` 的 `buildRescuePreviewModel` 擴充或新增批次版，面板顯示
  「將刪除 41 個來源檔案、睡眠每日摘要 259、呼吸事件 286」（表標籤走
  `RESCUE_TABLE_LABELS`，本輪已補齊 CPAP 三表）。
- 預期：新增純函式測試斷言批次摘要文字與各表合計。

### T3.6 組 3 突變驗證

- 突變 a：`registerSource` 改回不帶 `imported_at` → 預期「批內
  `COUNT(DISTINCT imported_at)` 為 1」測試轉紅。
- 突變 b：`groupDocsByBatch` 的 key 只用 adapter（不含 imported_at）→
  預期與 `groupSources` 的一致性守衛轉紅。
- 突變 c：批次刪除改為逐檔各自 transaction → 預期「中途失敗全回復」
  測試轉紅。
- 三次突變後自備份復原並確認完整。

---

## 收尾

1. 六點 `/code-self-review`（含四對孿生逐對確認）。
2. 實機走查：睡眠呼吸分頁文案與事件互動、紀錄頁摺疊與批次刪除確認面板
   （**確認面板只看不按**，避免動到生產庫的 CPAP 資料）。
3. 寫驗證紀錄 `docs/verification/viewer_history_refinement.md`。
4. specs delta 依實際落地行為撰寫後 `spectra archive`；archive 後**逐一
   補回 `@trace`**（已連三輪被吃掉，archive 前先記下各 spec 的
   requirement／trace 數）。

## Coverage Mapping（G2）

| Decision | 對應 task |
|----------|----------|
| D1 四對孿生同步 | T1.2（第二對）、T1.3（第三對）、T2.2＋T2.3（第一對）、T3.1（第四對）、收尾 1 |
| D2 imported_at 統一寫入 | T3.1、突變 a（T3.6） |
| D3 晚數上限＋筆數硬上限 | T2.1、T2.2、T2.5 |
| D4 每晚一個摺疊小節 | T2.4、T2.5 |
| D5 批次＋單檔並存 | T3.3（介面）、T3.4（引擎） |
| D6 折線圖四條線 | T2.4 |
| D7 groupDocsByBatch ＋ 一致性守衛 | T3.2 |

| Task | 無對應 Decision 的理由 |
|------|----------------------|
| T1.1 | D1 的執行順序約束（守衛掃註解），非獨立決策 |
| T1.4／T2.5／T3.6 | 各組突變驗證，屬驗證策略 |
| T3.5 | D5 的介面落地，沿用既有 `RESCUE_TABLE_LABELS` |

---

## apply 期間新增的 task（原計畫沒有，實際做了）

### T2.6 就醫時間軸依年分組 — 完成

實機回饋提出：逐筆分年之後，就醫時間軸有同樣的問題（筆數隨年份累積、標頭
平鋪）。依年分組、同時只展開一年；`openYear` 初值取自 `focus.enc` 所在年份，
否則最近一年；捲動選擇器排除年份層。篩選後原展開年份消失時退回最近一年。

- 驗證：新增兩條測試（預設只展開最近一年、同時只展開一年且切換可見）。
  `focus.enc` 跳轉那條路徑無法從外部注入，只能實機驗，已於測試註解標明。

### T2.7 逐筆事件改為年 → 晚 → 逐筆三層並延遲渲染 — 完成

實機回饋「感覺拖累速度，多年下來不切實際」。原本每晚一個 `<details>`、摺疊
起來仍全部渲染，上限情境會有 8,000 個 `<tr>`；改為展開才建 DOM，並加年份層
讓常駐節點不隨年數增長。連帶把晚數上限由 90 放寬到 365（畫面不再受晚數影響）。

- 驗證：斷言「預設零逐筆列 → 展開年份列出每晚但仍無逐筆列 → 展開某晚才出現
  明細」；兩層各自突變皆轉紅。

### T3.7 CPAP 救援路徑的三處漏接 — 完成

開工後實測發現 CPAP 的救援功能整個不能用（詳見驗證紀錄）：來源檔刪除與成員
刪除都因外鍵限制失敗、改歸屬把資料留在原成員卻回報「搬移 0 筆」。三處都是
既有 spec 的 MUST 沒被履行。

- `DOC_DATA_TABLES` 與 `PROFILE_DATA_TABLES` 各補 CPAP 三表（後者的三表排在
  `source_documents` 之前）。
- apple 專用迴圈擴為 `KEY_DUP_TABLES` 五表，補三條 `KEY_MATCH`（只比對鍵、
  不比對數值）。
- 新增 `tests/engine/table_coverage.test.mjs` 以 DDL 對帳把清單釘住；三處
  清單各自突變皆轉紅。

### T3.8 走查發現的兩個實機缺陷 — 完成

- 檢視頁判定「這位成員有沒有資料」只查兩張表，只有 CPAP 的成員整頁空白。
  改為沿用 `PROFILE_DATA_TABLES` 逐表 `EXISTS` 短路。
- 藥品品項檔快取的 bundle 分支探測失敗被靜默吞掉，西藥品項全落到「診療項目
  與其他」。改為直接 `copyFile` 到資料目錄，失敗時寫入 console。
- 兩者都依賴 Tauri、無自動化測試，已實機確認。
- 另在匯入頁標出版號與執行來源（開發版／本機建置）：安裝版與 dev 版共用同一
  資料目錄且版號相同，開錯版本時症狀像功能故障。

---

## Requirement ↔ Task 對照（archive 前的 coverage 檢查）

| Spec / Requirement | 對應 task |
|---|---|
| `cpap-therapy` 一晚的日期歸屬（原「治療夜的日期歸屬」） | T1.1、T1.2、T1.2b |
| `cpap-therapy` 只顯示不解讀 | T1.3、T1.4 |
| `cpap-therapy` 已知限制的揭露 | T2.1（上限語意）、T2.4（揭露文案） |
| `app-viewer` 睡眠呼吸分頁 | T2.4、T2.5、T2.7 |
| `app-viewer` 來源清單的摺疊呈現 | T3.1（`imported_at` 前提）、T3.2（共用向量） |
| `app-viewer` 就醫時間軸的年份分層 | T2.6 |
| `app-import-gui` 匯入紀錄卡的批次摺疊與批次救援 | T3.3、T3.4、T3.5、T3.6 |
| `app-import-engine` 多檔來源的原子性與逐檔韌性 | T3.1 |
| `profile-management` 成員刪除 | T3.7 |
| `profile-management` 匯入紀錄刪除 | T3.4、T3.7 |
| `profile-management` 匯入紀錄改歸屬 | T3.4、T3.7 |

## 完成狀態

組 1、組 2、組 3 與上述四個新增 task 全部完成，分別在這些 commit：
`874630d`（組 1）、`d6deec6`（組 2）、`1d25b29`（組 3 含 T3.7）、
`051bc56`（T3.8）、`a6f9d39`（T2.6／T2.7 與 365 晚）。

測試 215 → **245 node**，pytest 67 全綠。驗證紀錄：
`docs/verification/viewer_history_refinement.md`。

**尚未驗**：走查第 4 項（第二次拖入同一張卡顯示全部已匯入）——清空資料庫
重走一輪後還沒測到這項。
