# QA 收尾紀錄：misattribution-rescue（v0.5.0，2026-08-11／12）

本輪 QA 依裁量以「雙專家 sequential-thinking 審查」替代三連審計
（validator → Jenny → Karen）。apply 完成後另有一段發布前冒煙測試，
抓到 apply 階段 QA 沒能發現的出貨缺陷，一併記錄於此。

最終狀態：node:test **132/132**、pytest oracle 65/65、CI app-build 與
release 於 c0dfe77 皆綠（run 31513369188／31514060973）、v0.5.0 已發布
並轉為公開倉庫，macOS 端由使用者實機驗收通過。

## 中立稽核（sequential-thinking）

- 判定：PASS
- 涵蓋：design D1-D6 與實作對齊、tasks 聲明與程式碼一致性、跨 task
  一致性（救援操作的交易邊界、合併語意、健保綁定守恆三者無矛盾）

## 紅隊邊界審查（sequential-thinking）

- 唯一真 finding：`esc()` 未轉義雙引號，於屬性位置插值時構成注入面。
  當前不可達（真正有屬性插值的 `profile_manager` 與 `import_flow`
  本已轉 `"`），但為防未來回歸，`history.js` 與 `main.js` 的 `esc`
  補齊一致，並新增 `app/tests/ui/esc_consistency.test.mjs` 靜態守衛
  （負向自檢：移除任一份 `&quot;` 轉義即轉紅）
- 誤報與理論邊界已實證澄清：
  - 改歸屬的 UNIQUE 衝突與 FK 孤立：紅隊以 raw SQL 重現，非經本函式
    路徑，實際流程走合併語意不會觸發
  - 檔名超限：前提「成員名可超長」不成立（名稱 30 字上限）
  - `IN` 參數上限：實測 40000 個參數通過（SQLite 上限 32766，實務
    健保檔數千筆遠低於此）

## code-self-review

六點全過。全讀 diff 時另修兩處真問題：viewer 外部連結的 load 監聽改為
初始化只掛一次（避免快速切換累積），以及程式碼註解的角色用語調整。

## 發布前冒煙測試補抓（apply 階段 QA 未發現）

以 release 產物實測時發現三個缺陷，**這一段是本輪最重要的教訓**：

1. **趨勢頁崩潰導致全檢視空白**（嚴重）。只匯入單一來源（僅健保或
   僅 Apple）時，趨勢頁的體重圖固定畫「Apple 量測」與「健保成健」
   兩條序列，其中一條為空；`LineChart` 取空序列末點得 `undefined`，
   繪製末端標籤時拋 `TypeError`，整棵 preact 樹死亡，之後所有分頁
   空白，重開才復活。匯出 HTML 共用同一份 app.js，同病。
   - 為何 QA 沒抓到：apply 階段的走查資料一律是「健保＋Apple 雙
     來源」，兩條序列都有點，此路徑從未被執行。
   - 修正：`LineChart` 過濾空序列（全空才顯示「無資料」）；另補
     檢視器錯誤邊界，單一分頁拋錯只該頁顯示訊息，不再拖垮全部分頁；
     新增 `app/tests/ui/viewer_render.test.mjs`（最小 DOM shim 讓
     vendored preact 真渲染，覆蓋健保 only／Apple only 兩型 payload
     逐分頁點擊與邊界攔截，拔掉修復即轉紅）。
   - 診斷備忘：preact 重渲染排在 microtask，此類錯誤在 console 與
     `error` 事件都看不到，需掛 `unhandledrejection` 才捕捉得到。
2. **匯出檔手機版面橫向溢出**。窄螢幕（375px）下總覽頁寬 800px。
   根因是卡片作為 grid item 的預設最小尺寸為 min-content，內含寬表格
   時撐出容器；補 `.card { min-width: 0 }` 解決。同時移除一條會把
   觸控目標從 44px 壓到 40px 的規則（在最需要大目標的手機上反向）。
3. **DMG 內附說明檔看不到**。Tauri 產生的 `.DS_Store` 只記錄 App 與
   Applications 兩個圖示座標，新增檔案由 Finder 自動配位會落到視窗外
   （使用者實測打開 DMG 沒發現說明檔）。改為明確指定三個項目座標並
   放大視窗，並在產出後解析 `.DS_Store` 斷言說明檔座標存在且落在
   可見範圍（負向測試：對只有兩個座標的舊 `.DS_Store` 會非零退出）。

## 帶走的紀律

- 「多來源合併」類功能的走查資料集 MUST 涵蓋單一來源與缺漏組合，
  不能只用最完整的那份資料走查。雙來源資料會系統性遮蔽空序列、
  空集合、單邊缺值這一整類路徑。
- 只在發布時才執行的步驟（DMG 後處理、資產上傳）MUST 在日常 CI
  就實跑，發布當天才第一次執行等於沒有防線。本輪已把 DMG 後處理
  接進 app-build，每次推 main 都在真實產物上跑一次。
