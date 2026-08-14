# Design: CPAP 睡眠呼吸資料匯入（Phase 1：ResMed 原生 EDF）

## Context

本 change 新增第三類資料來源。與前兩類的根本差異是**一次匯入是一整個
資料夾的上百個檔案**，而現行匯入流程從 GUI 到 adapter 介面都建立在
「一次一檔」之上。這是本輪最大的架構改動，比 EDF 解析本身大。

### 現況（實讀，2026-08-12）

- `app/src/adapters/registry.js:1-27`：adapter 介面為
  `{ id, formatDesc, detect(header, name), importSource(source, store, progress, opts) }`，
  `detect` 只看單檔前 64KB。
- `app/src/ui/import_flow.js:60-105`：`offerFile(path)` 對資料夾只做一件事，
  呼叫 `resolveAppleDirTauri` 找出 Apple 匯出 XML，把資料夾降解成單一檔案；
  找不到 XML 就報 `no_xml_in_dir`。
- `app/src/engine/store.js:19-33`：`registerSource` 以全庫 `sha256` 判重，
  命中即回傳原歸屬成員；`finalizeImport(docId)` 寫單一 doc 的 `import_stats`。
- `app/src/store/schema.js:5,183-187`：`SCHEMA_VERSION = 3`，`MIGRATIONS`
  為 `{來源版本: [SQL,...]}` 的前向遷移表，既有兩步（1→2、2→3）。
- `app/src/provider/payload.js:148-151`：`meta.sources` 列出該成員**全部**
  `source_documents` 的檔名，直接進單檔 HTML 匯出。
- `app/src/viewer/assets/app.js:624`：分頁清單 `TABS` 為四項；`Trends`
  （:495）以 `trendBounds()`（:466）算出的共用時間域驅動全頁四張
  `LineChart`（:163），`RANGES`（:485）為近三月／近一年／全部。
- `app/src/knowledge/forbidden.js`：禁用詞清單含「治療建議」「需要接受
  治療」「數值正常」等 20 項，SSOT 在 `src/knowledge/forbidden.py`。

### 格式事實（2026-08-12 重驗真實檔案；素材不進 repo）

EDF 為公開標準：256 位元組固定頭 ＋ `ns × 256` 位元組訊號頭，資料區為
`int16` 小端序，實際值 `phys = physmin + (dig − digmin) × (physmax − physmin) / (digmax − digmin)`。

| 檔案 | 結構 | 用途 |
|------|------|------|
| `STR.edf` | 28 訊號，每 record 一天（`dur=86400`），header 7424 位元組 | 每日摘要 |
| `DATALOG/*_EVE.edf` | EDF+D annotation（TAL），每 record 一個事件 | 呼吸事件 |
| `DATALOG/*_SAD.edf` | 2 訊號（Pulse bpm、SpO2 %），**1Hz 逐秒** | 血氧脈搏 |
| `DATALOG/*_PLD.edf` | 11 訊號逐分鐘 | 本輪排除 |
| `DATALOG/*_BRP.edf` | 2 訊號高頻波形 | 本輪排除 |

`DATALOG` 是平的一層（無巢狀子目錄）。`Identification.tgt` 為文字檔，
`#PNA` 欄位是機型字串（如 `S9_AutoSet`），`#SRN` 為裝置序號。

**四個必須寫進實作的坑**（任一漏掉都會產生看起來正常的錯誤資料）：

1. **record 起始是正午 12:00，不是午夜。** `STR.edf` 的 `starttime` 為
   `12.00.00`，`Mask On`／`Mask Off` 是「自該 record 起始（正午）起算的
   分鐘數」，跨午夜的值大於 720。誤當午夜起算會讓所有就寢時間差 12 小時。
2. **未使用日以哨兵值佔位，且哨兵的 phys 值隨訊號而異。** 判定 MUST 用
   **`dig < digmin`**（缺測的原始數位值是 −1，而 `digMin` 多半是 0 或正數）。
   兩種寫法都會壞事：用 phys 值比對會漏（同一個 −1 在各訊號縮放成 −1、
   −0.02、−0.1）；用 `== digmin` 則同時漏掉全部缺測日**並誤刪合法的 0 值**
   （實測有數百天的 `UAI` 真的是 0、同樣量級天數的 `Min Pressure` 真的等於
   `digMin`）。不濾會在趨勢圖畫出一整片假點，誤刪則是無聲的資料損失。
3. **EDF label 欄位只有 16 字元，長標籤被截斷。** 實際字串是
   `Therapy Pres Me`（Med 被切）、`Therapy Pres Ma`、`Exp Pres Med`。
   比對 MUST 用截斷後字串，不能用理想名稱。
4. **EVE 事件有五類，不是三類。** `Obstructive Apnea`、`Central Apnea`、
   `Hypopnea`、**未分類 `Apnea`**、以及非事件的 `Recording starts`。
   已逐 record 驗證未分類 `Apnea` 不是跨界截斷產物（該 record 完整且後接
   NUL 填充），它也正好解釋為何少數日期 `AI` 大於 `OAI + CAI + UAI`。
   漏掉它會讓事件統計與每日摘要對不攏。

另：`AHI = AI + HI` 在全部有效日成立（可作為解析正確性的交叉驗證）。

### 約束

- 遷移將在既有生產庫上執行（數十萬列／百 MB 量級／schema v3），失敗代價
  是資料庫打不開。這是 v0.3 以來第一次真正對既有庫跑遷移。
- schema parity 測試強制 `src/store/schema.py` 同步 DDL 與 MIGRATIONS。
- 本輪明示豁免「每個 adapter 都有 Python oracle 差分對帳」紀律（假設 #65），
  改以合成 EDF fixture 的數值斷言＋真實檔案人工對帳一次。
- schema MUST 以兩台機器共通的臨床量設計，不得長成 ResMed 欄位的形狀。

---

## Decisions

### D1 多檔來源：adapter 介面擴充

現行 `importSource(source, ...)` 收單一 ByteSource。ResMed 需要一次處理
`STR.edf` 加 `DATALOG` 下上百個檔。

| 方案 | 做法 | 取捨 |
|------|------|------|
| 1-A | 保持單檔介面，GUI 對資料夾逐檔呼叫 `importSource` | adapter 無法跨檔關聯（事件檔要對到當日摘要），且每檔一個交易，中途失敗留下半匯入狀態，違反「匯入不破壞既有資料」requirement。捨棄 |
| 1-B **（採用）** | 新增可選的 `importSourceSet(sourceSet, driver, progress, opts)`；`sourceSet` 為 `{ rootName, entries: [{ relPath, source }] }`。有此方法的 adapter 由 GUI 走多檔路徑，沒有的完全不受影響 | 既有三個 adapter 一行不改（`detect` 與 `importSource` 語意不變），新介面只有 ResMed 實作。單一交易涵蓋整批，原子性維持 |
| 1-C | 把所有 adapter 都改成收集合（單檔視為 1 元素集合） | 介面統一最漂亮，但要動三個既有 adapter 與全部既有測試，且 `nhi_json`／`nhi_xml` 走的是 `{bytes,name}` 而非 ByteSource（`import_flow.js:185-188`），改動面遠大於收益。捨棄 |

**採用 1-B。** `registry` 增加 `detectSet(entries)`：接受
`[{ relPath, headerBytes }]`，回傳 adapter 或 null；ResMed 的判定是
「entries 內存在名為 `STR.edf` 的項目且其 header 通過 EDF 判型」。
`registry.register` 的介面檢查放寬為「`importSource` 與 `importSourceSet`
至少有一個」，兩者都無才拋錯。

### D2 source_documents 粒度：每檔一列

已於 2026-08-12 定案（原 OPEN 假設 #60，三方案擇一）：**STR.edf 與每個
被解析的 DATALOG 檔各佔一列 `source_documents`**。理由是沿用既有
`UNIQUE(sha256)` 語意零改動、下次插卡只有新檔被處理（舊檔 sha256 命中即
跳過，增量最精確），且天然滿足 `health-database`「來源追溯足以還原至
原始檔案位置」。

**未被解析的檔案不建列**（`.crc`、`SETTINGS/`、`PLD`、`BRP`）：建了會讓
「來源」清單充滿本專案根本沒讀的檔案，且 `import_stats` 無內容可寫。

**必須一併處理的後果**（此為本決策的代價，不是既有缺陷）：

- `payload.js:148-151` 的 `meta.sources` 會從 3 列膨脹到上百列，而它顯示在
  總覽的「資料庫與匯入紀錄」卡上（`app.js:327`），逐列呈現會把那張卡撐爆。
  **改法：payload 保留全部列，摺疊做在檢視層。** 同一 adapter 且同一
  `imported_at` 的多筆併為一行顯示「N 個檔案」，可展開看逐檔。
  理由：payload 端摺疊會讓匯出的單檔 HTML 失去逐檔追溯（違反
  `health-database`「來源追溯足以還原至原始檔案位置」的精神），而且分組
  邏輯要在 JS 與 Python 兩端各寫一次並保持位元組級一致（`provider_parity`
  是全等比對）。保留原始列則 payload 端全是純 SQL，沒有跨語言的分組差異。
  代價是 payload 多帶數十列檔名，實測量級為數 KB。
- `finalizeImport` 只對 **STR.edf 那一列**寫整批合計的 `import_stats`；
  DATALOG 各列的 `import_stats` 寫該檔自身的筆數。兩者語意在報告卡上
  分別呈現為「本批合計」與逐檔明細。

### D3 schema 擴充（SCHEMA_VERSION 3→4）：三張新表

欄位以兩台機器共通的臨床量選取，不含任一廠牌專有欄位。

```sql
CREATE TABLE IF NOT EXISTS cpap_daily(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    device TEXT NOT NULL,
    summary_date TEXT NOT NULL,
    session_start_min REAL,
    session_end_min REAL,
    session_count INTEGER,
    usage_min REAL,
    ahi REAL,
    ai REAL,
    hi REAL,
    oai REAL,
    cai REAL,
    uai REAL,
    leak_median REAL,
    leak_95 REAL,
    leak_max REAL,
    pressure_median REAL,
    pressure_95 REAL,
    pressure_max REAL,
    pressure_set REAL,
    pressure_min_setting REAL,
    pressure_max_setting REAL,
    mode_raw REAL,
    mask_events INTEGER,
    extra_json TEXT,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, device, summary_date));
CREATE INDEX IF NOT EXISTS idx_cpap_daily_profile
    ON cpap_daily(profile_id, summary_date);

CREATE TABLE IF NOT EXISTS cpap_events(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    device TEXT NOT NULL,
    session_date TEXT NOT NULL,
    start_ts TEXT NOT NULL,
    duration_sec REAL,
    event_type TEXT NOT NULL,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, device, start_ts, event_type));
CREATE INDEX IF NOT EXISTS idx_cpap_events_profile
    ON cpap_events(profile_id, session_date);

CREATE TABLE IF NOT EXISTS cpap_oximetry(
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id),
    doc_id INTEGER NOT NULL REFERENCES source_documents(id),
    device TEXT NOT NULL,
    session_date TEXT NOT NULL,
    minute_ts TEXT NOT NULL,
    spo2_min REAL,
    spo2_mean REAL,
    pulse_mean REAL,
    pulse_max REAL,
    sample_count INTEGER NOT NULL,
    quality_flags TEXT NOT NULL DEFAULT '',
    UNIQUE(profile_id, device, minute_ts));
CREATE INDEX IF NOT EXISTS idx_cpap_oximetry_profile
    ON cpap_oximetry(profile_id, session_date);
```

**UNIQUE 鍵含 `device` 是 Phase 2 的關鍵，不是裝飾。** 兩台機器的資料在
時間上重疊數個月（實測 ResMed 的涵蓋期與 Philips 的起始期重疊約五個月），
若 `UNIQUE(profile_id, summary_date)` 不含裝置，Phase 2 匯入時同一天會被
當成重複而靜默丟棄，且丟掉的是哪一台不可控。

`device` 值取 `Identification.tgt` 的 `#PNA`（機型字串），**序號 `#SRN`
不入庫**（裝置識別碼，個資最小化；本專案不需要它區分機器，機型已足夠）。
`#PNA` 讀不到時回退為 adapter id（`resmed_edf`）並標
`quality_flags = 'device_unknown'`。

`session_start_min`／`session_end_min` 存「自摘要日正午起算的分鐘數」
（原始語意，見 D4），不做時間換算後入庫；換算留給檢視層，避免時區在
入庫階段被固化。

**`Mask On`／`Mask Off` 各有 10 個槽位**（同一天可分多段使用，例如中途
取下面罩再戴回），未用的槽位為哨兵值。存法：
- `session_start_min` 取**第一段**有效的 `Mask On`。
- `session_end_min` 取**最後一段**有效的 `Mask Off`。
- `session_count` 為有效段數。
- 完整的逐段起訖存入 `extra_json`（鍵名 `segments`，值為
  `[[on, off], ...]`），因此多段資訊不遺失，UI 需要時可直接取用。
- `session_count > 1` 時標 `quality_flags = 'multi_session'`，讓「就寢
  時間」這類單值呈現有機會註明當日分段。

不可只取第一組槽位就當全天：`usage_min`（機器給的 `Mask Dur`）是全天
合計，若 `session_end_min − session_start_min` 與它差距超過段間空隙可解釋
的範圍，單值呈現就會與使用時數自相矛盾。

方案比較：

| 方案 | 取捨 |
|------|------|
| 3-A 三張表（採用） | 每日摘要／事件／血氧三種粒度天然分離，查詢與去重鍵各自清楚 |
| 3-B 單一寬表加 `kind` 欄 | 欄位半數恆為 NULL，UNIQUE 鍵要視 kind 而異，SQLite 做不到條件式 UNIQUE 而需三個 partial index，反而更複雜。捨棄 |
| 3-C 血氧併入既有 `apple_records` | 可直接複用既有血氧趨勢，但 `apple_records` 的形狀是單值時序（`value_numeric`），塞不下每分鐘四個統計量；硬塞要拆成四個 `type`，一晚變四倍列數且語意混淆。捨棄，改在檢視層疊線（見 D6） |

### D4 每日摘要的日期歸屬：正午邊界

`STR.edf` 的 record 起始為正午 12:00，一個 record 涵蓋「當日正午到隔日
正午」，也就是完整涵蓋一個晚上的睡眠。

| 方案 | 取捨 |
|------|------|
| 4-A **（採用）** | `summary_date` 取 record 起始日（入睡當晚的日期） | 與機器原生語意一致，也與臨床習慣一致（「幾號晚上的睡眠」）。換算示例：`Mask On=600` 即自正午起 600 分鐘、當日 22:00 就寢；`Mask Off=780` 即 780 分鐘、隔日 01:00 取下 |
| 4-B | 改用醒來日（record 起始日 +1） | 讓「昨晚睡得如何」在早上看時對應到今天的日期，但與機器與回診習慣都不同，且跨兩台機器時若 Phase 2 採原生語意就會錯開一天。捨棄 |
| 4-C | 依 `Mask On` 是否跨午夜逐日判定 | 同一序列的日期定義會隨就寢時間跳動，趨勢圖上出現無法解釋的空洞或雙點。捨棄 |

**採用 4-A**，並在 UI 明示「日期為入睡當晚」。

事件與血氧的 `session_date` **MUST 由該檔 header 的起始時刻套用同一條
正午邊界規則推導**（起始時刻 ≥ 12:00 取當日，< 12:00 取前一日），
**不可直接取檔名的日期部分**：

- 檔名日期在午夜後就寢時會與 `STR` 的 `summary_date` 差一天，於是同一晚
  的事件與每日摘要在畫面上變成兩天，且沒有任何錯誤訊息。
- 素材實測全部 session 都在 20:00 至 22:00 之間開始，因此這份素材上兩種
  取法結果相同。這是素材的巧合，不是規則，不能作為採用檔名日期的依據。
- 同一晚的 `EVE` 與 `SAD` 檔起始時刻常差 1 至 2 秒（實測），以 header
  時刻套正午邊界會歸到同一天，用檔名字串比對則需要額外的容差邏輯。

### D5 哨兵值與未使用日

實測數百個 record 中有相當比例是「該日未使用機器」的佔位 record，全部
欄位為哨兵值。（精確比例即機器使用率，屬個人資料，依 D12 不寫入本文件；
數字留在本機驗證紀錄。此處的模糊是刻意的，不是漏寫。）

| 方案 | 取捨 |
|------|------|
| 5-A **（採用）** | 未使用日**不入庫**（整個 record 跳過），判定條件為 `Mask Dur` 的 `dig < digmin` | 資料庫只存真實發生的治療夜。趨勢圖的「有資料的日子」語意乾淨，順從度可由「區間天數 vs 有紀錄天數」在檢視層算出 |
| 5-B | 入庫並標 `quality_flags='not_used'`，由查詢層排除 | 忠實保留「機器記錄了這一天但沒用」，但既有 `TREND_EXCLUDE`（`payload.js:8-9`）只認 `epoch_placeholder_date` 與 `out_of_range` 兩個旗標，要新增旗標到排除清單，且每個新查詢都得記得排除，漏一處就畫出假點。捨棄 |
| 5-C | 入庫且值存 NULL | UNIQUE 鍵佔位但無內容，統計「有幾天有資料」時要逐欄判 NULL。捨棄 |

**採用 5-A。** 逐欄另有獨立哨兵判定：某訊號 `dig < digmin` 時該欄位存
NULL（不是存 −1）。整批完成後，跳過的 record 數計入匯入報告的
`skipped_unused`，讓使用者看得到「這張卡有 N 天沒有使用紀錄」，避免
「資料變少了」的疑慮。

### D6 血氧脈搏：逐分鐘聚合與多來源疊線

已於 2026-08-12 定案（三方案擇一）：`SAD` 的 1Hz 逐秒原始值不入庫，改存
每分鐘一列聚合。理由是逐秒保存兩訊號會達到數十萬列，等於再塞一個現有生產庫
的量，而 Phase 2 若 Philips 有連續血氧將達 3000 萬列等級。

聚合語意（明確定義，實作不得自行詮釋）：

- **一個 EDF record 即一個分鐘桶**：實測 `SAD` 的 `dur = 60.0` 且每訊號
  `nsamp = 60`（1Hz），因此不需自行切窗，逐 record 聚合即可。`minute_ts`
  由檔頭起始時間加 `record 序號 × 60 秒` 推得。
- 若日後遇到 `dur` 非 60 的檔案，MUST 依 `dur` 與 `nsamp` 計算實際取樣率
  後改以「每 60 秒一桶」聚合，不得假設 record 邊界等於分鐘邊界。
- 不足 60 個樣本的尾桶照樣入庫並記 `sample_count`（不補值、不丟棄）。
- `minute_ts` 存 `YYYY-MM-DDTHH:MM` 的本地時間字串（EDF 檔頭時間無時區
  資訊），與既有 `apple_records.start_ts` 的無時區本地字串慣例一致。
- `spo2_min` 取桶內最小值，`spo2_mean` 取算術平均後四捨五入至小數一位。
- `pulse_mean` 取桶內算術平均後四捨五入至小數一位（同 `spo2_mean` 算法），
  `pulse_max` 取桶內最大值。
- 樣本值為該訊號哨兵（`dig < digmin`）者不計入任何統計，且不計入
  `sample_count`；整桶皆為哨兵則不建列。
  判準為 `dig < digMin`，因此落在 `digMin` 上的合法值（如 `Pulse` 的
  18 bpm）不會被誤判。

  **Phase 1 的素材完全沒有血氧資料（實測 2026-08-12）**：`SAD` 檔存在且
  結構完整，但**全部樣本都是缺測值**，兩個訊號都沒有任何一筆
  有效量測。ResMed S9 需要外接血氧模組才會記錄，這台顯然從未接過。
  因此：
  - `cpap_oximetry` 在 Phase 1 匯入後**是空的**，這是正確行為而非缺陷。
  - 本決策（逐分鐘聚合 vs 逐秒全存）在 Phase 1 沒有實際差別（兩者都是
    0 列）。它的價值在 Phase 2，屆時若來源有連續血氧才會生效。
  - UI 的睡眠期血氧圖在 Phase 1 會是空狀態，**MUST 顯示既有的「無資料」
    呈現而不是空白區塊**（見 D10 與 proposal 的相容性要求）。
  - 先前一次驗證問錯了問題（查「有沒有樣本等於 `digMin`」，得到 0 就以為
    資料正常），實際上全部落在 `< digMin`。查缺測要用與程式相同的判準。

**與既有 Apple 血氧的關係**：兩者都存、以來源區分並在同一張圖疊線
（假設 #64），沿用體重的多來源模式（`app.js:516-520` 的
`weightSeries` 就是兩個 series 疊在一張 `LineChart`）。CPAP 血氧走
`cpap_oximetry`、Apple 血氧留在 `apple_records`，疊線在 `payload.js`
組裝時完成，資料庫層不合併。理由是兩者量測性質不同（睡眠期連續 vs
全日抽樣），合併入同一表會失去「這是哪種量測」的區分。

**已知限制（寫進 spec）**：去飽和區段的精確秒數不可還原，最低值序列只能
回答「整晚最低血氧」與「低於任一門檻的分鐘數」。

### D7 未知枚舉不猜語意

`Mode`、`EPR`、`EPR Level`、`Mask Events` 是數值編碼的枚舉，實測樣本只
涵蓋其中極少數取值，而公開的對照表不存在（唯一完整實作 OSCAR 為 GPL-3.0，
本專案 MIT，不得閱讀移植）。

| 方案 | 取捨 |
|------|------|
| 7-A **（採用）** | 存原始數值（`mode_raw`），UI **不顯示**這幾個欄位，只留在資料庫供日後對照表補齊 | 誠實。不猜就不會猜錯，且資料已入庫，日後拿到對照表可純靠查詢補語意，不需重新匯入 |
| 7-B | 依常見機型猜測對照（如 1=CPAP、2=AutoSet） | 猜錯會在 UI 上顯示錯誤的治療模式，而使用者無從察覺。這正是「只顯示不解讀」要防的。捨棄 |
| 7-C | 完全不入庫 | 日後補對照表時得重新匯入，而 ResMed 素材不可再生。捨棄 |

`Set Pressure`、`Max/Min Pressure` 是有物理單位（cmH2O）的實數，不受此
決策影響，正常入庫並顯示。

### D8 schema 3→4 遷移：安全與回復

這是第一次讓既有生產庫（數十萬列／百 MB 量級）真正跑遷移，失敗代價是資料庫
打不開。

本輪遷移的內容是**純新增三張表**，不改任何既有表的結構，也不搬移任何
既有資料。這使風險本質上低於一般遷移，但仍須有回復路徑。

| 方案 | 取捨 |
|------|------|
| 8-A | 直接執行 `CREATE TABLE`，沿用既有 `initSchema` 流程 | 最簡單，但 `initSchema`（`schema.js:193-217`）目前**不在交易內**逐版執行；若在第二張表建到一半時中斷，庫會停在「版本已寫 4 但只有兩張表」的不一致狀態 |
| 8-B **（採用）** | 8-A 加上兩道防線：(1) 整個遷移迴圈包在單一交易內（`driver.transaction`），版本註記與 DDL 同進同出；(2) 遷移**開始前**以既有的 `exportDbSnapshot`（`VACUUM INTO`）產生一份 v3 快照並保留 | 交易保證不會有半遷移狀態；快照保證即使 SQLite 本身出問題也有退路 |
| 8-C | 要求使用者手動備份後才允許升級 | 把責任推給使用者，而多數人不會做。捨棄 |

**採用 8-B。** 具體行為：
- `initSchema` 的遷移迴圈（`ver < SCHEMA_VERSION` 那段）整段移入
  `driver.transaction`，`INSERT INTO schema_version` 與 DDL 在同一交易。
  `NodeDriver.transaction`（`node_driver.js:42-52`）與 App 端同形，
  SQLite 允許 DDL 在交易內，因此此改動不需要新的 driver 能力。
- 備份 MUST 用 `exportDbSnapshot(driver, destPath)`
  （`location.js:63-65`，`VACUUM INTO`），**不可用 `fs.copyFile`**：
  同檔 `location.js:40` 已記載複製前必須先關閉主庫連線（連線池握檔陷阱，
  見 `docs/verification/g3_task0.md`），而遷移正發生在開庫流程中，庫必然
  開著。`VACUUM INTO` 取單一交易視角、不中斷主庫，正是此情境的正解，
  且輸出可直接被既有 `importExistingDb` 讀回。
- 目標檔名沿用既有 `backupFileName` 慣例並加版本標記
  （`mhb-premigrate-v3-YYYYMMDD.sqlite`）。`VACUUM INTO` 對已存在的目標檔
  直接拒絕（`location.js:60-62` 已記載），因此 MUST 先以 `fs.exists` 預檢，
  同名時附序號。
- 僅在「偵測到既有版本低於程式版本」時才做快照，全新庫不做。
- 快照失敗（磁碟不足等）MUST 中止遷移並明確告知，不得靜默續行。
- `NoMigrationPath` 與 `SchemaTooNew` 的既有錯誤訊息維持不變。

### D9 GUI：資料夾判型與批次報告卡

`offerFile` 目前對資料夾只嘗試 Apple XML。需要擴充成「先問 registry 這
批檔案是誰的」。

**判型順序**（`offerFile` 拿到資料夾路徑時）：
1. 列出資料夾內容（含 `DATALOG` 一層，因為它是平的）。
2. 讀取候選檔的 header（`STR.edf` 讀前 8KB 已足夠涵蓋 7424 位元組的
   完整訊號頭），呼叫 `registry.detectSet(entries)`。
3. `detectSet` 有結果就走多檔路徑；沒有才回退到現行的
   `resolveAppleDirTauri`（Apple 情境完全不受影響）。
   **順序理由**：`detectSet` 判的是「這批檔案整體是什麼」，條件嚴格
   （必須有 `STR.edf` 且通過 EDF 判型）；`resolveAppleDirTauri` 判的是
   「資料夾裡有沒有任何非 cda 的 XML」，條件寬鬆且會下潛一層子目錄。
   把寬鬆的放後面，才不會讓一張含有無關 XML 的 SD 卡被誤判成 Apple 匯出。
4. 兩者都沒有時的訊息從「資料夾內找不到 Apple Health 匯出 XML」改為
   列出全部支援格式（與單檔未識別時的行為一致）。

**確認面板**：檔名列改為 `<資料夾名>（N 個檔案，合計 M MB）`，其餘
（歸屬成員選擇、三態提示）完全沿用。CPAP 檔無身分識別，比照 Apple
直接歸入所選成員。

**報告卡**：現行 `renderResult`（`import_flow.js:208-249`）預期單一
`r.source.filename`。改為當 `r.source.files` 存在時，標題顯示批次名稱與
檔數，節區表格下方增加一個 `<details>` 收合逐檔明細（檔名、狀態、筆數）。
單檔匯入的呈現一位元組不變。

**整批重複的訊息**：全部檔案的 sha256 都命中時，狀態回
`skipped_duplicate` 並顯示「這張卡的 N 個檔案先前都已匯入」；部分命中時
狀態仍為 `ok`，報告卡顯示「N 個檔案中 M 個是新的」。

**進度回報**：沿用既有 `progress(processed, totalBytes, readBytes)` 契約，
`totalBytes` 為整批合計位元組數，`readBytes` 跨檔累加，因此進度條在整批
匯入過程中單調遞增（既有「進度單調」scenario 的語意在多檔情境下維持）。

### D10 UI 呈現

三處，均由假設 #63 裁示：

**(1) 新增「睡眠呼吸」分頁**（`TABS` 增為五項）。內容：
- 區間選擇沿用趨勢頁的 `RANGES` 與共用時間域機制（本 change 不再自造
  一套時間軸，`trend-time-axis` 已把該機制做成可複用的形式）。
- 每日 AHI 折線（AHI 一條線，中樞／阻塞／低通氣分項為可切換的疊線）。
- 使用時數折線（`usage_min`／60）。
- 漏氣與治療壓力折線（`leak_95`、`pressure_95`）。
- 睡眠期血氧折線（`spo2_min` 與 `spo2_mean` 兩條，僅在有 DATALOG 的
  日期有點）。
- 事件明細表（日期、時刻、類型、持續秒數），依既有表格樣式。
- 每一張圖下方標注資料來源與「日期為入睡當晚」。

**(2) 趨勢頁混合對照**：把「每日 AHI」作為**獨立一張圖插入趨勢頁的堆疊**
（在體重圖之後），與同頁其他圖共用既有時間域與區間選擇。這是本功能的
核心價值（回診時要看的正是 AHI 與體重的關係），也是現有四個來源都做
不到的事。

實作方式的選擇（`LineChart`（`app.js:163-198`）只有單一 y 軸，`lo`／`hi`
由全部 series 的值共同計算，因此 AHI 與體重放進同一張圖會讓 AHI 被壓成
貼底的平線）：

| 方案 | 取捨 |
|------|------|
| 10-A | 擴充 `LineChart` 支援第二 y 軸（`series[i].axis = 'right'`） | 能在單張圖上疊兩條線，但要改所有圖表都會執行到的核心元件（回歸面最大），且雙軸圖的兩條線相對高低與交叉點沒有實質意義，容易被讀成相關性。捨棄 |
| 10-B **（採用）** | 上下堆疊兩張獨立圖，共用同一 `domain` | 零改動既有元件（就是多一次 `LineChart` 呼叫並傳入同一個 `dom`），趨勢頁本來就是垂直堆疊多張圖共用時間域，對照靠同一 x 位置對齊讀取，這也是睡眠報告的既有慣例 |
| 10-C | 兩序列各自正規化到 0-100 後同圖 | 兩條線可比了，但 y 軸失去單位意義，且「正規化後相對變化等價」本身是一種解讀，違反只顯示不解讀。捨棄 |

**採用 10-B**，因此 `trendBounds()`（`app.js:466-483`）的 `groups` MUST
加入 CPAP 的日期序列，否則新圖的時間域與其他圖不一致（既有「四張圖共用
同一時間區間」的不變式擴張為五張以上）。

**(3) 總覽卡**：新增一張卡，顯示最近一次的 AHI 與使用時數，以及該筆的
日期（沿用 `misattribution-rescue` QA 後補上的「顯示最近量測日」慣例，
避免陳舊數值被誤讀為當前狀態）。

**文案紀律**：AHI 等臨床指標只顯示不解讀，不出現任何判定性描述。既有
禁用詞守衛已涵蓋這類措辭，新增文案一併納入守衛掃描範圍。

### D11 驗證：合成 EDF fixture

本輪明示豁免 Python oracle 差分對帳（假設 #65）。替代方案必須自身夠強，
否則就是把護欄拆了沒補回去。

**合成 fixture 產生器**（`app/tests/helpers/make_edf.mjs`）：以純 JS 寫出
符合 EDF 規格的位元組，測試資料全部是人為指定的已知值，因此每一項斷言
都是「已知輸入對已知輸出」而非「和另一個實作跑出來一樣」。

必須覆蓋的 fixture 情境（每項對應一組數值斷言）：

| fixture | 驗證目標 |
|---------|---------|
| 正常三日 STR | 縮放公式正確（指定 dig 值反推 phys 值）、日期遞增 |
| 含未使用日的 STR | D5 的哨兵判定：該日不入庫，`skipped_unused` 計數正確 |
| 逐欄哨兵混合的 STR | 單一欄位為哨兵時存 NULL，同 record 其他欄位正常 |
| 標籤截斷的 STR | 以 `Therapy Pres Me` 等截斷字串比對成功 |
| 跨午夜 session | `Mask On=600`／`Mask Off=780` 解為就寢 22:00、離床隔日 01:00 |
| 多段 session 的 STR | 兩組槽位有值時 `session_count=2`、首段起與末段止正確、`extra_json.segments` 兩筆、標 `multi_session` |
| 五類事件的 EVE | 含未分類 `Apnea` 與 `Recording starts`；後者不入庫 |
| 不足 60 樣本尾桶的 SAD | 尾桶入庫且 `sample_count` 正確 |
| 全哨兵分鐘的 SAD | 整桶不建列 |
| 重複匯入同一批 | 逐檔 sha256 命中、零新增、既有列逐位元組不變 |
| 部分新檔的批次 | 只有新檔被處理，報告顯示「N 中 M 個是新的」 |

**真實檔案人工對帳一次**（假設 #65 要求）：以真實素材匯入後，人工核對
三項並記錄於 `docs/verification/`：有效日數、事件分類統計、`AHI = AI + HI`
在全部有效日成立。紀錄**只寫結構性結論與是否相符，不寫任何數值**
（依 D12 的個資紀律）。

**遷移測試**：以 schema v3 的合成庫（含各表若干列）跑 `initSchema`，斷言
升級後版本為 4、三張新表存在、且**既有各表逐位元組不變**（沿用既有
before/after 全庫 dump diff 的手法）。另加一項：遷移中途拋錯時全庫回滾至
v3 狀態。

### D12 個資紀律（本輪新增，適用於全部產出）

倉庫為 public。v0.5.0 轉 public 前的把關只涵蓋資料層（git 歷史無資料檔、
截圖為合成資料），漏了敘述層，導致診斷敘述與個人量測時間軸被推上公開
網路，已於 2026-08-12 中性化改寫（假設 #72）。

本 change 的全部產出（proposal／design／tasks／spec／驗證紀錄／CHANGELOG／
commit message）MUST 遵守：

- 個人健康敘述一律寫成不指向特定個人的功能理由。
- 驗證紀錄用相對跨度與結構性結論，不用絕對日期，不寫健康數值。
- 序列以類型代稱。
- 真實素材與其衍生數值不進 repo／CI（既有假設 #67）。

---

## 已知限制（將寫入 spec，非留白）

- 去飽和區段的精確秒數不可還原（D6 的代價）。
- `Mode`／`EPR` 等枚舉入庫但不顯示，直到取得公開對照表（D7）。
- `PLD` 逐分鐘 11 訊號與 `BRP` 波形不入庫，因此無單晚壓力與漏氣曲線。
- Phase 1 完成後仍無持續迴圈（仍在產生新資料的機型要等 Phase 2）。
- 順從度以「有紀錄天數 ÷ 區間天數」呈現，未使用日不入庫，因此若使用者
  中間換過機器，空窗期無法區分「沒用」與「用了另一台但尚未匯入」。

## 對既有 spec 的影響

| spec | delta |
|------|-------|
| `cpap-therapy`（新增） | 匯入、粒度、日期歸屬、哨兵、聚合語意、顯示不解讀 |
| `health-database` | 三張新表、SCHEMA_VERSION 4、遷移交易化與自動備份 |
| `app-import-engine` | `importSourceSet` 介面、批次原子性、多檔進度語意 |
| `app-import-gui` | 資料夾判型順序、批次確認面板與報告卡 |
| `app-viewer` | 睡眠呼吸分頁、趨勢頁混合對照、總覽卡、來源清單摺疊 |
