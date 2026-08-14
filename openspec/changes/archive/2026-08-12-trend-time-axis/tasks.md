# Tasks: 趨勢圖時間軸與區間選擇

範圍依 2026-08-12 原型實測後收斂的 design，並已納入 G1 兩輪審查的
全部發現（D1 共用時間域含適用範圍與序列集合、D2 時間刻度含週粒度
降級與標籤格式、D3 右側圖例含寬度預算、D4 標記兩段門檻含顯式 marker
例外、D5 區間選擇與區間過濾語意、D6 日期健全性、D7 範圍護欄）。

每個 task 完成時執行驗證三要素（行為、驗證命令、預期輸出）。除
task 3.4（樣式需真實佈局）外，全部走既有
`app/tests/ui/viewer_render.test.mjs` 的 vm sandbox 斷言渲染結果
（不新增資產模組，見 D7）；payload 由 `buildPayload` 從合成 fixture
產生並指定 `today`，使 90 天規則可決定性斷言。

## 0. 前置：統一時間基準

- [x] 0.1 `app/src/ui/viewer.js:72,117` 的 `new Date().toISOString()
  .slice(0, 10)`（UTC 日期）改為本地日期，與 `src/dashboard/embed.py:108`
  的 `date.today()` 對齊。此為既有落差（台北時區每天 00:00 至 08:00
  兩端差一日），本 change 把 `generated_at` 升級為 x 軸上界後會變成
  「App 與 rebuild 行為一致」條文的違反。
  驗證：`cd app && node --test 'tests/**/*.test.mjs'` 預期 fail 0；
  `rg -n 'toISOString\(\).slice\(0, ?10\)' app/src/ui/viewer.js` 預期
  無輸出。
  結果：新增 `localDateISO()` 於 `app/src/engine/values.js`（附為何不用
  `toISOString()` 的註解），viewer.js 兩處與 main.js 備份檔名共三處改用。
  `app/src/viewer/assets/app.js:35` 的 `toISOString()` 保留不動——那是對
  資料日期做加減後格式化（以 UTC 解析、以 UTC 格式化，前後一致），不是
  取當下時間。測試 132 → **134 全綠**，新增兩項：時區行為斷言（含
  「UTC+8 以上時區下 UTC 日期會早一天」的前提檢查）與對 Python
  `date.today()` 的差分對照。負向自檢：把實作換回 `toISOString()`，
  第一項測試轉紅（實測 fail 1），復原後回綠。

## 1. 時間域、座標與刻度

- [x] 1.1 `LineChart` 以共用時間域取代 `dates.indexOf`：新增呼叫端
  傳入的 `domain={tMin, tMax}`（毫秒），x 座標改為
  `PL + (t - tMin) / max(tMax - tMin, 1) * (W - PL - PR)`；跨度為零時
  置於 `PL`。移除 `dates.indexOf` 與隨之成為死碼的 `dates` 變數
  （app.js:73）。
  驗證：`cd app && node --test tests/ui/viewer_render.test.mjs` 預期
  全綠；新增斷言：對「末筆距 today 數百天」的合成序列，其末點 `cx`
  小於 `PL + 0.85 * (W - PL - PR)`；`rg -n 'dates.indexOf'
  app/src/viewer/assets/app.js` 預期無輸出。

- [x] 1.2 時間域計算：新增 `trendSeriesSet(DATA)` 回傳趨勢序列集合
  （體重兩條、收縮壓、舒張壓、步數、**全部**檢驗項目，與檢驗下拉
  當前選擇無關）；`trendToday(DATA)` 回傳
  `max(meta.generated_at, 該集合最新日期)`；
  `rangeDomain(rangeKey, today, earliest)` 回傳 `{tMin, tMax}`
  （`3m`／`1y` 以 today 往回 90／365 日，`all` 以 earliest 為下界，
  上界一律 today）。趨勢頁四張圖共用同一組 domain；**總覽體重卡的
  domain 由該卡資料（`slice(-365)`）自身首末日決定**（spec 明文只
  約束趨勢頁）。程式中 MUST NOT 出現無參數 `new Date()` 或 `Date.now()`。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；斷言趨勢頁四張圖
  x 軸首末刻度文字相同；斷言切換檢驗下拉項目後其他三張圖的末刻度文字
  不變（序列集合與下拉無關）；斷言「資料最新日期晚於 generated_at」的
  payload 中該最新點的 `cx` 不超過繪圖區右緣且未被剔除；
  `rg -n 'new Date\(\)|Date\.now\(\)' app/src/viewer/assets/app.js`
  預期無輸出。

- [x] 1.3 x 軸刻度改按時間挑：新增 `timeTicks(tMin, tMax, maxTicks)`，
  跨度 > 2 年按年、> 3 月按月、否則按週；超過 `maxTicks`（預設 8）時
  逐級降粒度直到不超過（年→每 2 年→每 5 年；月→每季→每半年；
  週→每 2 週→每月）。標籤格式：年 `YYYY`、季與月 `YY-MM`、
  週與日 `MM-DD`。取代現行依 `dates.length` 取樣的 `xlab`（app.js:87-89）。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；斷言跨度 7.6 年
  的圖刻度數 4 至 8、相鄰刻度 x 差 ≥ 40px；**斷言近三月區間**刻度數
  ≤ 8（週粒度 13 個必須降到每 2 週）且標籤格式為 `MM-DD`、無重複文字。

## 2. 圖例與標記

- [x] 2.1 末點標籤改右側固定圖例：序列名稱與最新值改繪於 x ≥ `W - PR`
  的圖例區，每序列兩行（第一行名稱、超過 7 字截斷加省略號；第二行
  最新值），y 依序列索引固定排列不重疊；移除 `x(last[0]) + 8` 的貼線
  標籤；格線右緣由 `W - 8` 收到 `W - PR`。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；斷言體重圖兩條
  序列的標籤 x 皆 ≥ `W - PR`、y 互不相同、單行文字長度 ≤ 8 字；
  斷言格線 `x2` 等於 `W - PR`；斷言標籤仍含各序列最新值。

- [x] 2.2 標記兩段門檻並移除舊規則：依**區間內**點數，≤ 118 用 r=3、
  119 至 237 用 r=1.5、> 237 不繪標記只畫折線；**序列顯式指定的
  `s.marker` 與 `s.stroke` 維持優先**（成健 `marker: 6` 不受門檻影響）；
  移除既有 `s.points.length > 400 ? 1.5 : 3`。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；斷言 1800 餘點
  序列 circle 數 0、32 點序列 circle 數 32；**斷言體重圖成健序列的
  circle 數為 3 且 `r` 屬性等於 6**（顯式覆寫未被門檻吃掉）；
  `rg -n '> 400' app/src/viewer/assets/app.js` 預期無輸出。

## 3. 區間選擇、過濾與空狀態

- [x] 3.1 依區間過濾資料點：新增 `rangeFilter(points, tMin, tMax)`，
  含邊界（`tMin ≤ t ≤ tMax`）、**不保留區間外的相鄰點**；y 軸上下界
  只由過濾後的點與參考值區間決定；月粒度序列（步數月平均）以「該月與
  區間有交集」判定納入，不以桶代表日期是否落在區間內判定。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；斷言由「全部」
  切「近三月」後某圖 y 軸刻度文字改變（縱軸有重算）；斷言步數在
  「近一年」時，下界所在月份的月桶仍被繪製（點數比「以代表日期判定」
  多 1）。

- [x] 3.2 步數圖粒度隨區間：`3m` 用 payload 的逐日 `activity["步數"]`，
  `1y` 與 `all` 用 `monthlyAvg`；圖說標明當前粒度。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；斷言「近三月」
  時步數圖點數為區間內天數量級（> 30）且圖說含「逐日」字樣，
  「全部」時點數為月數量級（< 100）且圖說含「月平均」字樣。

- [x] 3.3 趨勢頁頂部區間按鈕（近三月／近一年／全部，沿用 `.catbtn`），
  作用於全頁；初始值由 `defaultRange`（趨勢序列集合末筆取最大值，
  在 today 前 90 日內 → `1y`，否則 `all`）決定；切換即時重繪。
  單圖在區間內無資料時顯示無資料訊息與「看全部」入口，點擊後
  **整頁**切為 `all`。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；斷言點「近三月」
  後四張圖 x 軸首末刻度一致；對「集合末筆距 today 91 天」的 payload
  斷言初始選中為「全部」；用「體重新鮮、血壓末筆數百天前」的 payload
  斷言初始 `1y` 時血壓圖出現該入口、其他圖有內容，`dispatch("click")`
  後血壓圖有資料且四張圖區間一致。

- [x] 3.4 樣式與手機版：按鈕列在 ≤600px 不破版、觸控目標沿用
  `.catbtn` 既有 44px；`app/src/viewer/assets/style.css` 與
  `src/dashboard/style.css` 同步。
  驗證：先量基線再比對（避免把既存溢出誤判為本次退化）——以
  `scripts/gen_demo_data.mjs` 產示範頁面，用 browse 在 375px 與 1200px
  各量 `document.documentElement.scrollWidth <= window.innerWidth`，
  改動前後皆預期 true。

## 4. 日期健全性

- [x] 4.1 繪製前清洗日期：剔除 null 與無法解析的點
  （`Number.isNaN(new Date(d).getTime())`），於圖說標示剔除筆數；
  被剔除的點不參與時間域計算；`"YYYY-MM"` 形式視為該月第一日
  （沿用瀏覽器行為，原型已驗證 `new Date("2026-08")` 得 2026-08-01）。
  驗證：`node --test tests/ui/viewer_render.test.mjs`；對含一筆
  `test_date` 為 null 的檢驗序列，斷言時間域下界不是 1970 年、圖說含
  剔除筆數字樣、其餘點數正確。

## 5. 收尾

- [x] 5.1 資產同步與全套回歸：`app/src/viewer/assets/app.js` 與
  `src/dashboard/app.js`、兩份 `style.css` 逐位元組相同（防漂移測試
  強制）；CHANGELOG 記錄行為變更（趨勢圖時間軸語意、區間選擇、密集
  序列不再畫標記且失去逐點提示、步數粒度隨區間、`generated_at` 改本地
  日期）。
  驗證：`cd app && node --test 'tests/**/*.test.mjs'` 預期 fail 0；
  `cd /Users/jacobmei/Projects/notoriouslab/myhealthbank && python3 -m pytest tests/ -q`
  預期全數通過；`git diff --stat` 確認兩份 app.js 與兩份 style.css
  同時變動。

- [x] 5.2 以生產庫資料人工對帳並記錄結論（**不放截圖**，避免個資
  外流，與既有 `docs/verification/*.md` 慣例一致）：血壓圖末點不在
  右緣、檢驗 3 點不再鋪滿全寬、體重圖 Apple 序列無標記而成健 3 點有
  標記、預設區間為近一年且血壓圖出現「看全部」入口、切近三月後步數
  改逐日。並記錄改動前後的 SVG 節點數（**原型在合成資料上量得
  節點數降逾九成；生產庫的數字須另量，不可沿用**）。
  驗證：結論與數字記入
  `docs/verification/trend_time_axis_closeout.md`，內容僅含結構性
  結論與筆數。

## Apply 紀錄（2026-08-12）

任務 0.1、1.1-1.3、2.1-2.2、3.1-3.4、4.1 已完成，實作集中在
`app/src/viewer/assets/app.js`（並同步 `src/dashboard/app.js`）與
`app/src/engine/values.js`（localDateISO），**未動任何 CSS**：區間按鈕
沿用既有 `.filters` 與 `.catbtn`，故兩份 style.css 無變更。

新增純函式（IIFE 內，經 vm sandbox 對渲染結果斷言）：`tsOf`、
`sanitize`、`inRange`、`timeTicks`、`trendBounds`、`rangeDomain`、
`defaultRange`。

驗證結果：
- `node --test 'tests/**/*.test.mjs'`：**144 全綠**（134 → 144，新增
  `tests/ui/trend_axis.test.mjs` 10 項）；`pytest tests/`：65 全綠。
- 實作過程自己抓到一個真 bug：`tsOf` 起初只用 `Number.isNaN` 判定，
  但 `new Date(null)` 是 epoch 0 而非 Invalid Date，null 日期會漏過
  清洗——正是 spec 要擋的無聲失敗。已補「非字串或空字串直接回 NaN」。
- 負向自檢（拔實作看測試是否轉紅）：拔 null 防線 → fail 1；拔顯式
  marker 優先 → fail 3；改回索引軸 → fail 1；拔自動預設判斷 → fail 1；
  復原後全綠且 app.js 與備份逐位元組相同。
- task 3.4：以示範資料在 375px 與 1200px 實測
  `scrollWidth <= innerWidth` 皆 true、區間鈕高 44px。
- 使用者資料形狀端到端實測（合成同形狀）：預設區間為近一年、血壓與
  步數出現「看全部」入口、點擊後整頁切全部且血壓末點 x=600（右緣
  760）、體重圖 Apple 序列不畫標記僅成健 3 點 r=6、年刻度 2020-2026
  等距 7 個、格線右緣收在 760 不壓圖例。

### 5.x 收尾結果

- 5.1：兩份 `app.js` 與兩份 `style.css` 皆逐位元組相同（CSS 本輪未動）；
  CHANGELOG 新增「未發布（開發中）」段落記錄八項行為變更。
  `node --test` 144 全綠、`pytest` 65 全綠。
- 5.2：以真實資料庫**唯讀副本**在 vm sandbox 中對改動前後真渲染量測
  （副本用後已刪除，未寫入原庫，無截圖）。關鍵數字：血壓序列末點 x
  由 **760（正好在繪圖區右緣）降到 600**；SVG 節點與 circle 數各降約
  九成；預設區間為近一年且血壓圖出現「看全部」入口，
  點擊後四張圖 x 軸刻度一致。詳見
  `docs/verification/trend_time_axis_closeout.md`。

## QA 收尾（2026-08-12，三個獨立 fresh-context 稽核）

判定：完成度驗證 APPROVED WITH FINDINGS、規格合規 NON-COMPLIANT、
現實檢核「做完了但有一處未揭露的退化與一句假結論」。三份報告共同指出
的問題已全部修正並補測試。

**修正的程式缺陷（三份報告交叉命中）**

1. 月粒度序列（步數月平均）被畫到繪圖區外。`inRange` 以「月份與區間
   有交集」納入月桶（規格要求），但 x 仍以桶代表日期（該月一日）映射，
   早於時間域下界時得到負偏移。稽核實測 `today=2026-08-31` 近一年
   minCx=**-10.5**（畫出 viewBox 完全看不見、折線自畫布外飛入）、
   `today=2026-08-12` minCx=26.5（壓在 y 軸標籤上）。而近一年是預設
   區間，一般使用者一開趨勢頁就會遇到。修法：x 座標夾在時間域內。
   修後同案例 minCx 皆為 48.0（＝繪圖區左緣）。
2. 刻度階梯不單調導致極大跨度回傳空刻度。舊 `TICK_STEPS` 年粒度用盡後
   掉進 `month/1`（更細），一路更細直到耗盡回傳 `[]`。稽核實測
   41 年→**0 個刻度**、60 年→0（x 軸整條標籤消失且不報錯；一筆民國年
   被誤解析成 19xx 就會踩到）。修法：階梯改為單調由細到粗並補
   年 10／20／50 級，加首末兩刻度保底。修後 41 年→8 個、60 年→6 個。
3. 總覽體重趨勢卡（365 點）標記與逐點提示歸零，且該卡**沒有區間控制
   項**，spec 承諾的「可讀性由區間選擇承接」在那裡不存在，違反本 change
   自己的「總覽卡 MUST 維持既有行為」。修法：`LineChart` 增
   `markerLimit`，總覽卡傳放寬值使標記不歸零（半徑由 3 降為 1.5，
   已如實揭露）。
4. 總覽血壓卡以大字顯示陳舊血壓卻不顯示量測日期——本 change 的頭號
   理由就是「陳舊數值看似當前」，稽核直言「圖修了、最顯眼的數字卡
   沒修」。已在單位旁補上最近量測日期。
5. 檢驗圖在區間內無資料時仍印「灰帶為最近一次報告之參考值區間」。
   已加上有資料前提。
6. 空狀態文案改為指名當前區間（「近一年無資料」而非「此區間無資料」）。
7. 年刻度對齊間隔的倍數（原本錨在資料起點年份，20 年跨度得
   2007/2012/2017/2022 而右側留大片空白）。
8. 標記門檻改由繪圖區寬度推導（原本硬編碼 118／237，與規格「MUST 由
   標記直徑與繪圖區寬度推導」不符）。

**修正過程中自己踩到並修掉的 bug**：把 `labInRange` 插在 `numRows`
宣告之前造成 TDZ ReferenceError，Trends 整頁被錯誤邊界接住、區間按鈕
消失。是自己新寫的測試抓到的（17 項同時轉紅）。

**測試補強（稽核用突變測試證明原本無效力之處）**

稽核實測這三處拔掉實作測試不會轉紅：`MARK_FULL` 118→5000、步數永遠
月平均、名稱截斷門檻 7→99。另有多項 tasks 宣稱的斷言實際不存在
（刻度間距、y 軸重算、月桶納入）。已補 9 項斷言，並實測三處突變現在
各轉紅 1 項、無害對照組不轉紅。測試 144 → **153 全綠**，pytest 65 綠。

**規格與文件更正**

- design D4／D8 與 proposal 的「原型證實聚合的可讀性收益接近零」是
  **錯誤推論**：原型三個變體畫的是同一條折線，只差標記畫不畫，
  無法推導聚合的收益。稽核員補做了缺失的變體（週中位數聚合，桶數約降四分之三）
  並實測聚合確實把雜訊帶變成可讀的線。已改寫為真實理由（聚合語意未定
  ＋優先序），並明記「下一輪評估聚合時不要把那句錯誤結論當已驗證事實」。
- `dashboard-generator` delta 的時間域上界與 `app-viewer` 對齊，並更正
  引用的 requirement 數（四→五）。
- 移除 delta 中手寫的舊 `@trace` 區塊（全 repo 既有 19 份 delta 皆無，
  trace 於轉正後另補；留著會在 archive 時覆蓋成錯的來源）。
- spec 補：無區間控制項的圖不套用不繪標記門檻、月桶座標須夾在繪圖區
  內、刻度階梯單調且不得回傳空刻度、門檻須在程式中推導、趨勢序列集合
  限可繪圖的檢驗項目。

**未修並列入 backlog**（稽核認為可接受）

- 「全部」區間下密集序列仍是雜訊帶（時間桶聚合延後，理由見 design D8）。
- 區間內僅剩極少數點（如 1 點）時沒有「還有更舊資料」的提示。
- 「年月選擇」只有三個固定檔位，無自訂起訖與縮放拖曳。
