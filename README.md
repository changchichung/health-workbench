# myhealthbank — 個人健康資料工作台

把台灣健保「健康存摺」下載檔與 Apple 健康匯出，整理成可累積、可搜尋、
可帶去回診討論的本機個人健康紀錄。**所有資料只留在你的裝置上**，
不需要帳號、不上傳雲端、檢視時不需要網路。

> 本工具僅協助整理、搜尋與視覺化使用者自行提供的健康資料，不提供診斷、
> 治療、用藥或其他醫療判斷建議。如有醫療問題，請諮詢合格醫事人員。

## 桌面 App（v0.3 起的主要使用方式）

不用懂程式：開啟 **MyHealthBank** App，把檔案拖進視窗即可。

```
1. 下載自己的資料
   - 健保：登入健康存摺（myhealthbank.nhi.gov.tw）→ 下載「醫療類」
     資料（建議 JSON，內容比 XML 完整；兩種都支援）
   - Apple：Apple 健康 App（iPhone）→ 個人頭像 → 匯出所有健康資料
     （Apple Watch 的紀錄會一併包含）→ 把
     apple_health_export（zip 或資料夾）傳到電腦

2. 匯入：拖進 App 視窗（或點擊選檔）→ 確認 → 看進度與結果報告
   - 自動判型、重複匯入自動跳過、不同人的檔案會被阻擋
3. 檢視：「資料檢視」分頁即完整儀表板（總覽/時間軸/用藥/趨勢＋搜尋）
4. 分享到其他裝置：「匯出單檔 HTML…」，任何裝置的瀏覽器都能直接開啟
   （檔案含全部個資，請妥善保管）
```

安裝包由 GitHub Actions 產出（macOS dmg／Windows 安裝檔，見 Actions
artifacts）；本機建置：`cd app && npm ci && npx tauri build`。
產物未簽章：自建自用不受影響；分發他人前需補簽章（backlog）。

## CLI（開發者路徑）

`src/`（Python）自 v0.3 起凍結新功能，僅修 bug；作為 App 匯入引擎的
差分驗收 oracle 持續存在。用法不變：

```
bin/mhb import <下載檔或資料夾>   # 匯入（自動判型、冪等累加）
bin/mhb rebuild                  # 產出單檔 dashboard（data/*.html）
bin/mhb status / quality         # 筆數 / 全庫品質報告
bin/mhb knowledge update         # 更新健保藥品品項快取（建議每季）
```

每隔一段時間（例如每月）重複下載＋匯入：健保三年滾動視窗會被自動
累積合併成不斷加深的個人縱深，重複資料不會重複入庫。

## 隱私與資料位置

- App 資料庫在系統應用程式資料目錄（macOS：`~/Library/Application
  Support/com.notoriouslab.myhealthbank/`）；CLI 資料在 `data/`。
  兩者皆 NEVER 進版本控制（`data/` 已 gitignore）。
- 匯出的 dashboard 單檔帶 `-private` 字樣且頁首有紅字提醒：**內含
  全部嵌入資料，請勿外傳**。
- 刪除全部資料：刪掉上述目錄即可。
- 檢視零網路請求；藥品仿單等外部連結僅在點擊時才離開頁面。
- `knowledge update` 是唯一主動連網的命令（下載健保藥品品項開放資料集）。

## 開發

- App：Tauri 2（Rust 殼僅 SQLite 橋與插件，業務邏輯全在 `app/src/` JS）；
  前端 Preact + htm（vendored，免 build）。
- Python 3.13 標準庫 + PyYAML（oracle 與 CLI）。
- 測試：`cd app && npm test`（55 項，含與 Python 的差分對帳）；
  `python3 -m pytest tests/`；端到端：`scripts/e2e_idempotency.sh`。
- CI：`.github/workflows/app-build.yml`（測試＋守衛 → 雙平台建置）。
- 規格 SSOT：`openspec/`；格式研究：`docs/20260808_phase0_findings.md`。
- `phase0/` 為已封存的探索原型，不再演進。
