# Design: 多人資料管理

## Context

change `tauri-desktop-app` 已 archive（v0.3.0）。多人地基（2026-08-10
程式碼實讀確認）：

- schema v3 全表 `profile_id INTEGER NOT NULL REFERENCES profiles(id)`，
  健保側去重鍵 `UNIQUE(profile_id, section, record_fp)`、Apple 側
  `UNIQUE(profile_id, activity/type, ...)`：各成員資料天然隔離、
  冪等互不干擾（`app/src/store/schema.js`）。
- profiles 表現有欄位：id、display_name、masked_id、created_at，
  本輪足用，零 DDL 變更。
- `source_documents.sha256` 為**全庫 UNIQUE**（非 per-profile）：
  同一檔案不可能同時歸兩位成員；跨成員重匯同檔會命中既有列
  （`engine/store.js registerSource`），訊息需交代原歸屬。
- 單人捷徑清單（本輪改造對象）：`adapters/nhi_json.js` 與
  `adapters/apple_health.js` 的 getFirstProfile／自動建「本人」、
  `ui/import_flow.js` 的 `LIMIT 1` 歸戶預覽、`provider/payload.js`
  全查詢無 profile 過濾、`ui/main.js` 狀態列全表計數、
  `ui/history.js` 匯入紀錄不分人（檔頭註解已預留分組掛載點）。

當日依賴實證（G1-S6）：本輪**無新外部依賴**。settings.json 讀寫
沿用 Tauri fs plugin（`fs.writeTextFile`／`fs.exists` 於
`ui/viewer.js`、`store/location.js` 已在生產路徑使用，2026-08-10
原始碼確認）；成員選擇器與管理面板為既有 Preact/DOM 模式的延伸，
無新 plugin、無 DDL、無新 crate。

common-ground 裁示（2026-08-10，#38-#41）：手動選人歸戶、單人
切換器檢視、成員管理含刪除、HTML 匯出＝當前成員。

## Goals / Non-Goals

Goals：

- 多位家庭成員共用同一 App 與資料庫：匯入時明確指定歸屬、檢視時
  一鍵切換成員、成員可管理（新增／改名／刪除）。
- 歸屬錯誤可防（健保檔身分證護欄）、可救（刪除成員重匯，原始檔
  皆保留）。
- 既有單人使用體驗不退化：單人資料庫零遷移，日常流程步驟數僅
  增加「選成員」一步。
- parity 護欄與既有 58 node:test 繼續全綠。

Non-Goals：

- 跨人比較檢視、全家合併 HTML 匯出（v2 候選）。
- profiles 表新欄位（顏色、頭像、生日等）：本輪零 DDL。
- Python CLI 多人操作：維持凍結，CLI 仍為單人 oracle 與開發者路徑。
- 權限／隱私隔離（成員間互看防護）：本機單使用者 App，不設密碼。

## Decisions

### D1: 匯入歸屬選擇＝判型確認面板整合成員選擇器

- **方案 1（採用）：既有判型確認面板內加成員選擇器，單一面板完成
  「格式＋歸屬」確認。** 選擇器列出全部成員（顯示名稱＋已綁定的
  遮罩身分證），**無預設值、必選**（2026-08-10 裁示：健保與 Apple
  一致，強制每次明確選擇）；內含「＋新增成員」就地建立。健保檔
  於選定成員當下即顯示比對三態提示（見 D2 護欄語意），不符時
  「開始匯入」鈕停用；b1.1 預讀不可得時（既有 header 64KB peek
  的已知限制）面板不顯示提示，由 D2 引擎護欄第二層把關。零成員
  資料庫首次匯入時，選擇器直接呈現新增成員輸入框。
- **方案 2：獨立「選擇成員」前置對話框，確認後再進判型面板。**
  兩步彈窗、操作割裂；上輪 6.3 走查回饋已把歸戶確認從獨立對話框
  收進面板（`import_flow.js` 註解記錄），不走回頭路。
- **方案 3：先匯入暫存區、完成後再指派歸屬。** 需暫存 profile 或
  中繼表，破壞單交易原子性與 UNIQUE(profile_id, ...) 冪等語意，
  複雜度不成比例。
- 防呆設計：確認面板的成員名稱以顯著樣式呈現（Apple 檔無從機器
  驗證歸屬，人眼確認是唯一防線）；匯入完成報告卡標題顯示歸屬
  成員名稱。

### D2: 引擎歸戶介面＝opts.profileId 必填，護欄對「所選成員」驗證

- **方案 A（採用）：adapter `importSource(src, driver, progress,
  opts)` 的 `opts.profileId` 必填**；引擎開頭驗證該 id 存在於
  profiles，否則丟錯（防 UI 與 DB 脫鉤）。移除 getFirstProfile
  自動歸戶、自動建「本人」、`assumeProfile`／`confirmNewProfile`
  參數（建檔職責上移至 GUI 與 profile-management）。
  - 健保護欄三態（對所選成員）：成員 masked_id 為空→匯入時綁定
    檔案 b1.1（綁定前檢查該身分證未綁於其他成員，已綁他人＝選錯
    成員，中止並提示所屬成員，apply 0.2 紅隊補強）；相符→通過；
    不符→中止零寫入（訊息列出兩個遮罩值與成員名稱）。檔案缺
    b1.1 →中止（維持既有行為）。
  - Apple 檔無身分識別：直接歸入所選成員（護欄唯有 D1 的人眼確認）。
  - 跨成員重複檔案：registerSource 命中全庫 sha256 時，訊息附
    原歸屬成員名稱與匯入時間（如「此檔案已於 2026-08-10 匯入至
    成員『本人』」），跳過零寫入。
- **方案 B：profileId 缺省時 fallback 第一個 profile。** 隱性狀態機：
  GUI 忘傳參數會靜默歸錯人且無錯誤可察（效能守衛教訓的同型風險，
  degrade 路徑必須顯性），否決。
- **方案 C：改 adapter 簽名為位置參數 profileId。** 全部 adapter、
  registry、既有測試呼叫面連動改動，收益僅是型式，否決。

### D3: 檢視依人過濾＝provider SQL 層 WHERE profile_id

- **方案 1（採用）：`buildPayload(driver, { profileId, ... })`，
  全部查詢（encounters／medications／labs／reports／immunizations／
  body_measurements／apple_records／apple_workouts／activity／
  measures／sources／counts／date range）加 `profile_id=?` 過濾。**
  payload 結構與 shape.json **不變**，`meta.profile` ＝所選成員
  顯示名稱，前端四分頁元件零改動。counts 中 profiles 一欄維持
  全庫成員數（語意本來就是全庫）。
- **方案 2：payload 照舊全量、前端過濾。** 四分頁元件全要加過濾
  邏輯（違反「元件零改動」既定路徑），且匯出 HTML 會夾帶他人
  個資（違反匯出＝當前成員的裁示），否決。
- 隔離驗收＝**marker 掃描**：建兩成員 fixture 庫（成員 B 全部
  紀錄含唯一 marker 字串，如機構名 `ISOLATION_MARKER_B`），斷言
  成員 A 的 payload 序列化結果**零出現** marker。此法覆蓋「任一
  查詢忘加 WHERE」的整類漏網，優於逐鍵抽查。
- 視角劃分（消除歧義）：**檢視相關介面（四分頁、搜尋、總覽
  狀態列）＝當前成員**；**匯入紀錄卡＝資料庫管理視角**，列出
  全部成員的來源檔案並依成員分組（沿用既有掛載點），不隨切換器
  過濾，資料庫位置等全庫資訊維持原樣。匯入完成報告卡顯示歸屬
  成員名稱，避免「匯給 B 但正在看 A、狀態列數字沒變」的誤解。

### D4: 當前成員狀態＝App 資料目錄 settings.json

- **方案 A（採用）：`settings.json` 存於資料庫同目錄（appDataDir），
  內容 `{ "current_profile_id": <id> }`，以既有 fs plugin 讀寫。**
  讀取失敗、JSON 損毀、id 不存在（成員已刪）一律靜默回退：有成員
  →取 id 最小者；零成員→首啟引導。寫入時機＝每次切換成員。
- **方案 B：localStorage。** WKWebView 的 localStorage 隨 WebView
  資料可被系統清除，且 dev（localhost）與 prod（tauri://）origin
  不同會遺失狀態，否決。
- **方案 C：DB 內 settings 表。** 需 DDL v4＋Python schema.py 同步
  ＋遷移測試，為一個 UI 偏好不成比例，否決。
- settings.json 不含醫療個資：鍵集＝current_profile_id（數字 id）、
  last_open_dir／last_export_dir（走查回饋 R2 新增的對話框目錄記憶，
  屬本機路徑偏好，不進 git、不隨匯出檔外流）。

### D5: 成員刪除＝單一交易逐表 DELETE

- **方案 1（採用）：單一交易內逐表 `DELETE FROM <t> WHERE
  profile_id=?`（encounters、medications、lab_results、reports、
  immunizations、body_measurements、cancer_screenings、
  apple_records、apple_workouts、source_documents），最後刪
  profiles 列。** 中斷即整批回滾（既有交易語意）。零 DDL。
- **方案 2：DDL 加 ON DELETE CASCADE。** 動 schema v4＋Python 同步
  ＋遷移＋rusqlite 橋需確認 foreign_keys pragma 狀態，風險與工作量
  都高於顯式刪除，否決。
- **方案 3：軟刪除（deleted 旗標）。** 個資明文續存於庫，與「本機
  個資最小留存」精神相悖，全部查詢面還要加過濾條件，否決。
- 二次確認 UX：面板顯示成員名稱＋各類筆數（就醫／用藥／檢驗／
  Apple 等），使用者需**輸入該成員顯示名稱**才啟用刪除鈕。
- 刪除連帶 source_documents → 全庫 sha256 釋放，同檔可重新匯入
  給其他成員（歸屬選錯的自救路徑，設計上明確保障）。
- medications 經 encounter_id 關聯但自身也有 profile_id 欄
  （schema 實讀確認），直接以 profile_id 刪除即可，不需 join。

### D6: 等價協定邊界＝nhi-import 歸戶 requirement 由 App 引擎取代

- **方案 1（採用）：Python CLI 與 `nhi-import` spec 的「遮罩身分證
  歸戶」requirement 原樣凍結（單人 oracle 行為）；`app-import-engine`
  的等價 requirement 明文排除該條，改由本輪新增的「匯入歸屬指定」
  requirement 約束。** 其餘 requirements（14 節區解析、調劑日期
  回退、指紋合併、品質旗標等）等價協定不變。
- **方案 2：Python 同步實作多人。** 違反 CLI 凍結原則（v0.3.0
  收尾裁定），且 oracle 複雜化反而削弱驗收公信力，否決。
- **方案 3：parity dump 排除 profiles 表。** 削弱護欄（歸戶錯誤
  正是本輪最需要對帳的面向），否決。
- parity harness 調整：JS 側匯入前**前置建立一個 display_name
  ＝「本人」的成員**並以其 id 傳入 adapter；健保檔匯入會將 b1.1
  綁定至該成員，終態 profiles 列（display_name＋masked_id）與
  Python oracle 自動建檔的結果全等，逐表 dump diff 基準不變。
  Apple-only fixture 同理（oracle 建「本人」無 masked_id）。
- 多人情境（兩成員庫、跨成員重複檔、刪除成員）無 Python oracle，
  以 JS node:test 單元測試覆蓋（含 D3 marker 隔離掃描）。

### D7: 匯入非破壞性護欄（紅隊邊緣測試，2026-08-10 使用者指示）

- 不變量：任何一次匯入（成功、冪等跳過、中止、中途失敗）對資料庫
  的變更 MUST 侷限於：(a) 新增列（本次歸屬成員的資料列與
  source_documents 列）；(b) 白名單既有列變更＝所選成員 masked_id
  首次綁定、指紋碰撞時既有列 quality_flags 追加
  `fingerprint_collision`、本次新建 source_documents 列的
  import_stats 收尾寫入；(c) 其他成員的既有列**逐位元組不變**；
  (d) 中止或失敗＝全庫狀態與匯入前全等（單交易回滾）。
- **方案 1（採用）：before/after 全庫快照 diff＋白名單斷言
  harness。** 匯入前後對全表快照比對，diff 僅允許白名單模式。
  快照機制（apply 0.4 實作修訂）：同庫比對以 id 為鍵保留全列
  （含時間戳），比 parity 跨庫 dump（排除 id/時間戳）更嚴——
  既有列連 imported_at 都不得變；負向自檢以常駐測試落地
  （對既有列注入 UPDATE/DELETE，斷言檢查器必轉紅）。
- **方案 2：只驗「筆數不減、舊筆數不變」。** 漏 UPDATE 型破壞
  （欄位被覆寫時筆數不變），否決。
- **方案 3：只靠既有交易回滾測試。** 涵蓋失敗路徑但不涵蓋
  「成功匯入誤寫既有列」（本護欄的主要標的），否決。
- 對抗矩陣（紅隊邊緣情境，至少七項）：中途例外／kill、歸戶不符
  中止、跨成員重複檔、部分失敗續行、畸形／截斷檔案、同內容紀錄
  分屬兩成員（各自入庫，不得跨成員去重或覆寫）、對既有成員追加
  匯入（增量只加新列，不改既有列）。
- 此護欄同時覆蓋單人時代既有行為（追加匯入不改舊列本來就該
  成立），屬回歸性加固，進 CI 常駐。

## Implementation Contract

- 新模組 `app/src/engine/profiles.js`：
  `listProfiles(driver)`（id 升冪）、
  `createProfile(driver, displayName)`（trim 後非空、與既有名稱
  不重複，違者丟錯）、
  `renameProfile(driver, id, displayName)`（同上檢查）、
  `deleteProfile(driver, id)`（D5 交易逐表清除，回傳各表刪除筆數）、
  `profileCounts(driver, id)`（刪除確認面板用的各類筆數）。
- adapter opts 契約：`{ labEntries, profileId }`；`profileId` 必填，
  引擎驗證存在。移除 `assumeProfile`／`confirmNewProfile`。
- `EngineStore.registerSource` 回傳擴充為 `{ docId, importedAt,
  originProfileId, originDisplayName }`：既有 sha256 命中查詢改為
  JOIN profiles 一次取得原歸屬（未命中時後兩欄為 null），adapter
  據此組裝跨成員重複檔訊息，不另發查詢；既有呼叫端只取前兩欄，
  向後相容。
- `buildPayload(driver, { profileId, knowledgeEntries, drugCachePath,
  today })`：profileId 必填；`meta.profile`＝該成員 display_name。
- settings 模組 `app/src/store/settings.js`：
  `loadSettings(dir)`／`saveSettings(dir, obj)`；loadSettings 為
  純 JSON 解析（不碰資料庫、不驗證 id），損毀容錯回傳 `{}`。
  另提供純函式 `resolveCurrentProfile(settings, profiles)`：
  settings.current_profile_id 存在於 profiles 清單→回傳該 id；
  否則回傳 id 最小成員的 id；零成員→null。id 有效性驗證只發生
  在此函式，`ui/main.js` 於啟動與刪除成員後呼叫。檔名固定
  `settings.json`，與資料庫同目錄。
- UI 狀態：`ui/main.js` 持有 `currentProfileId`，注入 viewer／
  history／import_flow；切換成員→依序刷新狀態列、檢視、紀錄卡。
  header 新增成員切換器（下拉：成員清單＋「管理成員…」入口）；
  零成員時切換器顯示「尚無成員」且檢視頁維持首啟引導。
- 成員管理面板 `ui/profile_manager.js`：清單（名稱＋綁定遮罩
  身分證＋筆數摘要）、新增、改名、刪除（D5 確認流）。
- 匯出檔名：`dashboard_<成員名>_YYYYMMDD-private.html`，成員名
  中檔名不安全字元（`/ \ : * ? " < > |` 與控制字元）代換為 `_`。
- UI 文案用語統一「成員」（不用 profile／使用者／病人）。

## Risks / Trade-offs

- **Apple 檔選錯成員無機器防線**（檔內無身分識別）→ D1 確認面板
  成員名顯著呈現＋報告卡顯示歸屬＋D5 刪除重匯自救路徑；殘餘風險
  接受（與紙本病歷放錯抽屜同級，資料可全量重建）。
- **過濾漏網（新查詢忘加 WHERE）**→ D3 marker 隔離掃描為自動化
  回歸測試進 CI；日後新增查詢面時 marker 測試天然攔截。
- **settings.json 損毀或指向已刪成員** → D4 靜默回退規則＋單元
  測試三案例（缺檔、壞 JSON、失效 id）。
- **刪除誤按** → 名稱輸入式二次確認＋交易原子（中斷零殘留）；
  不做資源回收桶（原始檔皆在，可重匯）。
- **單人使用者體驗退化（多一步選人）** → 接受（裁示「強制每次
  選擇」的直接代價）；選擇器在單成員時仍列該成員，一次點擊完成。
- **走查回饋輪次不可壓縮**（上輪 6.3 四輪回饋）→ 收尾保留使用者
  實機演練 task，UI 細節以演練回饋為準，不在 spec 過度固化。

## Migration Plan

1. 既有單人資料庫：零 schema 遷移。首次以多人版開啟，既有 profile
   （「本人」）直接成為唯一成員並自動選定；使用者可改名。
2. settings.json 不存在＝首次啟動多人版，依 D4 回退規則選定成員。
3. Python CLI 使用者（開發者路徑）：行為不變（單人、自動歸戶）。
4. 無資料庫（全新使用者）：首次匯入時於確認面板就地新增第一位
   成員，取代舊「首次匯入建立本人」自動流程。

## Open Questions

（無阻塞項。成員顏色標識、跨人比較、全家合併匯出列 v2 候選。）
