# Proposal: 檢視層用語中性化、呼吸事件聚合與匯入紀錄批次摺疊

## Why

2026-08-13 的 macOS 實機走查在功能通過後暴露了三件事，都不是缺陷而是
「量大之後會壞」或「措辭承擔了不該承擔的意思」：

**一、睡眠呼吸分頁的用語帶了治療語氣。** 分頁上有「治療壓力」標題與
「一個治療夜自正午起算」的說明。這兩個詞是 CPAP 領域慣用語，但呈現給
使用者時，「治療」二字讓一張只是把機器數字畫成折線的圖看起來像在評估
治療成效。既有的 `cpap-therapy` spec 已要求「只顯示不解讀」且「既有的
非結論式用語守衛 MUST 涵蓋本 capability 的新增文案」，這兩個詞當時沒被
納入守衛清單。

**二、呼吸事件逐筆表格在資料量成長後會失去意義，而且會靜默失真。**
現況 payload 帶最近 2000 筆、表格顯示最近 300 筆，兩個上限都**按筆數**
切。實測本機資料：只有少數晚有逐筆事件，因為 SD 卡的
`DATALOG` 只保留最近約 20 天的逐日檔，`STR.edf` 才累積長期摘要。逐筆
事件因此是「最近約 20 天」的滑動視窗，長期靠每次插卡累積，成長速率取決
於插卡頻率而非時間；以本機密度（有事件的晚平均 十餘筆、最多 59 筆）每月
插一次卡的年增量是千筆量級，AHI 較高的使用者是好幾倍。

按筆數切的後果不只是「表格太長」：2000 筆的邊界會落在某一晚的中間，那晚
只剩一半事件，而畫面上沒有任何跡象顯示被截斷。同時，payload 裡早就算好
了 `event_daily`（每晚 × 事件類型的計數，2.7 KB／49 筆）卻**完全沒有被
UI 使用**，而它是唯一不受任何上限影響、資料量再大都畫得完的視角。

**三、App 的匯入紀錄頁被單一批次淹沒。** 一次 CPAP 匯入產生 41 列
`source_documents`（每檔一列，是 `sha256` 去重的基礎，資料層不能改），
而 Apple 匯入只有 1 列。檢視分頁與匯出的單檔 HTML 已經有摺疊
（`groupSources`，見 `app-viewer` 的「來源清單的摺疊呈現」），但 App 的
「資料庫與匯入紀錄」卡是另一套介面、另一份程式，沒有對應處理。

摺疊之外還有操作語意問題：逐檔刪除一個 `20230612_EVE.edf` 沒有實際意義
（那是一晚的事件片段），有意義的是整批刪除或整批改歸屬。

### 一個藏在底下的既有缺陷

上述第三件事在調查時翻出：批次的識別依據「同 adapter ＋ 同 `imported_at`」
**目前不可靠**。`store.js` 的 INSERT 不帶 `imported_at`，走 schema 預設
`datetime('now')`，**每列各自取當下時間**。本次 41 列同為 `02:50:12` 只因
插入夠快；批次一大或機器一慢就會跨秒，同一批被切成數批。

這不只影響待開發的 App 端摺疊——**檢視層既有的 `groupSources` 用的正是
同一個 key**，所以它是既有功能的潛在缺陷，只是還沒暴露。

## What Changes

三組，共用同一批孿生同步紀律（見 design D1）。

### 組 1：用語中性化

- 睡眠呼吸分頁的「治療壓力（95 百分位）」改為「**送氣壓力（95 百分位）**」。
- 「一個治療夜自正午起算」改為描述機器行為的措辭，且 MUST 保留
  「入睡當晚」字樣（`cpap-therapy` spec 既有要求）。
- 「治療壓力」「治療夜」加入非結論式用語守衛清單（SSOT 在
  `src/knowledge/forbidden.py`）。加詞 MUST 用精確詞而非「治療」二字：
  免責聲明本身含「不提供診斷、治療或用藥建議」，加寬會自我違規。
- 守衛掃描 `app/src` 全部 js/html/json 的**檔案內容含註解**，因此
  `resmed_edf.js` 的兩處註解必須先改，否則加詞即測試轉紅。
- spec 與註解的術語一併改為「紀錄夜」，`cpap-therapy` 的 requirement
  標題「治療夜的日期歸屬」改為「一晚的日期歸屬」。理由：留著舊詞在 spec
  裡，未來會有人照 spec 把它寫回 UI，而守衛只擋 `app/src`。

### 組 2：呼吸事件改為聚合為主、逐筆按晚定位

- 新增「每晚事件數」呈現，資料來源為既有但未使用的 `event_daily`。
- 逐筆事件不再平鋪最近 N 筆，改為**按晚定位**：預設收起，展開後以一晚
  為單位檢視該晚的完整逐筆。
- `CPAP_EVENT_LIMIT` 的語意從「最近 N **筆**」改為「最近 N **晚**的完整
  逐筆」。任一晚要嘛完整、要嘛不在 payload，不再有半晚資料。
- 上限與其影響 MUST 在使用者可見處揭露（`cpap-therapy` 的「已知限制的
  揭露」要求）。

### 組 3：匯入紀錄批次摺疊與批次操作

- 匯入時**統一寫入 `imported_at`**（整批共用同一時間戳），讓「同 adapter
  ＋同 imported_at」成為可靠的批次判定。既有 43 列剛好已同值，不需回填。
- App 的匯入紀錄卡將同批摺疊為一列（批次摘要＋可展開逐檔），與檢視層
  既有的 `groupSources` 語意一致。
- 刪除／改歸屬對**整批**生效，確認面板列出影響範圍（檔案數與各表筆數）。
  逐檔操作保留與否見 design D5。

## Impact

### 影響的 specs

| spec | 動作 | 內容 |
|------|------|------|
| `cpap-therapy` | MODIFIED | 「治療夜的日期歸屬」→「一晚的日期歸屬」（術語與標題）；「只顯示不解讀」補守衛新增詞；「已知限制的揭露」補逐筆事件的晚數上限 |
| `app-viewer` | MODIFIED | 「睡眠呼吸分頁」補每晚事件數與逐筆按晚定位；「來源清單的摺疊呈現」補批次 key 的可靠性前提 |
| `app-import-gui` | ADDED | App 匯入紀錄卡的批次摺疊與批次操作 |
| `app-import-engine` | MODIFIED | 多檔來源匯入 MUST 對整批寫入同一 `imported_at` |
| `health-database` | MODIFIED | 「來源追溯」補 `imported_at` 的批次語意 |

### 影響的程式

**四對**孿生實作都要同步（design D1）：`payload.js` ↔ `embed.py`（事件
上限語意）、`app/src/viewer/assets/app.js` ↔ `src/dashboard/app.js`（用語
與事件呈現）、`forbidden.js` ↔ `forbidden.py`（禁用詞清單）、
`app/src/engine/store.js` ↔ `src/store/db.py`（`imported_at` 統一寫入，
CLI 匯入路徑同樣要改，否則 CLI 匯入的批次在 App 裡摺疊行為不同）。

App 端 `history.js` 與 `doc_rescue.js` 只在 App 側，無孿生。

### 不影響

- 資料庫 schema 不變（不做 v5 遷移）。`source_documents` 每檔一列的設計
  不動，`sha256` 去重行為不變。
- `cpap_events` 表的內容不變：改的只是檢視層帶多少、怎麼顯示。庫裡的
  逐筆事件一直都在。
- AHI 圖與分項圖（阻塞／中樞／低通氣）不動。

---

## 審查修正（G1，2026-08-13）

Self-Review 六項逐項執行，兩項 FAIL 後修正：

| 項 | 判定 | 說明 |
|----|------|------|
| S1 Placeholder | PASS | 三份文件掃 TBD／TODO／待定／「similar to Task N」零命中 |
| S2 內部一致性 | **FAIL → 已修** | 第一次判 PASS 是錯的：本文件「影響的程式」段寫「三對孿生」，design D1 列的是**四對**（漏了 `store.js` ↔ `db.py`，正是 `imported_at` 那組，tasks T3.1 其實有涵蓋）。已改為四對並補上 CLI 匯入路徑的理由。其餘核對無矛盾：D1↔T2.3、D2↔「不動 schema」、D5↔T3.3、D7↔T3.2 |
| S3 Scope | PASS（附註） | 三組同屬檢視層與匯入紀錄呈現，且 tasks 分三組可各自驗收；一個 change 為 2026-08-13 裁定 |
| S4 歧義 | **FAIL → 已修** | 兩處：(a)「最近 90 晚」原可解讀為日曆晚，已明寫為「有事件的晚」；(b) T3.4 的「注入中途失敗」原本沒有手法，已改為照既有 `nondestructive.test.mjs:125-133` 的 sabotaged driver 手法寫明 |
| S5 替代方案 | PASS | D1–D5 各三方案、D6／D7 各兩至三方案，皆附 trade-offs 與採用理由 |
| S6 依賴實證 | **FAIL → 已修** | D7 原方案假設「以 vm sandbox 取出 viewer 的 `groupSources` 直接比對」。實查 `app/src/viewer/assets/app.js` 整份包在 IIFE 內，該函式**沙箱外取不到**，方案不可行。改為「共用測試向量」：兩邊對同一組輸入各自斷言（App 端直呼純函式、viewer 端 vm sandbox 真渲染檢查 DOM），可行性以既有「匯入紀錄摺疊」測試為證 |

其餘引用的外部事實都附當日實測：payload 逐區塊大小、每筆 110 bytes、
事件密度（有事件晚數佔比、每晚平均與最大筆數）、`registerSource` 與
`db.py` 的 INSERT 欄位、`doc_rescue` 的 transaction 結構、`groupSources`
的分組 key。

**未派 sub-agent 審查**：本 session 的 harness 限制不主動呼叫 Agent，且
全域規範對 Fable 級主迴圈允許以自身推理替代弱模型的 sequential-thinking
審查。上述兩個 FAIL 均由 Self-Review 的 S4／S6 抓出。
