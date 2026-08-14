# QA 收尾紀錄：multi-profile-management（v0.4.0，2026-08-10）

三連審計（validator → Jenny → Karen，各自獨立 fresh-context 執行）
與全部修正的追溯紀錄。最終狀態：node:test **100/100**、pytest oracle
65/65、CI 雙平台建置綠（見各 commit 對應 run）。

## Task Completion Validator

- 判定：發現 1 項後 APPROVED
- 發現與修正：Cargo.toml/Cargo.lock 版本仍 0.3.0（其餘三處已 0.4.0）
  → 補正並重建 lock（commit 68f09c3）
- 佐證：placeholder 掃描零命中（僅 UI input placeholder 屬性）、
  97/97 當下重跑、走查以真實資料進行（狀態列顯示數十萬筆）

## Jenny（規格合規）

- 判定：NON-COMPLIANT（輕度）→ 修正全數落地（commit f97dab8）
- Critical：0。主要發現與修正：
  1. **健保跨成員重複檔走不到 spec 的「跳過＋原匯入時間」路徑**
     （歸戶護欄先於重複檔判定）→ 重複檔判定移到護欄之前（同交易，
     中止仍整批回滾）；D7-3 斷言由雙狀態放寬收緊為單一狀態；
     補健保跨成員重複專屬測試
  2. tasks.md 四處「以單元測試斷言」聲明查無測試 → 一處補實
     （匯出檔層級 marker 掃描，對 assemble() 完整 HTML）、三處
     改標「實機走查＋讀碼」如實記錄
  3. viewer.js regex 含裸 NUL/控制位元組致 git 視為 binary
     （diff 不可審查）→ 改為反斜線 u0000 至 u001f 的轉義寫法
     （附註：本收尾文件初稿也踩了同一個 Write 陷阱，寫控制字元
     一律用文字描述不用原始位元組）
  4. settings.json 實際鍵集超出 design D4 宣告 → design/spec 回寫
     （current_profile_id＋目錄記憶兩鍵，不含醫療個資）
  5. FK pragma 兩側不一致（NodeDriver ON、App 橋未開）→ 判定非缺陷
     （刪除順序 FK-safe），記 backlog
- 逐條對照：11 requirements / 24 scenarios，修正後全數有落點

## Karen（現實檢核）

- 判定：有條件能 → 必修三項全數落地並實測（commit d9eae62）
- **CRITICAL-1（手測抓不到的出貨炸彈）**：capabilities 的
  fs:allow-write-text-file 僅允許 /tmp，正式資料路徑下 settings.json
  永遠寫不進去且被 `.catch(()=>{})` 吞掉——「當前成員跨啟動記憶」
  在出貨環境必定靜默失效；dev 走查因 MHB_DB_PATH 指向 /tmp 而全綠。
  修正：capabilities 加 $APPDATA 寫入、移除靜默 catch 改通知列上浮、
  boot 開機落章（首啟即寫入，失敗立刻可見）。
  **驗收實測**：無覆寫啟動 dev App（同一份編譯 ACL），
  `~/Library/Application Support/com.notoriouslab.myhealthbank/settings.json`
  確實落地（內容 `{"current_profile_id": 1}`），修正前同路徑實測不存在。
- HIGH-1：數十萬筆下切換成員有 2-3 秒「新成員標籤配舊成員病歷」
  錯配窗 → viewer.refresh 先遮舊內容顯示「正在載入資料…」
- HIGH-2：匯出失敗完全靜默 → try/catch＋通知列訊息（含 no_data 情境）
- MEDIUM-1：零成員首匯建成員後取消 → header/狀態列不一致且下拉卡死
  → onProfilesChanged 在 currentProfileId 為 null 時立刻收斂
- MEDIUM-2：成員名稱零上限外溢匯出檔名（>255 bytes 必失敗且靜默）
  → 30 字上限（createProfile/renameProfile 同擋，spec 同步）＋測試
- 獨立複驗（Karen 自建變異）：isolation marker 護欄 4 次拔 WHERE
  全數轉紅；數十萬筆效能實測（切換計數 18ms、刪十萬筆量級的成員 204ms、
  buildPayload 2.6s→即 HIGH-1 的載入遮罩依據）
- 轉 backlog（已記入 docs/20260810_handoff.md）：誤歸屬救援路徑
  （L-4，唯一可能永久資料遺失的情境，下輪優先）、名稱 NFC 正規化、
  id 重用注意、fs read scope 收斂＋CSP（既存）、FK pragma、
  生產孤兒列對帳

## 工程教訓（本輪新增）

1. **手測環境與出貨環境的檔案權限不等價**：dev 用環境變數把資料
   指到 /tmp，剛好落在 ACL 白名單內，遮蔽了正式路徑寫不進去的事實。
   對策已落地＝開機落章（寫入路徑在首啟就被驗證）＋失敗上浮；
   凡涉及 capabilities/ACL 的功能，驗收必須在無覆寫的真實路徑跑一次。
2. **靜默 catch 是隱形狀態機**：settings 寫入、匯出、檢視刷新三處
   的 `.catch(()=>{})` 全部改為使用者可見的通知或狀態列訊息。
3. 負向自檢要常駐：isolation 與 nondestructive 的「護欄的護欄」
   測試讓 Karen 的 4 次獨立變異全部被抓到，證明此模式有效。
