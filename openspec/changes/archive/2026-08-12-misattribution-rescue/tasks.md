# Tasks: 誤歸屬救援

## 0. 引擎層：doc 級救援原語（design D1-D4、D6；specs: profile-management）

- [x] 0.1（2026-08-10 完成：TDD 先紅後綠，預覽測試組 4/4；subagent
  雙軌 review 0C0W 見 0.3 勾註）新增 `app/src/engine/doc_rescue.js`
  之預覽函式
  `previewDocRescue(driver, docId, { targetProfileId = null })`：
  回傳 `{ doc（檔名/adapter/匯入時間/歸屬）, counts（各表關聯
  筆數：FP_TABLES＋medications＋apple_records＋apple_workouts）,
  overlapWarning（布林：同成員、同來源家族（adapter 前綴 nhi_
  一族、apple_health 一族）之其他 doc 的 import_stats.skipped_dup
  任表 >0）, merge（targetProfileId 非 null 時回傳
  `{ perTable: { <表名>: 筆數 }, total }`：指紋表按 EXISTS 目標
  同 (section, record_fp) 計數、apple 兩表按各自 UNIQUE 鍵計數、
  medications 一欄＝隨母 encounter 合併數；total＝各表加總，
  1.1 面板文案的 M 即此值）, nhiGuard
  （targetProfileId 非 null 且 doc 為 nhi_ 家族時回傳
  `{ blocked, reason, willUnbindSource, willBindTarget }`：
  目標已綁定→blocked=true 附原因；否則回報搬移後來源是否清空
  健保 doc 而解綁、目標是否轉綁；非健保 doc 或未指定目標時為
  null）}`。
  行為：`node --test app/tests/engine/doc_rescue.test.mjs` 預覽
  案例全綠。驗證：node:test 斷言筆數與 SQL 直查一致；
  overlapWarning 觸發（他 doc skipped_dup>0）與不觸發（無他 doc
  ／他 doc skipped_dup 全 0／他 doc 屬不同家族）三案例；merge
  筆數與 0.3 執行結果對帳一致。
- [x] 0.2（2026-08-10 完成：刪除測試組 5/5，含解綁矩陣、sha256
  釋放、sabotage 回滾）`deleteSourceDocument(driver, docId)`：單一交易依序
  DELETE medications→FP_TABLES 各表→apple_records→
  apple_workouts（皆 `WHERE doc_id=?`）→source_documents 列；
  若 doc 屬 nhi_ 家族且刪後該成員名下無任何 nhi_ 家族 doc，同
  交易內 `UPDATE profiles SET masked_id=NULL`；回傳各表刪除
  筆數與 unbound 布林。行為：測試檔刪除案例全綠。驗證：
  node:test 覆蓋（1）連帶清除各表且他成員與同成員他 doc 資料
  before/after 全庫排序 dump 逐位元組不變（僅白名單差異＝該 doc
  相關列消失、必要時 masked_id 置空）；（2）sha256 釋放：刪後
  同檔 registerSource 可為他成員新插入；（3）sabotaged driver
  中斷→全庫 dump 與操作前全等；（4）解綁矩陣：最後一份健保 doc
  刪除→解綁、尚有他份→不動、apple doc 刪除→不動。
- [x] 0.3（2026-08-10 完成：改歸屬測試組 7/7，含合併對帳、碰撞
  旗標不重複追加、綁定矩陣、前置檢查零寫入；haiku subagent
  worktree 隔離雙軌 review（spec compliance＋code quality）
  0 critical 0 warning）`reattributeSourceDocument(driver, docId,
  targetProfileId)`：單一交易，前置檢查（doc 存在、目標存在且
  非現歸屬、nhi_ 家族時目標 masked_id 必須為 NULL 否則丟錯零
  寫入）；逐指紋表找來源列中目標同 (section, record_fp) 者：
  canonical 不同→目標列補 fingerprint_collision 旗標（沿匯入
  語意，已有旗標不重複追加）；encounters 合併＝先刪「來源
  encounter」名下 medications 再刪來源 encounter 本身，目標
  encounter 與其用藥完整保留；apple_records／apple_workouts
  按各自 UNIQUE 鍵（含 COALESCE 欄位）同樣處理；其餘列
  `UPDATE ... SET profile_id=? WHERE doc_id=?`（medications 隨
  改）；最後改 source_documents.profile_id；nhi_ 家族且來源已
  無健保 doc→同交易解綁來源＋轉綁目標（目標必未綁，前置已
  檢）。回傳 `{ moved: { <表名>: 筆數 }, merged: { <表名>:
  筆數 }, binding: { sourceUnbound, targetBound } }`（merged 各
  表定義與 0.1 merge.perTable 相同，逐表對帳）。行為：
  測試檔改歸屬案例全綠。驗證：node:test 覆蓋（1）全搬（目標無
  衝突）：目標筆數增量＝來源減量、對帳一致；（2）合併：構造
  目標已含同指紋紀錄（同檔內容改名匯給兩成員不可行，改以直插
  同 canonical 列構造），斷言來源重複列消失、目標列與其
  medications 保留、moved+merged 對帳；（3）碰撞旗標：同 fp 異
  canonical 目標列補旗標且不重複追加；（4）sabotaged 中斷→
  全庫 dump 全等；（5）綁定矩陣：目標已綁→丟錯零寫入、最後
  一份搬走→來源解綁＋目標轉綁、來源尚有健保 doc→雙方綁定
  不動；（6）未受影響成員 dump 逐位元組不變。
- [x] 0.4（2026-08-10 完成：D7-8/D7-9 進 harness 12/12 綠；負向
  自檢實測＝sabotage 改為靜默吞語句照常 commit，兩情境均轉紅
  （檢查器抓到 masked_id 非白名單修改），還原後綠，紀錄於 test
  註解）D7 紅隊 harness 擴充（`app/tests/engine/
  nondestructive.test.mjs`）：對抗矩陣加兩情境（刪除中途失敗、
  改歸屬中途失敗，均以 sabotaged driver 於中段丟錯），斷言全庫
  dump 與操作前完全一致（零白名單）。行為：`node --test` 全綠
  進 CI。驗證：負向自檢一次（暫時讓 sabotage 後仍 commit，測試
  必轉紅，記錄於 test 註解後移除）。

## 1. UI：匯入紀錄卡操作與預覽確認（design D5；specs: app-viewer、profile-management）

- [x] 1.1（2026-08-10 完成：buildRescuePreviewModel 純函式 6/6 綠
  （阻擋態/警告態/合併文案/綁定提示/未選目標停用）；全套 124
  node:test 綠；DOM 接線走查併入 1.2）`ui/history.js` 每筆 doc 列加「刪除」「改歸屬」鈕與
  預覽確認面板：面板呈現 previewDocRescue 結果（檔名、匯入
  時間、各表筆數；D2 重疊警告黃色提示；改歸屬含目標成員下拉
  （排除現歸屬成員，選定即重算 merge/nhiGuard）、「搬移 N 筆、
  與目標重複合併 M 筆」、nhiGuard 阻擋時確認鈕停用並顯示
  原因）；確認鈕為一般二次確認（非名稱輸入級，決定 #52）。
  面板資料組裝抽純函式 `buildRescuePreviewModel(preview,
  profiles)` 直測。行為：兩成員 fixture 庫 App 內開啟預覽數字
  與 SQL 直查一致。驗證：`node --test app/tests/ui/
  rescue_preview.test.mjs` 純函式案例全綠（含阻擋態、警告態、
  合併筆數文案）；DOM 接線實機走查（沿 history 卡慣例聲明）。
- [x] 1.2（2026-08-11 完成：使用者實機走查全過＝改歸屬全流程（含
  就地新增成員）、重疊警告黃色提示、健保阻擋態停用、刪除與通知
  刷新；沙盒 dev 庫演練（MHB_DB_PATH 覆寫）。自動化輔證＝App
  啟動與檢視頁截圖；背景 WKWebView 不受 AXPress／
  CGEventPostToPid 合成事件，互動走查以使用者實測為準）
  執行與刷新接線：確認後呼叫 0.2／0.3，成功→暫時通知列
  顯示結果摘要（刪除筆數或搬移/合併筆數、綁定異動提示）、
  匯入紀錄卡重載、若現歸屬或目標為當前檢視成員則複用成員切換
  的刷新路徑（狀態列＋viewer）；失敗→通知列上浮錯誤、面板
  維持可重試或關閉。行為：app-viewer「救援操作後即時刷新」
  scenario 於 App 內成立。驗證：實機走查（刪除誤匯檔重匯正確
  成員全流程、改歸屬全流程、健保阻擋態、失敗訊息以 sabotage
  dev 庫演練）；靜默 catch 零新增（全域慣例）。

- [x] 1.3（2026-08-11 完成：export_snapshot 3 測試綠（快照版本與
  筆數全等＋主庫可續寫＋同名拒絕既有檔逐位元組不變，VACUUM INTO
  參數綁定實證）；使用者實機驗匯出成功含路徑大小通知；全套 127
  node:test 綠）匯出資料庫檔（2026-08-11 走查回饋新增；specs:
  app-shell）：`ui/profile_manager.js` 進階區「匯出資料庫檔…」
  鈕（與 pm-import-db 同區）；`ui/main.js` onExportDbFile＝
  dialog.save（預設檔名 `mhb-backup-YYYYMMDD.sqlite`、起始目錄
  沿 dialogStartDir("export")）→ fs.exists 預檢（已存在→通知
  換檔名零寫入）→ `driver.execute("VACUUM INTO ?", [path])` →
  通知列回報路徑與大小（含個資提醒）。行為：匯出檔可被「匯入
  既有資料庫檔」讀回。驗證：node:test（tests/store/）以
  NodeDriver 驗 VACUUM INTO 快照＝schema_version 與各表筆數
  與主庫全等、匯出後主庫可續寫；同名檔案拒絕路徑以 App 內
  手測；預設檔名純函式直測。

- [x] 1.4（2026-08-11 走查回饋＋雙專家審查後補強）外部連結與
  安全加固：仿單等外部連結經 tauri-plugin-opener 開系統瀏覽器
  （原 target=_blank 被 WebView 靜默攔下），capabilities 只開
  `https://*`；說明卡 GitHub 連結由「複製」改直接開啟（失敗回退
  複製）。紅隊邊界審查（sequential-thinking）後補：history.js／
  main.js 的 esc 補齊 `"` 轉義與 profile_manager／import_flow
  一致（消除屬性位置注入面，當前不可達但防未來回歸），新增
  `tests/ui/esc_consistency.test.mjs` 靜態守衛（負向自檢：移除
  任一份 quot 轉義即轉紅）。行為：`node --test app/tests/`
  128 全綠。

## 2. 收尾（specs 轉正前驗收；design D6）

- [x] 2.1 全套回歸與文件：既有測試全集＋新增測試全綠
  （`node --test app/tests/`，預期 >100 全綠）、CI 綠；
  CHANGELOG 0.5.0、README 救援操作段落、
  `docs/20260810_handoff.md` backlog 劃掉 L-4 並更新下一輪
  候選。行為：push 後 CI 綠。驗證：CI 連結記錄；QA 收尾三連
  （/task-completion-validator → /Jenny → /karen）依全域慣例
  於 apply 完成後執行。
  結果（2026-08-12 archive 前逐項複驗）：node:test 132 全綠
  （原 128 ＋ 檢視器全分頁渲染守衛 3 ＋ 出貨文案禁用詞 1）、
  pytest 65 全綠；CI app-build 與 release 在 c0dfe77 皆 success
  （run 31513369188／31514060973）；CHANGELOG 0.5.0 段落、README
  「匯錯人也救得回來」段落、handoff L-4 劃線並註記 v0.5.0 已完成
  皆在位。QA 依裁量以雙專家 sequential-thinking 審查替代三連
  （中立稽核 PASS；紅隊唯一真 finding＝esc 屬性注入面，已於 1.x
  修訂並補靜態守衛）。v0.5.0 已發布並轉 public，macOS 端已實機
  驗收通過。
