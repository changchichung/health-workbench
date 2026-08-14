# 驗收紀錄：多檔來源撞上 fs scope 拒絕點開頭路徑（2026-08-13 實機走查）

## 現象

macOS 實機走查 CPAP 匯入的第一步就失敗，而且是**靜默失敗**：把 ResMed
記錄卡資料夾拖進 App，畫面完全沒有任何反應（沒有確認面板，也沒有錯誤）。
拖裡面的 `DATALOG` 子資料夾反而有正確反應（顯示「無法識別資料夾」，因為
該層沒有 `STR.edf`）。既有的 Apple 匯出資料夾匯入正常。

devtools console 的實際錯誤：

```
Unhandled Promise Rejection: forbidden path: <資料夾>/.DS_Store, maybe it is
not allowed on the scope for `allow-stat` permission in your capability file
```

## 根因（兩個獨立缺陷）

**1. Tauri 的 fs scope glob `**` 不匹配 leading dot。**
`capabilities/default.json` 對 `fs:allow-stat` 等權限給的是 `{ "path": "**" }`，
但這個 pattern 不涵蓋 `.DS_Store`。多檔來源的 `buildSourceSetTauri` 會對
列舉到的**每一個**檔案呼叫 `tauriFileSource`，而它要 stat 取 size（確認面板
要顯示合計大小），第一個點檔案就讓整個 promise 鏈拋出。

macOS 只要用 Finder 開過 SD 卡就會留下 `.DS_Store`，所以這是必然會踩到的路徑。

**2. `offerFile` 的例外沒有任何接手者。**
`main.js` 的 `tauri://drag-drop` listener 直接 `await app.flow.offerFile(...)`，
沒有 try/catch，例外變成未捕捉的 rejection，畫面因此毫無反應。三個呼叫端
（拖放與兩顆選檔按鈕）都是同樣狀況。

## 為什麼 210 個測試與 Apple 迴歸都沒抓到

- `collectDirEntries` 的測試走 **fs 注入版**，注入的是 node fs 或 fake，
  **完全繞過 Tauri 的權限層**。凡是「權限 scope 與程式假設不一致」這一類
  錯誤，注入式測試在結構上就看不到。
- Apple 資料夾走的是另一條路：`resolveAppleDirTauri` 只挑出那**一個** XML，
  然後只 stat 它，從來不 stat 資料夾裡的其他檔案。遍歷 stat 是「多檔來源」
  這個能力獨有的行為，所以舊路徑結構上碰不到這顆雷。

## 修法

**主修**：`collectDirEntries` 在列舉時跳過名稱以 `.` 開頭的檔案與目錄。
三個理由：(1) 這類路徑會被 fs scope 拒絕；(2) 它們從來不是健康資料
（`.DS_Store`、FAT32／exFAT 上的 `._STR.edf` 這種 AppleDouble 檔）；
(3) 點目錄（`.Spotlight-V100`、`.fseventsd`）含大量檔案，下潛進去只是
白吃 `maxEntries` 額度。使用者看到的檔案數也因此只算真正的資料檔。

被否決的兩個方案：放寬 capabilities 加 `**/.*`（要對 stat/open/read/read-dir
各加一條，把噪音檔放進權限面與 IPC，與「出貨前依 gate-proof 收斂 scope」
反向）；`buildSourceSet` 個別 stat 容錯（治症狀，且靜默略過合法檔案這條路
已經踩過一次）。

**配套修 1**：`offerFile` 改為對外殼層＋`offerFileInner` 實作，殼層把判型與
準備階段的例外轉成畫面上的錯誤卡（主訊息＋折疊技術細節，與匯入失敗同慣例）。
措辭不走 `friendlyError`：那組分類是為匯入階段寫的，「重新下載檔案」對
讀取／權限類失敗是錯誤的引導。

`main.js` 因此**沒有改動**：殼層放在 flow 內，三個呼叫端（拖放與兩顆選檔
按鈕）一次全部涵蓋，比在三處各包一次 try/catch 少一份走樣的機會。代價是
殼層本身若拋（例如 `reportBox.innerHTML` 失敗）仍會回到未捕捉狀態。

**配套修 2（同一顆雷的第二處）**：`resolveAppleDirTauri` 挑 XML 時只排除
`cda`，所以 FAT32／exFAT 或從 Windows 拿到的 Apple 匯出資料夾裡，
`._輸出.xml` 會因為排序在真檔之前而被選中，stat 它一樣被拒。既有素材在
APFS 上沒有這種檔才沒中彈。同時把它改成 fs 注入版（與 `collectDirEntries`
同模式），上線那份才測得到。

注入版取名 `resolveAppleDir`（沿用 `collectDirEntries` 的慣例），與
`tests/helpers/node_source.mjs` 原本的同名導出**撞名且簽名不同**（一個吃
注入的 fs，一個直讀 node fs）。自審時抓到，把 helper 那份改名為
`resolveAppleDirNode`，名稱直接表達實作基底。

Python 端的 `_xml_source` dir 分支**不需要修**（實測 `Path.glob("*.xml")`
確實會匹配 `._輸出.xml`，但每個候選都跑內容判型找 `<HealthData` 且失敗就
continue，功能上免疫，只多讀一次 64KB）。JS 版會中彈是因為它取 `names[0]`
就回傳、不驗內容。

## 驗證證據

**自動化測試**（153 → 210 → **213**，pytest 67 不變）：

| 新增測試 | 斷言 |
|---------|------|
| 資料夾走訪：點開頭的檔案與目錄一律不列舉 | `.DS_Store`／`._STR.edf` 任何深度都不列入；且 `readDir` **沒有被呼叫**到點目錄 |
| Apple 資料夾挑檔：AppleDouble 與點目錄一律不選 | `._輸出.xml` 與 `輸出.xml` 並存時選中後者 |
| Apple 資料夾挑檔：下潛一層時跳過點目錄 | 點目錄裡的 XML 不被選中 |

三個測試都做突變驗證（移除對應的過濾行 → 全部轉紅 → 自備份復原）。

第三個測試第一次寫錯，突變後**沒有轉紅**：目標子資料夾原本命名
`apple_health_export`，而該關鍵字在優先序上永遠贏過點目錄，測試根本走不到
點目錄那條分支。改成優先序不介入的目錄名後才真正有效力。

**真實素材端到端（scope 模擬）**：用注入的 fs stub 複製 Tauri 的權限語意
（任一路徑片段以 `.` 開頭就拋出與實機一字不差的 `forbidden path` 錯誤），
對真實記錄卡素材跑完整流程：

- 修復後：列舉**數百檔**（點開頭者 0）→ `detectSet` 選中 `resmed_edf` →
  `buildSourceSetTauri` 164 個 source → 確認面板文字
  `<資料夾名>｜N 個檔案，合計數 MB`。全程通過。
- 負向對照（`git show HEAD` 的修復前版本，同一 stub）：多列舉一個點開頭檔、
  含點開頭 1 個，在 `buildSourceSetTauri` → `tauriFileSource` 的 stat
  **複現實機那句一字不差的錯誤**。證明這個 stub 抓得到這類雷，不是恰好
  不觸發。

## 已知限制

- `offerFile` 的錯誤殼層**沒有自動化測試**：它依賴 DOM（`reportBox`、`say`），
  node 環境測不到。只能靠實機確認。
- `collectDirEntries` 的 `fs.readDir(dir).catch(() => [])` **仍會把權限或
  IO 失敗吞成空清單**（本次未動）。若未來某個子目錄讀不到，使用者看到的
  會是「無法識別資料夾」而不是真正的原因。這與本次修的是同一類問題
  （靜默失敗），但要改就得決定「部分列舉失敗」如何回報，範圍超出本次修復，
  列為 backlog。
- 上面那個「scope 模擬 stub」目前只存在於一次性驗證腳本，沒有進 `tests/`。
  現有的 dotfile 過濾測試已鎖住這次的行為，但未來新增的其他 Tauri 權限雷
  （例如寫入未允許路徑）仍然對注入式測試不可見。列為 backlog 建議。

## 實機結果

修復後重跑實機，拖放與確認面板顯示都正常，資料確實入庫：

| 走查項 | 結果 |
|--------|------|
| 1. CPAP 資料夾判型 | 通過（不再靜默，確認面板正常出現） |
| 2. 確認面板顯示 | 通過 |
| 3. 批次報告卡與入庫 | 通過（三張表各自入庫，`cpap_oximetry` 為 0 是正確行為） |
| 4. 第二次拖入同一張卡 | **尚未測** |
| 5. 既有 Apple 資料夾不受影響 | 通過（檔案數正確、十幾秒完成） |
| 6. v3 升 v4 的預遷移快照 | 通過（`mhb-premigrate-v3-*.sqlite`，百 MB 量級，三表就位） |

`cpap_oximetry` 為 0 列是正確行為（該機從未接血氧模組，見
`cpap_resmed_adapter.md`）。

同一輪走查另外發現紀錄頁的三處清單都漏了 CPAP，見
`history_page_lists.md`。
