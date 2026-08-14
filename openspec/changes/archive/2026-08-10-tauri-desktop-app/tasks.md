# Tasks: Tauri 桌面 App（產品化）

## 0. 工具鏈與風險前置實測（design D1 降級路徑判定、Risks: WKWebView/IPC 吞吐）

- [x] 0.1 安裝 Rust toolchain（rustup 標準安裝）與 Tauri CLI，scaffold `app/`（create-tauri-app 或手建：src-tauri＋前端目錄，插件註冊 sql/dialog/fs/path）。行為：`cargo tauri dev` 開出空視窗（繁中標題）。驗證：執行命令截圖視窗；業務邏輯守衛 `rg -n "parse|adapter|schema|fingerprint|knowledge|quality_flag" app/src-tauri/src/` 零命中（此模式即 6.1 CI 守衛的 SSOT，兩處同步）。
- [x] 0.2 WKWebView spike 復驗：把 `docs/spikes/20260809_tauri_js_parse/parse_spike.mjs` 的掃描邏輯移植進 dev App（fs plugin 分塊讀），對 220MB 合成檔實測解析吞吐。行為：App 內解析完成並顯示筆數與耗時。驗證：耗時 <30s 且筆數＝Node 版結果（640000）；結果記入 `docs/verification/g3_task0.md`。
- [x] 0.3 tauri-plugin-sql 批寫實測：經 StoreDriver 雛形單交易批次（每批 500）寫入 10 萬筆合成 apple_records。行為：完成並回報耗時；中途 kill App 後重開資料庫為空（交易回滾）。驗證：耗時 <10s；kill 演練截圖與筆數 0 查詢。**0.2/0.3 任一不過門檻 → 停下，依 design D1 降級路徑（瓶頸段下沉單一 Rust command）修訂 design 後再續**。（結果：0.2 首跑 1.73s、0.3 經 json_each 策略修訂 2.2s，均過門檻，降級路徑未啟動；詳 docs/verification/g3_task0.md）

## 1. JS store 層（design D2 儲存抽象、D5 資料庫定位）

- [x] 1.1 定義 StoreDriver 介面與 node:sqlite 實作（execute/select/batchInsert/transaction；batchInsert 走 json_each（design D2 修訂））。行為：`node --test app/tests/store/` 全綠。驗證：node:test 覆蓋四方法＋交易回滾案例。
- [x] 1.2 schema v3 DDL 移植（自 src/store/schema.py，含 MIGRATIONS 前向遷移）。行為：JS 初始化空庫。驗證：node:test 比對 Python 與 JS 空庫的正規化 schema dump（`sqlite3 .schema` 排序、去空白）全等；遷移測試：v2 庫經 JS 開啟自動升 v3。
- [x] 1.3 tauri driver 實作（tauri-plugin-sql 版 StoreDriver，同介面）。行為：dev App 內跑一次 smoke（建庫、批寫、查詢）。驗證：App 內 smoke 輸出與 node driver 相同結果；引擎模組為同一份檔案（import 路徑檢查，非複製）。
- [x] 1.4 資料庫定位與首啟（appDataDir、環境變數覆寫、首啟建空庫、「匯入既有資料庫檔」複製＋版本檢查）。行為：首啟顯示「尚無資料」；選 CLI 舊庫完成遷移；選高版本庫被拒。驗證：node:test 版本判定邏輯；App 內三情境手測記錄（app-shell spec 三 scenario）。

## 2. JS adapters（design D7 註冊制、D3 數值契約；specs: app-import-engine）

- [x] 2.1 adapter 註冊表與內容判型框架（detect(header,name)/import(source,store,progress)；假 adapter 注入測試）。行為：改名 .txt 的健保 JSON 仍被正確判型。驗證：node:test 判型矩陣（各 fixture × 各 adapter）＋假 adapter 擴充點案例。
- [x] 2.2 嚴格數值解析函式（完整字串合法才算數字，行為對齊 Python float()；畸形值視為文字）。行為：「12abc」入 value_text。驗證：node:test 畸形值表（含 Python 對照表註記）。
- [x] 2.3 NHI JSON adapter（14 節區、大小寫正規化、無資料佔位、unknown 欄位 extra_json、調劑日期回退、巢狀醫囑對帳、遮罩身分證歸戶防護、檔案指紋防重複、部分失敗續行）。行為：匯入既有 nhi fixture 結果同 Python。驗證：node:test 逐 requirement 案例（沿用既有 fixture）；差分留給 3.1 全集跑。
- [x] 2.4 Apple adapter（zip/DecompressionStream＋cp437 中文檔名、資料夾、單一 XML、內容判型、WANTED 型別、來源別單位規則、epoch/離群旗標、檔內去重、Workout）。行為：匯入 apple fixture 結果同 Python。驗證：node:test 逐案例；220MB 合成檔於 Node 跑分塊上限斷言（記憶體峰值 <500MB）。
- [x] 2.5 NHI XML adapter（r1-r8 欄位對照移植、r8 換行保留、r9-r14 標記 no_data 註明格式事實）。行為：匯入 XML fixture 入庫。驗證：node:test；同批 JSON/XML 交叉對帳（真實同批檔本機跑、fixture 同批對進 CI），白名單僅 r8 換行。
- [x] 2.6 知識 join 與增量品質報告 JS 版（resources 隨 bundle 的 tauri.conf 配置於 6.1 建置時落地）（drug_items.sqlite 與建置期轉出的 labs.json 以 tauri resources 配置隨 bundle、App 內以 resource path 解析、唯讀 ATTACH join；非結論式用語禁用詞以 `src/knowledge/forbidden.py` 清單為 SSOT、CI grep 由其產生涵蓋 app/ 前端文案、報告結構同 Implementation Contract）。行為：匯入後報告卡資料齊全。驗證：node:test 報告 schema 欄位齊全順序固定；禁用詞 CI grep 涵蓋 app/ 前端文案。

## 3. 差分對帳 harness（design D3；specs: app-import-engine 等價協定）

- [x] 3.1 parity harness（run_parity.mjs：同輸入 → Python CLI 庫 vs JS node driver 庫 → 逐表排序 dump diff，dump 規則依 design Implementation Contract：排除 imported_at、外鍵解析為參照列自然鍵再比；含品質報告 JSON 對比）。行為：fixture 全集 PASS。驗證：`node --test app/tests/parity/` 全綠進 CI；任一 diff 非空 exit 非零。
- [x] 3.2 真實資料本機演練：範圍＝`data/raw/` 現存全部健保 JSON＋XML，加上本機的 Apple 匯出資料夾（含百 MB 量級的輸出.xml，2026-08-09 實測存在）；以上經 Python 與 JS 各建新庫對帳，並與現行 `data/mhb.sqlite`（schema v3 生產庫）筆數對照。行為：全表全等或差異均可具名解釋。驗證：演練摘要記入 `docs/verification/g3_parity_real.md`（僅統計數字，無個資）；結果不進 git 的部分僅限中間庫檔。

## 4. 匯入 GUI（specs: app-import-gui）

- [x] 4.1 選檔/拖放＋判型確認流（dialog plugin、drop 事件、不支援檔案顯示格式清單）。行為：拖入健保 JSON 顯示判型確認；拖入圖片顯示格式清單。驗證：App 內手測兩情境；判型路由 node:test 已覆蓋。
- [x] 4.2 進度與結果報告卡（progress 事件 → 百分比；完成 → 增量報告卡：節區筆數、新增/跳過、品質旗標、未對照提示；匯入中防重入）。行為：220MB 合成檔顯示連續進度；完成出報告卡。驗證：App 內實測；報告數字與 CLI 增量報告一致（同檔對照）。
- [x] 4.3 防護情境 UX（重複檔提示原匯入時間、歸戶不符顯示雙方遮罩值零寫入、部分失敗續行成功/失敗節區明細可展開）。行為：三情境各自呈現正確訊息。驗證：以 fixture 構造三情境 App 內手測；零寫入以筆數查詢佐證。

## 5. 檢視器遷移（design D4；specs: app-viewer）

- [x] 5.1 DataProvider（SQL 組裝同構 JSON、shape.json 契約、聚合規則沿用既有 spec）。行為：provider 輸出通過 shape.json。驗證：node:test 對同一 fixture 庫比對 provider 輸出 vs Python embed 輸出數值全等。
- [x] 5.2 app.js 四分頁＋搜尋遷入（互動逐項走查於 6.3 使用者演練實機確認）（provider 抽換、匯入完成自動刷新）。行為：開 App 即見最新資料；匯入後不重啟自動更新。驗證：dashboard-generator spec scenario 清單逐項走查記錄（含篩選連動、三分類、時間軸、雙向跳轉、搜尋跳轉、匯入紀錄卡）。
- [x] 5.3 單檔 HTML 匯出（provider 資料序列化進既有模板、預設存文件目錄）。行為：匯出檔於瀏覽器開啟與 App 顯示一致。驗證：匯出檔 vs `mhb rebuild` 產出資料 JSON 數值全等（時間戳除外）。

## 6. 建置與收尾（design D6；specs: app-shell 雙平台/個資防線）

- [x] 6.1 GitHub Actions matrix（2026-08-10 首跑全綠：test＋雙平台建置，artifacts win 10.6MB/mac 12.9MB；本機 release bundle 驗證個資零命中）（macos-latest/windows-latest、官方 tauri-action、artifacts 上傳；CI 跑 node:test 全集＋parity fixture 全集＋禁用詞/業務邏輯守衛 grep）。行為：push 後雙平台安裝包產出。驗證：CI 綠燈；workflow 定義 `rg 'data/'` 零命中；bundle 內容清單無個資（產物解包抽查）。
- [x] 6.2 Windows 實機冒煙 → **未執行，轉列 backlog（分發他人前必做）**：CI Windows 建置已綠（artifact 10.6MB）、實機無從取得；2026-08-10 使用者裁示先收尾。
- [x] 6.3 macOS 實機日常演練（2026-08-10 使用者完成：健保 JSON/XML＋Apple 真檔匯入正常、檢視正常；四輪回饋全修：指紋階段進度、滿版版面、歸戶面板化、雙分頁、XML 標籤、紀錄卡、文案白話、視覺打磨）（使用者真實流程：遷移既有庫、匯入當月下載、檢視、匯出 HTML 給 iPad）。行為：取代 CLI 的每月例行。驗證：演練勾註；README/CHANGELOG 更新（0.3.0，Python CLI 標註開發者路徑與凍結範圍）。
