# app-shell Specification

## Purpose

TBD - created by archiving change 'tauri-desktop-app'. Update Purpose after archive.

## Requirements

### Requirement: 桌面應用基本規範

App MUST 以 Tauri 2 建置，介面繁體中文、跟隨系統深淺色；
src-tauri MUST 僅含殼與插件註冊，不得出現匯入業務邏輯。

#### Scenario: 啟動與外觀
- **WHEN** 於 macOS 啟動 App（系統深色模式）
- **THEN** 視窗以深色主題顯示繁中介面，切換系統至淺色後 App 跟隨

#### Scenario: 業務邏輯位置守衛
- **WHEN** 掃描 `app/src-tauri/src/`
- **THEN** 無任何解析、schema、knowledge 相關符號（rg 守衛清單通過）


<!-- @trace
source: tauri-desktop-app
updated: 2026-08-10
code:
  - docs/verification/app_qa_closeout.md
-->

---
### Requirement: 資料庫定位與首次啟動

資料庫 MUST 位於系統 App 資料目錄（Tauri appDataDir），路徑 MUST NOT
硬編碼；開發模式 MUST 可用環境變數覆寫。首次啟動無資料庫時 MUST 建立
空庫（schema 版本為現行版），並提供「匯入既有資料庫檔」入口。App
MUST 同時提供「匯出資料庫檔」入口（與匯入同區）：以一致性快照方式
（SQLite VACUUM INTO）將全庫複製到使用者指定位置，過程 MUST NOT
中斷或修改使用中的主庫；預設檔名 MUST 含日期以避免覆蓋；目標檔案
已存在時 MUST 拒絕並提示換檔名（零寫入）；成功與失敗 MUST 以通知
列回報（成功含路徑與大小、含個資提醒）。

#### Scenario: 首次啟動
- **WHEN** App 資料目錄不存在任何資料庫時啟動
- **THEN** 建立空庫，檢視頁顯示「尚無資料」與匯入引導，設定頁顯示
  資料庫實際路徑

#### Scenario: 既有資料庫遷移
- **WHEN** 使用者以「匯入既有資料庫檔」選擇一個 CLI 產生的
  mhb.sqlite（schema 版本 ≤ 現行）
- **THEN** 檔案複製至 App 資料目錄並完成前向遷移，檢視頁顯示既有資料；
  原檔不被修改

#### Scenario: 版本過新防護
- **WHEN** 選擇的資料庫 schema 版本高於 App 支援版本
- **THEN** 拒絕匯入並顯示「請更新 App」訊息，零寫入

#### Scenario: 匯出資料庫檔（備份／搬機）
- **WHEN** 使用者於管理成員面板進階區點「匯出資料庫檔…」並選擇
  儲存位置
- **THEN** 產生可直接被「匯入既有資料庫檔」讀回的單一 sqlite 檔
  （全成員、schema 版本一致、各表筆數與主庫一致），主庫維持開啟
  且內容不變；通知列顯示匯出路徑與大小

#### Scenario: 目標檔案已存在
- **WHEN** 匯出目標路徑已有同名檔案
- **THEN** 拒絕匯出並提示換檔名，既有檔案逐位元組不變


<!-- @trace
source: misattribution-rescue
updated: 2026-08-12
code:
  - docs/verification/misattribution_rescue_qa_closeout.md
-->

---
### Requirement: knowledge 資源隨 bundle

藥品品項資料庫與檢驗 knowledge MUST 以唯讀資源隨 bundle 發佈：
`drug_items.sqlite` 以唯讀 ATTACH 使用；`labs.yaml` MUST 於建置期
轉為 JSON 進 bundle，執行期不依賴 YAML 解析。

#### Scenario: 資源存在且唯讀
- **WHEN** App 啟動並執行一次藥品 join 查詢
- **THEN** 查詢成功且對 drug_items 的寫入嘗試失敗（唯讀連接）


<!-- @trace
source: tauri-desktop-app
updated: 2026-08-10
code:
  - docs/verification/app_qa_closeout.md
-->

---
### Requirement: 雙平台建置與 CI 零個資

MUST 以 GitHub Actions matrix（macOS、Windows）用官方 tauri-action
建置雙平台安裝包，產物不簽章。CI MUST 僅使用去識別化 fixtures，
workflow MUST NOT 讀取 `data/` 目錄。

#### Scenario: CI 建置
- **WHEN** push 觸發建置 workflow
- **THEN** macOS 產出 .dmg/.app、Windows 產出 .msi 或 .exe 安裝包，
  上傳為 artifacts

#### Scenario: 個資防線
- **WHEN** 檢查 workflow 定義與建置日誌
- **THEN** 無 `data/` 路徑引用；bundle 內容清單不含任何個資檔案

<!-- @trace
source: tauri-desktop-app
updated: 2026-08-10
code:
  - docs/verification/app_qa_closeout.md
-->
