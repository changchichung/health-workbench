# 驗收紀錄：payload 與檢視層（change cpap-sleep-therapy 第 5 組）

僅記結構性結論（依 design D12）。

## payload：跨語言 parity 不豁免

`provider_parity` 是 JS 與 Python 兩端 payload 的**全等比對**。design 原本
只寫「Python 端僅同步 DDL」，但那句話不完整：payload 加了 `cpap` 區塊而
Python 沒有，parity 立刻失敗。

處理方式是**補 Python 端的查詢**而不是放寬比對。理由：Python 端要寫的是
純 SQL 查詢，不是 parser（不觸及「不寫 Python 版 CPAP parser」的豁免），
而繞過既有護欄的代價遠高於補三個查詢。

同步時發現表清單在**四處**各有一份（`schema.py` 的 `ALL_TABLES`、
`db.py` 的 `table_counts`、`payload.js` 的 `TABLES`、`store.js` 的
`tableCounts`）。四處都補上了 CPAP 三表。其中 `store.js` 的那份特別值得
補：既有測試用它做「零寫入」的 before/after 比對，不含新表就等於那些護欄
不涵蓋 CPAP（例如某個 bug 讓失敗的匯入寫進 `cpap_daily`，既有測試抓不到）。

**跨語言一致性的兩個做法**：
- 每晚彙總用 SQL 的 `ROUND`／`AVG` 計算，而不是在兩種語言各自實作四捨五入
  （既有 `pyRound` 就是為了模擬 Python 的銀行家捨入而存在的補丁）。
- 逐筆事件上限 `CPAP_EVENT_LIMIT` 兩端同值，並在 payload 帶
  `events_truncated` 旗標，UI 據此顯示「僅列最近 N 筆」而不是靜默截斷。

**體積控制**：逐分鐘血氧不進 payload（Phase 2 帶進數年會是數十萬列），
改帶每晚彙總；趨勢圖要的正是這個粒度。

## 相容性：沒有 CPAP 資料就不留空區塊

proposal 要求「未匯入 CPAP 的使用者畫面不應出現空白區塊」。落實為
`HAS_CPAP` 條件，三處都受它控制：分頁本身、總覽卡、趨勢頁的 AHI 圖。
已加測試斷言：只有健保資料的 payload 渲染後**找不到**睡眠呼吸分頁按鈕、
總覽沒有 CPAP 卡、趨勢頁沒有 AHI 圖，且既有內容仍在。

## 自動化測試（`app/tests/ui/sleep_render.test.mjs`，新增 6 項）

沿用既有 `viewer_render` 的 vm sandbox 手法（vendored preact 真渲染）。

| 情境 | 斷言 |
|------|------|
| 有 CPAP 資料 | 分頁出現、六個區塊皆渲染、不落入錯誤邊界、機型顯示、標注「日期為入睡當晚」、事件明細列出、折線有實際座標 |
| 總覽與趨勢 | 總覽卡出現、匯入摘要含晚數、趨勢頁 AHI 對照圖出現 |
| 沒有 CPAP 資料 | 分頁／總覽卡／AHI 圖三者皆不出現，既有內容不受影響 |
| 沒有血氧資料 | 顯示原因說明而不是畫一張空圖 |
| 匯入紀錄摺疊 | 多檔併為一行、來源顯示中文名、逐檔仍在 DOM、統計為組內合計 |
| 時間域涵蓋 CPAP | 納入 CPAP 後 x 軸出現跨年刻度；反向驗證沒有 CPAP 時不該出現該刻度（避免斷言恆真） |

**突變驗證**：

| 突變 | 轉紅項數 |
|------|---------|
| 分頁不再依 `HAS_CPAP` 條件顯示 | 1 |
| `trendBounds` 不納入 CPAP 日期 | 2 |
| 血氧空狀態改成永遠畫圖 | 1 |
| 匯入紀錄不摺疊 | 1 |

四次突變後皆自備份復原，並驗證逐位元組相同。

測試 200 → **206 全綠**；`pytest` 65 全綠（含 provider parity 的 Python 側）。

## commit 前 diff 全讀抓到的問題

**漏氣與治療壓力原本畫在同一張圖**。這與 design D10 否決雙軸圖的理由是
同一個陷阱：`LineChart` 只有單一 y 軸，`lo`／`hi` 由全部 series 共同計算，
而漏氣（約 0-1 L/s）與壓力（約 6-8 cmH2O）數量級差一個級距，疊在一起會把
漏氣線壓成貼底的平線。已拆成兩張共用 `domain` 的圖，與 10-B 的決策一致。

另外整理兩處：CPAP 常數原本定義在檔案中段卻被前段的 `Overview` 使用
（因函式延後執行而可行，但讀起來像未宣告先用），已移至 `DATA` 之後；
總覽卡的 `.at(-1)` 重複三次，已抽為 `lastNight`。

## 未由自動化測試覆蓋（留待實機）

- 實際視覺呈現（顏色、間距、`details` 展開的樣式）。
- 分項疊線的切換按鈕互動（狀態邏輯已測，點擊未測）。
- 匯出的單檔 HTML 在瀏覽器中的實際行為（第 6 組會處理匯出涵蓋）。
