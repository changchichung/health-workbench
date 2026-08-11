<div align="center">

# MyHealthBank：個人健康資料工作台

[![Release](https://img.shields.io/github/v/release/notoriouslab/myhealthbank?style=flat-square)](https://github.com/notoriouslab/myhealthbank/releases)
[![License: MIT](https://img.shields.io/github/license/notoriouslab/myhealthbank?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/平台-macOS%20%2B%20Windows-0A84FF?style=flat-square)](https://github.com/notoriouslab/myhealthbank/releases)
[![Built with Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri)](https://tauri.app/)
[![Local-first](https://img.shields.io/badge/本機優先-不上雲-34C759?style=flat-square)]()
[![Last Commit](https://img.shields.io/github/last-commit/notoriouslab/myhealthbank?style=flat-square)](https://github.com/notoriouslab/myhealthbank/commits)

**把健保「健康存摺」與 Apple 健康的下載檔，變成一份越養越深、可搜尋、
可帶去回診討論的家庭健康紀錄。全程本機，資料不離開你的電腦。**

macOS／Windows 桌面 App · 不需要帳號 · 檢視時不需要網路

屬於 [notoriouslab](https://github.com/notoriouslab) 開源工具組的一員

</div>

---

> 本工具僅協助整理、搜尋與視覺化你自行提供的健康資料，不提供診斷、
> 治療、用藥或其他醫療判斷建議。如有醫療問題，請諮詢合格醫事人員。

## 這是什麼？

健保署的「健康存摺」只查得到最近三年的就醫與用藥紀錄，Apple 健康的
匯出檔又大又難讀。MyHealthBank 把兩邊的下載檔整理進同一個本機資料庫：
每隔一陣子把新下載的檔案拖進來，三年的滾動視窗就被接成不斷加深的個人
縱深，重複的部分自動跳過，不會越匯越亂。

打開 App 就是完整的健康儀表板：總覽、就醫時間軸、用藥清單（附成分
與官方仿單連結）、檢驗趨勢，還有全文搜尋。要給家人或帶去診間，
一鍵匯出單一 HTML 檔，電腦用瀏覽器直接開，手機平板用檢視器 App 開。

## 快速上手（三步）

1. **下載自己的資料**
   - 健保：登入健康存摺（myhealthbank.nhi.gov.tw）→ 下載「醫療類」
     資料（建議 JSON；XML 也支援）
   - Apple：iPhone 健康 App → 個人頭像 → 匯出所有健康資料 → 把
     匯出檔（zip 或資料夾）傳到電腦
2. **拖進 App**：選擇這份資料屬於哪位成員 → 開始匯入。格式自動判別、
   重複自動跳過；健保檔會用遮罩身分證核對成員，選錯人會被擋下。
3. **看與分享**：「資料檢視」分頁直接看；「匯出單檔 HTML…」給
   iPad 或家人（僅含當前成員的資料，檔案含個資請妥善保管）。
   iPhone、iPad 上開啟匯出檔需要檢視器 App，見下一節。

## 在 iPhone、iPad 上看匯出的檔案

匯出的單檔 HTML 需要會執行網頁程式的 App 才看得到內容。iOS 上無法用
Safari 或 Chrome 直接開啟本機 HTML 檔案，而「檔案」App 的預覽不執行
網頁程式，只會一直停在「載入中」。

把檔案存進「檔案」App，再用
[HTML & Markdown 檢視器](https://apps.apple.com/tw/app/html-markdown-%E6%AA%A2%E8%A6%96%E5%99%A8/id6782357972)
這類 App 開啟即可正常顯示。電腦上（macOS、Windows）用瀏覽器直接開就行。

## 全家共用一台電腦

- **成員管理**：新增、改名、刪除成員（刪除會連同該成員全部資料，
  需輸入名稱確認）。
- **一鍵切換**：視窗右上角切換成員，儀表板即時跟著換人。
- **匯錯人也救得回來**：匯入紀錄裡每份檔案都能「改歸屬」搬給正確
  的成員（原始檔刪了也沒關係），或「刪除」後重新匯入；操作前都有
  明細預覽與確認。
- **備份與搬家**：「匯出資料庫檔…」存一份完整備份，到新電腦用
  「匯入既有資料庫檔…」整庫接回。

## 隱私設計

- 資料只存在你電腦的系統應用程式資料目錄（macOS：
  `~/Library/Application Support/com.notoriouslab.myhealthbank/`），
  不上傳、不註冊、不追蹤。
- 檢視過程零網路請求；只有點擊藥品仿單這類外部連結時才會開瀏覽器。
- 匯出的儀表板檔名帶 `-private` 字樣、頁首有紅字提醒，內含全部
  嵌入資料，請勿外傳。
- 想清空一切：刪掉上面那個資料夾就結束了。

## 安裝

到 [Releases](https://github.com/notoriouslab/myhealthbank/releases) 下載對應平台的安裝包：

| 平台 | 下載 |
|------|------|
| **macOS** | `.dmg`（Apple Silicon；Intel 版後續提供） |
| **Windows** | `.msi` 或 `.exe`（x64） |

產物尚未經過簽章，首次開啟需手動放行：

- **macOS**：右鍵點 App →「開啟」（或系統設定 → 隱私權與安全性 → 仍要開啟）；
  或在終端機執行一次 `xattr -cr /Applications/MyHealthBank.app`。
  DMG 內附「使用說明（請先閱讀）.txt」，放行與上手步驟都在裡面。
- **Windows**：SmartScreen 出現時點「其他資訊」→「仍要執行」

也可自行建置：`cd app && npm ci && npx tauri build`。

---

## 開發者資訊

- **App**：Tauri 2（Rust 殼只做 SQLite 橋與插件，業務邏輯全在
  `app/src/` 的 JS）；前端 Preact + htm（原始碼直接入庫，免建置）。
- **命令列工具**：`src/`（Python 3.13 標準庫 + PyYAML）自 v0.3 起
  凍結新功能，作為 App 匯入引擎的差分驗收基準。常用：
  `bin/mhb import <檔案>`、`bin/mhb rebuild`、`bin/mhb status`、
  `bin/mhb knowledge update`（更新藥品品項快取，唯一主動連網的命令）。
- **測試**：`cd app && npm test`（132 項，含與 Python 的逐位元組
  差分對帳、匯入與救援操作的非破壞性紅隊矩陣）；
  `python3 -m pytest tests/`；端到端 `scripts/e2e_idempotency.sh`。
- **CI**：`.github/workflows/app-build.yml`（測試＋守衛 → 雙平台建置）。
- **規格**：`openspec/`（Spectra SDD，specs 為單一事實來源）；
  格式研究 `docs/20260808_phase0_findings.md`；`phase0/` 為已封存的
  探索原型。
- **個資紀律**：`data/` 與 App 資料目錄一律不進版本控制；CI 只用
  合成測試資料。
