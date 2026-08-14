# Tasks: 多人資料管理

## 0. 引擎層：成員 API 與歸戶介面（design D2、D5、D6；specs: app-import-engine、health-database、profile-management）

- [x] 0.1（2026-08-10 完成：TDD 7 測試綠、subagent review 0C0W）新增 `app/src/engine/profiles.js`（listProfiles／createProfile／renameProfile／deleteProfile／profileCounts，命名與檢查規則依 design Implementation Contract：trim 非空、不重名；deleteProfile 單交易逐表 DELETE 十表＋profiles，回傳各表刪除筆數）。行為：`node --test app/tests/engine/profiles.test.mjs` 全綠。驗證：node:test 覆蓋新增／重名阻擋（含前後空白）／改名／刪除連帶十表清除／刪除中斷回滾（交易內丟錯後全表筆數不變）／刪除後 sha256 釋放（同檔 registerSource 可再插入）。
- [x] 0.2（2026-08-10 完成：7+5 測試綠、subagent review 0C；紅隊補強＝綁定衝突護欄進 spec） adapter 歸戶介面改造：`nhi_json.js`（含 XML 共用核心）與 `apple_health.js` 改為 `opts.profileId` 必填＋開頭驗證存在；移除 getFirstProfile 自動歸戶、自動建「本人」、assumeProfile／confirmNewProfile；健保護欄三態改對所選成員（空→綁定、符→過、不符→AbortImport 零寫入、缺 b1.1→中止）；`EngineStore.registerSource` 回傳擴充為 `{ docId, importedAt, originProfileId, originDisplayName }`（sha256 命中查詢 JOIN profiles 一次取得，未命中後兩欄 null，既有呼叫端向後相容），adapter 據此組裝跨成員重複檔訊息（不另發查詢）。行為：`node --test app/tests/adapters/` 全綠。驗證：node:test 案例矩陣＝app-import-engine spec「匯入歸屬指定」四個 scenario（護欄阻擋／首次綁定／缺 profileId 即錯／跨成員重複檔）逐一對應，另含既有 adapter 測試全數改用顯式 profileId 後回歸全綠。
- [x] 0.3（2026-08-10 完成：fixture 全集 parity 綠、profiles 表終態全等）parity harness 調整（design D6）：`app/tests/parity/` JS 側匯入前建立顯示名稱「本人」的成員並傳其 id；健保 fixture 驗證終態 profiles 列（display_name＋masked_id）與 Python oracle 全等。行為：fixture 全集 parity PASS。驗證：`node --test app/tests/parity/` 全綠（dump 含 profiles 表，基準不變）；CI 綠。

- [x] 0.4（2026-08-10 完成：10 測試綠含常駐負向自檢；快照機制修訂記於 design D7）匯入非破壞性紅隊 harness（design D7；specs: app-import-engine「匯入不破壞既有資料」）：`app/tests/engine/nondestructive.test.mjs`，dump 規則複用 parity 工具；建兩成員基線庫→snapshot 全表排序 dump→執行 D7 對抗矩陣七情境（中途例外／歸戶不符中止／跨成員重複檔／部分失敗續行／畸形截斷檔／同內容分屬兩成員／既有成員追加匯入）→逐表 diff 斷言僅白名單變更（新增列、masked_id 首次綁定、碰撞列 quality_flags 追加、新 doc 的 import_stats），他成員既有列逐位元組不變、中止情境全庫全等。行為：`node --test` 全綠進 CI。驗證：負向自檢一次（暫時注入一個對既有列的 UPDATE，測試必轉紅，記錄於 test 註解後移除）。

## 1. Provider 與檢視過濾（design D3；specs: app-viewer、health-database）

- [x] 1.1（2026-08-10 完成：provider parity 4/4、單成員輸出與 Python embed 全等）`provider/payload.js`：`buildPayload` 增必填 `profileId`，全部查詢（encounters／medications／labs／reports／immunizations／nhi_body／activity／measures／workouts／date range）加 `profile_id=?`；`meta.sources` 僅列當前成員的來源檔案（HTML 匯出不得夾帶他人檔名）；`meta.counts` 各資料表過濾至當前成員、**唯 profiles 一欄維持全庫成員數**；`meta.profile`＝該成員 display_name。行為：單成員庫 provider 輸出與改造前一致。驗證：既有 provider parity 測試（vs Python embed）帶 profileId 後全綠；shape.json 驗證通過；新增斷言 counts.profiles＝全庫成員數、sources 無他人檔名。
- [x] 1.2（2026-08-10 完成：3 測試綠；負向自檢實測＝拔 labs WHERE 轉紅後復原）多成員隔離 marker 測試：建兩成員 fixture 庫（成員 B 全部紀錄之機構名含 `ISOLATION_MARKER_B`，覆蓋健保與 Apple 全表），斷言成員 A 的 payload 序列化字串零出現 marker、成員 B 的 payload 含 marker 且零出現成員 A 紀錄。行為：`node --test app/tests/provider/isolation.test.mjs` 全綠。驗證：故意註解掉任一查詢的 WHERE 過濾時測試必轉紅（負向自檢一次，記錄於 test 註解）。
- [x] 1.3（2026-08-10 完成：狀態列帶成員名依人計數、紀錄卡依成員分組；分組純函式 2 測試綠、實機走查確認）`ui/main.js` 狀態列與 `ui/history.js` 視角劃分（design D3）：狀態列 tableCounts 加 profile 過濾（顯示當前成員筆數）；匯入紀錄卡維持全庫視角、依成員分組列出全部來源檔案（掛載點落地，不隨切換器過濾），資料庫位置維持全庫資訊。行為：切換成員後狀態列數字隨之改變、紀錄卡分組不變。驗證：兩成員 fixture 庫 App 內手測對照 SQL 直查數字一致；history 分組邏輯抽純函式 groupDocsByProfile 以 node:test 斷言（DOM 呈現走實機走查；Jenny 稽核修正聲明）。

## 2. 成員切換與管理 UI（design D1、D4、D5；specs: profile-management、app-viewer）

- [x] 2.1（2026-08-10 完成：4 測試綠含判定矩陣）`store/settings.js`：loadSettings（純 JSON 解析不碰資料庫，損毀容錯回傳 `{}`）／saveSettings／純函式 `resolveCurrentProfile(settings, profiles)`（id 有效→用之；否則 id 最小成員；零成員→null；id 有效性驗證只在此函式，main.js 於啟動與刪除成員後呼叫）。行為：`node --test app/tests/store/settings.test.mjs` 全綠。驗證：node:test 三回退案例（缺檔／壞 JSON／失效 id）＋寫入後重讀一致＋resolveCurrentProfile 純函式判定矩陣。
- [x] 2.2（2026-08-10 完成：切換/刷新/settings 記憶；走查三輪確認，成員異動連動修正）header 成員切換器：下拉列全部成員＋「管理成員…」入口；切換→saveSettings→依序刷新狀態列與 viewer（匯入紀錄卡為全庫視角不隨切換過濾）；零成員顯示「尚無成員」且檢視頁維持首啟引導；被刪成員為當前時依 2.1 規則回退。行為：兩成員庫切換即時刷新（app-viewer「切換即刷新」scenario）。驗證：App 內手測 scenario 清單（切換刷新／匯入他人不動當前檢視／重啟保留／失效回退）；切換器選項與 profiles 表一致以實機走查確認（refreshSwitcher 為 main.js 閉包，無自動化測試；Jenny 稽核修正聲明）。
- [x] 2.3（2026-08-10 完成：新增/改名/刪除名稱確認實機走查；回饋修正＝異動後清匯入面板；進階區收納資料庫檔匯入）`ui/profile_manager.js` 管理面板：成員清單（名稱＋遮罩身分證＋profileCounts 筆數摘要）、新增、改名、刪除（顯示筆數＋輸入成員名稱才啟用刪除鈕，呼叫 deleteProfile）。行為：profile-management spec 全部 scenario 於 App 內成立。驗證：App 內手測（新增／重名阻擋／改名即時反映／刪除連帶＋名稱不符不啟用／刪除後同檔重匯）；刪除後切換器、匯入面板選項同步以手測確認。

## 3. 匯入 GUI 歸屬選擇（design D1；specs: app-import-gui）

- [x] 3.1（2026-08-10 完成：必選無預設/就地新增/三態提示；三態純函式 2 測試綠、實機走查含首次建成員與歸屬選擇）`ui/import_flow.js` 判型確認面板整合成員選擇器：無預設必選（未選時「開始匯入」停用）、選項列成員名稱＋已綁定遮罩身分證、「＋新增成員」就地建立並自動選定、零成員時直接呈現新增輸入框；所選成員名稱顯著樣式；健保檔選定成員即時顯示三態提示（將綁定／相符／不符停用），面板 b1.1 預讀沿用既有 header peek。行為：app-import-gui「匯入歸屬選擇」三個 scenario 成立。驗證：App 內手測三 scenario；runImport 傳遞 profileId 至 adapter 以讀碼確認（import_flow.js runImport 的 importSource 呼叫）＋實機走查；面板接線無自動化測試（Jenny 稽核修正聲明）。
- [x] 3.2（2026-08-10 完成：報告卡標題帶歸屬成員實機確認；跨成員重複與不符訊息由引擎測試矩陣覆蓋、GUI 呈現沿用訊息直出）防護與報告呈現更新：跨成員重複檔訊息（原歸屬成員＋時間）、歸戶不符訊息（成員名稱＋雙方遮罩值）、報告卡標題顯示歸屬成員名稱；`friendlyError` 覆蓋新錯誤形態（缺 profileId 屬程式錯誤，訊息歸「匯入失敗」類）。行為：app-import-gui「防護情境的使用者呈現」三個 scenario 成立。驗證：以 fixture 構造三情境 App 內手測；零寫入以筆數查詢佐證。

## 4. 匯出與收尾（design D3、Risks；specs: app-viewer）

- [x] 4.1（2026-08-10 完成：檔名純函式 3 測試綠；匯出內容＝當前成員 payload 由 marker 隔離測試覆蓋；實機匯出確認有內容且標題帶成員名）HTML 匯出＝當前成員：`ui/viewer.js` exportHtml 檔名改 `dashboard_<成員名>_YYYYMMDD-private.html`（不安全字元代換 `_`，代換函式單元測試）；匯出內容即 provider 當前成員 payload。行為：兩成員庫檢視「媽媽」匯出，檔案僅含其資料。驗證：isolation.test.mjs「匯出檔層級隔離」對 assemble() 完整 HTML 跑 marker 掃描零出現另一成員（Jenny 稽核後補實）；單成員庫匯出與 `mhb rebuild` 資料 JSON 全等（時間戳除外）回歸。
- [x] 4.2（2026-08-10 完成三輪回饋全修：R1 遮罩罩死畫面（hidden 全域護欄）；R2 刪成員後報告卡殘留/對話框目錄記憶＋資料夾下潛/檢視空白（未再現，錯誤上浮已建）；R3 文案五項＋資料庫檔匯入降級進階區。沙盒 dev App 演練，正式資料演練待 release build）使用者實機演練（macOS）：真實流程走查（既有庫開啟見「本人」、改名、新增家人成員、匯入家人健保檔選歸屬、切換檢視、匯出單人 HTML、刪除測試成員），回饋逐輪修正（上輪慣例）。行為：多成員日常流程順暢。驗證：演練勾註記錄；回饋修正項列於本檔勾註。
- [x] 4.3（2026-08-10 完成：CHANGELOG 0.4.0、README 多成員段落、handoff 更新、版本四處一致 68f09c3；QA 三連與 CI 見結案報告）文件與版本收尾：README（多成員操作說明）、CHANGELOG 0.4.0、`docs/20260810_handoff.md` 的下一輪段落更新；CI 全綠（node:test 全集＋parity＋既有守衛）。行為：push 後 CI 綠。驗證：CI 連結記錄；QA 收尾三連（/task-completion-validator → /Jenny → /karen）依全域慣例於 apply 完成後執行。
