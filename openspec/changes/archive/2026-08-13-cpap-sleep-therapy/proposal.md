# Proposal: CPAP 睡眠呼吸資料匯入（Phase 1：ResMed 原生 EDF）

## Why

CPAP（陽壓呼吸器）使用者的回診就是在看 AHI 趨勢、使用順從度與
體重的關係。體重、血壓、就醫紀錄與檢驗趨勢已經都在庫裡，把 AHI
與體重放同一頁對照，是現有四個來源都做不到、加了 CPAP 才成立的
價值，也正是本專案「越養越深、可帶去回診討論」論點的核心素材。

開發端可取得兩台機器的真實 SD 卡資料作為驗證素材（**不進 repo／
CI**，見下方驗證策略）：ResMed 機型（每日摘要數百個 record，涵蓋逾一年；
逐次細節僅最近數十晚）與 Philips Respironics 機型（數千檔／數十 MB，
自 ResMed 停用前約五個月起持續產生至今）。**兩者期間重疊約五個月**，
這使 schema 的去重鍵必須能區分裝置（見 design D3）。

### 為何 Phase 1 先做已停用的機型

2026-08-12 評估後分階段（假設 #53），Phase 1 選 ResMed 而非 Philips，
理由依序：

1. **ResMed 素材不可再生。** 該機型已停用不再產生新資料，且這份
   素材沒有其他備份來源，曾遭誤刪一次。匯入 App 本身即為備份行為
   （庫可再用「匯出資料庫檔」留存）。Philips 的卡仍在持續寫入，
   沒有同等時效性。
2. **ResMed 是建立共用基礎最便宜的路。** 本功能的工作量主要在
   schema、UI、趨勢圖與文案紀律，不在解析；這些 Phase 2 直接沿用。
   ResMed 走公開標準 EDF，已實測用標準庫解出全部所需欄位（假設
   #55），零依賴，且可自產合成 EDF 當測試 fixture，完全不必讓真實
   醫療資料進入 repo 或 CI。
3. **便宜驗證產品假設。** 做完即可用一年多的真實資料回答「AHI 與
   體重同頁對照對回診到底有沒有用」，再決定是否值得為 Philips 付
   更高代價。

Phase 2 走「使用者自行以 OSCAR 匯出 CSV，本 App 匯入 CSV」：OSCAR
為 GPL-3.0，本專案 MIT，不得閱讀移植其原始碼；由使用者自行執行外部
程式再匯入其輸出，授權乾淨且成本是解析 CSV 而非專有二進位。Phase 3
（原生 PRS1 解析）僅在 Phase 2 欄位不足或不願依賴外部工具時才啟動。

### 誠實揭露：Phase 1 單獨存在時沒有持續迴圈

ResMed 機型已停用，因此 Phase 1 完成後 App 內只會有該機型停用前的
歷史，仍在持續產生的 Philips 資料進不來。本專案的核心迴圈（每隔
一陣子把新檔案拖進來）要到 Phase 2 才成立。**Phase 1 是兩步中的
第一步，不是獨立功能**，本 change 的設計因此必須以「兩台機器共通
的臨床量」為準，不得長成 ResMed 欄位的形狀，否則 Phase 2 會被迫
遷移 schema。

## What Changes

### 納入本輪

- **新 capability `cpap-therapy`**：CPAP 治療資料的匯入與檢視規格。
- **schema 擴充（SCHEMA_VERSION 3→4）**：新增每日摘要與呼吸事件
  兩張表，欄位以兩台機器共通的臨床量設計；血氧與脈搏以**逐分鐘
  聚合**存放（見下方排除項）並以來源區分，與既有 Apple 血氧同圖
  疊線。前向遷移比照既有 MIGRATIONS 機制（假設 #57），Python 端
  `src/store/schema.py` 同步 DDL 與 MIGRATIONS 以通過 schema
  parity（假設 #58）。遷移將在**既有數十萬列／百 MB 量級的生產庫**
  上執行（2026-08-12 量測），失敗代價是資料庫打不開。
- **ResMed adapter（原生 EDF）**：解析 `STR.edf` 每日摘要、
  `DATALOG/*_EVE.edf` 呼吸事件、`DATALOG/*_SAD.edf` 血氧與脈搏。
  2026-08-12 重驗的格式事實（design 據此定欄位映射）：`STR.edf` 為
  28 訊號、每 record 一天（`dur=86400`）且 record 起始為**正午
  12:00**（`Mask On` 等時間欄位是「自正午起的分鐘數」，跨午夜者 >720）；
  **未使用日以哨兵值佔位**（原始數位值 −1），判定 MUST 用 **`dig < digmin`**：
  用 phys 值比對會漏（各訊號 scale 不同，phys 會得 −1／−0.02／−0.1），
  用 `== digmin` 則會漏掉全部缺測日並誤刪合法的 0 值；EDF label 欄位
  僅 16 字元故標籤被截斷（`Therapy Pres Me`、`Therapy Pres Ma`），
  比對 MUST 用截斷字串；`EVE` 為 EDF+D annotation（TAL 格式）且事件
  類型有**五種**：`Obstructive Apnea`／`Central Apnea`／`Hypopnea`／
  未分類 `Apnea`／非事件的 `Recording starts`（漏掉未分類 `Apnea`
  會使 `AI` 與分項對不攏）；`SAD` 為 **1Hz 逐秒**（非逐分鐘）。
- **多檔來源支援**：ResMed 是一整個 SD 卡資料夾（`STR.edf` 加
  DATALOG 上百檔），現行匯入流程一次一檔（`offerFile` 把資料夾
  解析成單一檔案，import_flow.js:60-100），adapter 介面與資料夾
  處理必須擴充。**這是本輪最大的架構改動，比 EDF 解析本身大**
  （假設 #59）。
- **檢視**：新增獨立分頁放睡眠呼吸的完整內容（每日 AHI 與中樞／
  阻塞分項、呼吸事件、使用時數、漏氣、治療壓力、睡眠期血氧）；
  趨勢頁另放簡單的混合對照，讓 CPAP 指標與體重等既有資料同頁一起
  看（假設 #63）；總覽新增一張卡（最近 AHI 與使用時數）。
- **匯出**：單檔 HTML 匯出同步涵蓋新區塊。

### 明確排除

- **PLD 逐分鐘 11 訊號與 BRP 波形不入庫**（假設 #61、#62）：
  單晚壓力與漏氣曲線的價值低於資料量與 UI 成本，Phase 2 之後再議。
- **血氧脈搏的逐秒原始值不入庫**（2026-08-12 裁示，更正假設 #62 的
  「逐分鐘」措辭）：`SAD` 實為 1Hz，改存**每分鐘一列聚合**（SpO2 最低／
  平均、脈搏平均／最高）。理由是逐秒在有資料的來源上會達到「再塞一個
  現有生產庫」的量級，Phase 2 若 Philips 有連續血氧更會達 3000 萬列等級。
  最低值序列足以還原「整晚最低血氧」與「低於任一門檻的分鐘數」；代價是
  去飽和區段的精確秒數不可還原，明列為已知限制。
  **重要：Phase 1 的素材完全沒有血氧資料**（實測全部樣本皆為缺測值，
  該機型需外接血氧模組而這台從未接過）。因此本決策在 Phase 1 是空操作，
  `cpap_oximetry` 匯入後為空表，血氧 UI 會是空狀態。詳見 design D6。
- **Philips 任何路徑**（Phase 2）。
- **不寫 Python 版 CPAP parser**：本輪明示豁免「每個 adapter 都有
  Python oracle 差分對帳」的既有紀律（假設 #8、#26），改以自產
  合成 EDF fixture 的已知輸入對已知輸出數值斷言，加對真實檔案
  人工對帳一次並記錄（假設 #65）。Python 端僅同步 DDL。
- **不做任何醫療解讀**：AHI 等臨床指標只顯示不解讀，沿用既有禁用
  詞守衛（假設 #66）。

## Impact

- **Specs**：新增 `cpap-therapy`；`health-database`（新表）、
  `app-import-engine`（多檔來源）、`app-import-gui`（資料夾匯入）、
  `app-viewer`（趨勢區塊與總覽卡）各有 delta。
- **程式**：`app/src/adapters/resmed_edf.js`（新）、
  `app/src/store/schema.js` 與 `src/store/schema.py`（DDL 與遷移）、
  `app/src/adapters/registry.js` 與 `app/src/ui/import_flow.js`
  （多檔）、`app/src/provider/payload.js`、
  `app/src/viewer/assets/app.js`。
- **文件**：README 產品定位需含 CPAP（現為「健保存摺＋Apple 健康」，
  假設 #68）、CHANGELOG、倉庫描述。
- **相容性**：既有 0.5.0 資料庫走前向遷移升到版本 4；未匯入 CPAP
  的使用者畫面不應出現空白區塊。
- **風險**：schema 遷移是 v0.3 以來第一次真正被使用者的既有庫執行，
  遷移失敗的代價是使用者資料庫打不開，需在 design 明確處理失敗與
  回復路徑。

## Open Questions

兩項 OPEN 皆已於 2026-08-12 定案，無殘留未決項：

- **多檔來源的去重鍵**（假設 #60）：定為**每檔一列
  `source_documents`**（STR.edf 與每個 DATALOG 檔各一列）。沿用既有
  `UNIQUE(sha256)` 語意，下次插卡只有新檔被處理、舊檔 sha256 命中即
  跳過（增量最精確），且天然滿足 `health-database`「來源追溯足以還原
  至原始檔案位置」。代價是匯入報告卡改批次呈現，而多檔 UI 本輪本來
  就要改。
- **趨勢頁時間軸的既有缺陷**（假設 #69）：已由獨立 change
  `trend-time-axis` 完成並 archive（共用時間域線性映射、時間刻度、
  整頁區間選擇），本 change 的 UI 直接建在修好的基礎上。已知殘留限制
  （「全部」區間下密集序列仍是雜訊帶）見該 change 的 design D8。
