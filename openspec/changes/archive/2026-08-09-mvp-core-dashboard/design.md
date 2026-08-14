# Design: MVP 核心四件套單檔儀表板

## Context

Phase 0（2026-08-08，`docs/20260808_phase0_findings.md`）已驗證：健保存摺
14 節區官方 spec 在手且真實資料解析通過；Apple Health 數十萬筆於個位數秒入庫；
Apple 側冪等合併實測成立。現要把 `phase0/` 三支腳本升級為正式模組，
補齊健保側合併、knowledge 對照表與單檔互動 dashboard。

約束：本機優先、無伺服器；操作者現階段為單一技術使用者（CLI 可接受）；
未來多人（schema 預留）；介面繁體中文；個資 NEVER 進 git。

## Goals / Non-Goals

**Goals:**

- 每月一次「下載 → `mhb import` → 開 dashboard」的完整可用流程。
- 兩來源匯入皆冪等：重複匯入、重疊視窗匯入，筆數與內容不劣化。
- dashboard 單檔開檔即用（iPad Safari 可直接開），四件套＋全文搜尋。
- 每筆展示資料可追溯到來源檔與原始位置；每則解讀附來源與日期。

**Non-Goals:**

- 不做 server/API、不做 Tauri 包裝（前端資產設計為可原樣遷入 webview）。
- 不做手動補充（manual.json）、回診摘要匯出、多 profile 操作介面（v2）。
- 不解析健保 XML（僅保存原檔）；不碰 doc-cleaner。
- 不做任何醫療判斷、風險評分、用藥建議。

## Decisions

### D1: 健保側合併鍵 — 內容雜湊指紋而非欄位組合鍵

- **方案 A（採用）：正規化內容雜湊。** 每筆紀錄（含巢狀醫囑）欄位正規化
  （空值統一、去空白、排序）後取 SHA-256 前 16 bytes 作 `record_fp`，
  UNIQUE(profile_id, section, record_fp)。
  理由：Phase 0 實測同批資料在 JSON/XML 中排序不同、空值表示不同，
  但正規化後完全相等，證明「內容即身分」成立；欄位組合鍵
  （機構代碼+日期+序號）在藥局調劑（序號 XXXX）與同日同院多筆時會碰撞，
  需要一堆特例。雜湊天然覆蓋全部欄位，無特例。
- **方案 B：欄位組合自然鍵。** (機構代碼, 就醫日期, 就醫序號, 節區)。
  可讀性好、可解釋「為何判定重複」，但 Phase 0 已實測到兩個反例
  （調劑序號 XXXX、同日 IC02 補卡紀錄），特例清單會隨資料成長。
- **方案 C：雜湊＋組合鍵雙軌。** 最穩但兩套邏輯要同步維護，MVP 過重。
- 風險：健保端若修改歷史紀錄的任一欄位（如名稱改版），舊指紋不會被
  更新而是新增一筆 → 以「同組合鍵不同指紋」偵測並標 `superseded` 候選，
  進品質報告由使用者裁決（不自動刪）。

### D2: 嵌入分層 — 醫療類全量、活動類預聚合、明細留庫

- **方案 A（採用）：三層。** (1) 醫療類（就醫/用藥/檢驗/報告文字/疫苗/
  身體數值）全量嵌入 dashboard；(2) 活動類嵌「日聚合」序列（步數日值、
  能量日值等，已做防雙計）；(3) 原始明細只在 SQLite。
  依 Phase 0 量級估算：醫療類全量 <1MB、活動日聚合約 4 年 ×每日數值
  <0.5MB，總檔案（含前端代碼）遠低於 10MB 上限。
- **方案 B：全量嵌入。** 數十萬筆 JSON 達數十 MB，iPad Safari 開檔與
  記憶體都會痛，違反開檔即用。
- **方案 C：僅嵌聚合。** 檔案最小，但檢驗逐筆、用藥逐筆是核心場景，
  聚合後無法點入明細，四件套殘廢。

### D3: 前端技術 — Preact + htm（2026-08-08 定案）

- **方案 1（採用）：Preact + htm，單檔內嵌，無 build step。**
  Preact ~4KB、htm 用 template literal 免 JSX 編譯，直接 `<script>` 內嵌
  進單檔；元件化足以支撐四件套＋搜尋的互動複雜度；日後遷 Tauri 或升級
  React 語法幾乎相容。圖表沿用 Phase 0 手寫 SVG（dataviz 規範已驗證），
  不引入圖表庫。體積成本：~15KB。
- **方案 2：純 vanilla JS ＋手寫 SVG。** 零依賴、體積最小，Phase 0 的
  gen_report.py 就是此路。但互動升級（搜尋結果面板、篩選器聯動、明細
  展開）會累積出自製迷你框架，維護成本後移。
- **方案 3：Vue 3 petite-vue 或完整 React 內嵌。** petite-vue 已停更；
  完整 React ~140KB 且需 build chain，對單檔模式過重。
- 三案共同點：Python 端以 Jinja2 或字串模板產出殼＋嵌資料 JSON，
  前端代碼放 `src/dashboard/`，遷 Tauri 時原樣可用。

### D4: knowledge 對照表 — 版本化 YAML＋建置時 join

- **方案 A（採用）：repo 內 `knowledge/*.yaml` 人工維護＋藥品代碼建置時
  join。** 檢驗項目：`labs.yaml`（正規化名 → 說明、來源 URL、來源名、
  引用日期）；藥品：匯入時以醫囑代碼前 10 碼查本機快取的健保藥品品項檔
  （data.nhi.gov.tw 開放資料 CSV，手動更新、記錄版本日期），dashboard
  顯示成分名＋連到食藥署仿單平台。全部離線可用，無執行期外連。
- **方案 B：執行期呼叫開放資料 API。** 即時但違反「不需要網路也能用」
  且第三方 API 會收到查詢內容（隱私面）。
- **方案 C：LLM 生成說明。** 違反「解釋必須可引用來源」原則，直接排除。
- 用語約束（規劃書 §10）做成 spec 驗收：knowledge 條目 MUST 用
  「紀錄/顯示/整理/趨勢」類動詞，MUST NOT 出現「診斷/建議停藥/正常」
  等結論式用語；CI 以禁用詞清單 grep 把關。

### D5: 檢驗名稱正規化 — 規則表映射，未匹配保留原名

- **方案 A（採用）：`labs.yaml` 同時承載別名表**（Hb/HB→Hemoglobin、
  eGFR 三變體→eGFR），匹配寫入 `test_name_normalized`，未匹配者保留
  原名並標 `unmapped` 品質旗標；趨勢圖分組用正規化名，unmapped 者以原名獨立成組顯示（不消失）。
  理由：單人資料項目數十個，規則表一次整理即可覆蓋，透明可審。
- **方案 B：模糊比對自動聚類。** 對數十個項目是殺雞用牛刀，且錯誤聚類
  （如 eGFR (CKD-EPI) vs (MDRD) 其實「不該」合併）比不合併更危險——
  這兩個公式數值不可直接同線；別名表能表達「不合併」的專業判斷，
  自動聚類不能。
- 註：eGFR 各公式各自成線；體脂率等來源別修正（0.255→25.5%）屬
  apple adapter 的來源規則表，不在此層。

### D6: CLI 與模組架構 — 單一 `mhb` 入口、adapter 註冊制

```text
src/
├── mhb_cli.py          # mhb import / rebuild / status / quality
├── adapters/
│   ├── base.py         # Adapter 介面：detect() / parse() / version
│   ├── nhi_json.py     # 健保存摺醫療類 JSON
│   └── apple_health.py # Apple Health 匯出
├── store/              # schema、遷移、合併（record_fp）、品質旗標
├── knowledge/          # labs.yaml、藥品品項快取、join 邏輯
└── dashboard/          # 模板、前端代碼、嵌入產生器
```

- `mhb import <path>`：adapter 依 detect() 自動判型（zip/資料夾/單檔皆可），
  匯入後印品質報告摘要並自動重建 dashboard。
- `mhb quality`：唯讀操作，彙整資料庫既有品質資訊輸出完整品質報告，
  MUST NOT 重新解析任何來源檔；`mhb status`：schema 版本與各表筆數。
- schema 版本表 `schema_version`，遷移腳本前向式（sqlite 輕量 ALTER）。
- 方案 B（維持 phase0 各自獨立腳本）被否決：無統一品質報告、
  無自動判型，每月操作步驟數翻倍。

## Implementation Contract

- `mhb import <下載檔路徑>` 對健保 JSON 與 Apple 匯出（zip 或資料夾）
  自動判型匯入；重複執行同一輸入，資料庫內容不變（以表筆數與
  record_fp 集合驗證）；結尾印品質報告摘要。
- 品質報告為固定結構 JSON（同時印人讀摘要），頂層欄位依序為：
  source（檔名/sha256/adapter/版本）、sections（各節區 status 與
  records_in/records_out）、date_ranges（各資料類最早/最晚）、
  quality_flags（旗標→筆數）、unmapped_lab_names（清單）、
  superseded_candidates（對照組數）、stale_knowledge（過時條目清單）、
  dedup（skipped_dup 數）。`mhb import` 印當次增量；`mhb quality`
  印全庫彙整，兩者共用同一產生模組與結構。
- `mhb rebuild` 產出 `dashboard_YYYYMMDD.html`（不覆蓋舊檔）：
  含總覽 tiles、就醫時間軸（點入顯示該次診斷與用藥、標示來源）、
  用藥清單（同成分分組、連結仿單）、檢驗趨勢（正規化名分組、
  參考值顯示、單線圖）、身體數值趨勢（Apple＋健保成健同圖印證）、
  全文搜尋（院所/診斷/藥名/檢驗名/報告文字）；檔案 <10MB；
  所有嵌入字串經 HTML 跳脫；深淺色雙模式；頁首含醫療邊界聲明；
  版面響應式：視窗寬 ≥768px（iPad 直式）時各視圖不得水平溢出頁面，
  寬表格與圖表在自身容器內橫向捲動；搜尋輸入至結果呈現 <500ms
  （本批資料量級）。
- 每張表含 profile_id（MVP 固定單一 profile）、source_document 外鍵、
  來源節區與索引；dashboard 明細視圖顯示來源檔名。
- knowledge 條目結構：{normalized_name, aliases[], description,
  source_name, source_url, cited_date}；藥品顯示：{健保代碼, 商品名,
  成分名, 仿單連結}；禁用詞清單檢查通過才算建置成功。
- 失敗模式：無法判型 → 明確報錯列出支援格式；解析部分失敗 → 續行並
  記錄於品質報告，NEVER 靜默丟棄；資料庫鎖定/損壞 → 報錯並指向備份指引。
- 範圍邊界：不含 XML 解析、manual.json、摘要匯出、多 profile CLI 參數。

## Risks / Trade-offs

- [健保端格式改版] → adapter 版本化＋未知欄位保留進 extra_json 並記
  品質報告；spec 檔存 repo 可比對版次。
- [單檔隨年數成長] → 活動類已聚合；醫療類十年量級仍 <5MB；超標時
  dashboard 產生器警告並提示分年產出。
- [knowledge 人工維護過時] → 每條目帶 cited_date，dashboard 顯示引用
  日期；超過一年於品質報告提醒。
- [雜湊指紋不可解釋] → 品質報告提供「疑似重複但指紋不同」對照視圖
  （D1 的 superseded 偵測）。
- [指紋碰撞（128-bit，理論上可忽略）] → 匯入層在 INSERT OR IGNORE
  忽略前比對既有列的完整正規化內容，內容不同而指紋相同時記
  fingerprint_collision 旗標進品質報告（成本一次索引查詢，防禦性）。
- [單檔含全部個資誤傳] → 檔名含 `-private` 後綴與頁首紅字提醒；
  摘要分享功能留 v2 以免臨時拿整檔分享。

## Migration Plan

新專案無既有使用者。`phase0/output/mhb.sqlite` 為原型產物直接棄置，
正式庫由 `mhb import` 重建（原始下載檔都在，無資料遷移問題）。
回滾＝刪除 `data/mhb.sqlite` 重新匯入。

## Open Questions

- 藥品品項開放資料集的確切欄位與授權條款，於 apply 第一個 knowledge
  task 時實地下載確認（涉及 join 鍵格式）。
- （已結案）D3 前端技術：2026-08-08 選定方案 1（Preact + htm）。
