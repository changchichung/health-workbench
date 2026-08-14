# 驗收紀錄：registry 與 GUI 多檔匯入（change cpap-sleep-therapy 第 4 組）

僅記結構性結論（依 design D12）。

## 核心約束：Apple 路徑行為不變

本組第一次動到既有匯入流程，最大的風險是讓既有來源退化。三道確認：

1. **單檔路徑一行未改**：`offerFile` 的資料夾分支之後（`tauriFileSource` →
   `registry.detect` → 健保 b1.1 預讀 → `pending`）完全沿用，diff 可見。
2. **CPAP adapter 的單檔 `detect()` 恆為 false**，不可能攔截既有格式的判型。
   已加測試斷言 Apple XML 仍由 `apple_health` 接手、既有三個 adapter 的
   註冊順序不變。
3. **判型階段不讀無關檔案的內容**：`detectSet` 收到的 entries 以
   `readHeader()` 惰性取得 header，adapter 只讀自己需要的那一個檔。
   已加測試：500 個無關檔案的資料夾中，沒有 `STR.edf` 時**一個檔都不讀**；
   有 `STR.edf` 時**只讀那一個**。

   若改成呼叫端預先讀好全部 header，Apple 匯出資料夾（`workout-routes/`
   可能上千個 gpx）每次匯入都要多上千次 IO。這是設計成惰性的原因。

## 判型順序（design D9）

資料夾先問 `registry.detectSet`（條件嚴格：必須有 `STR.edf` 且通過 EDF
判型），沒有結果才回退 `resolveAppleDirTauri`（條件寬鬆：有任何非 cda 的
XML 就算，且會下潛一層）。寬鬆的放後面，含無關 XML 的 SD 卡才不會被誤判
成 Apple 匯出。

兩者都不認得時的訊息，從「資料夾內找不到 Apple Health 匯出 XML」改為
比照單檔未識別、列出全部支援格式（現在支援的不只 Apple）。

## 自動化測試（`app/tests/ui/import_batch.test.mjs`，新增 9 項）

| 情境 | 斷言 |
|------|------|
| `register` 介面放寬 | `importSource` 與 `importSourceSet` 二選一即可；兩者皆無仍拒絕；`detect` 仍必要 |
| `detectSet` 路由 | 只問實作了集合介面的 adapter；沒有 adapter 認得就回 null，不得誤落到單檔 adapter |
| 預設註冊表 | CPAP adapter 已註冊；既有三個 adapter 順序不變；Apple XML 仍由 `apple_health` 接手 |
| 判型只讀必要的檔 | 500 個無關檔案時零讀取；有 `STR.edf` 時只讀 1 個 |
| 來源標籤純函式 | 單檔顯示檔名與大小；多檔顯示資料夾名、檔數與合計大小 |
| 批次摘要純函式 | 逐檔狀態統計（已解析／先前已匯入／解析失敗／略過）與筆數合計 |
| 資料夾走訪 | 兩層深度上限、`relPath` 一律正斜線、目錄不入清單 |
| 走訪上限 | 達到 `maxEntries` 即停止 |
| 走訪容錯 | 讀不到的子目錄跳過而不中斷整體 |
| Windows 路徑 | `path` 用反斜線、`relPath` 仍為正斜線（與 adapter 的比對一致） |

**突變驗證**：

| 突變 | 轉紅項數 |
|------|---------|
| `detectSet` 不再跳過沒有集合介面的 adapter | 1 |
| 拿掉走訪的 `maxEntries` 上限 | 1 |

兩次突變後皆自備份復原，並驗證逐位元組相同。

測試 191 → **200 全綠**；`pytest` 65 全綠。

## 防線：選到大目錄不得卡住 UI

`collectDirEntries` 有 `maxEntries`（預設 5000）上限。使用者可能選到
`Downloads` 這種大目錄，無上限地列舉兩層會讓介面停住。達到上限即停止列舉，
判型仍以已收集到的部分進行（`STR.edf` 在卡片頂層，通常最先被列到）。

走訪邏輯抽成注入 `fs` 的版本後可獨立測試；App 端的 `collectDirEntriesTauri`
只是包一層。本專案沒有 mock Tauri 的先例，App 端整條流程仍依既有慣例由
實機走查驗收。

## 未由自動化測試覆蓋（依既有慣例，留待實機）

- 確認面板與報告卡的實際 DOM 呈現（純函式已測，DOM 組裝未測）。
- 拖入 SD 卡資料夾的完整流程（`stat` → 列舉 → 判型 → 建 source → 匯入）。
- 進度條在多檔情境下的單調遞增（adapter 已以整批合計位元組回報，
  contract 未變）。

## 順帶記錄的既有小缺陷（非本輪引入，已列 backlog 6.5）

`say()` 以 `textContent` 呈現訊息，但呼叫端傳入的是已經 `escapeHtml` 過的
字串，因此含 `&` 或 `<` 的檔名會顯示成 `&amp;`。單檔與資料夾兩處行為一致，
本輪跟隨既有寫法未修，避免在同一處引入不一致。
