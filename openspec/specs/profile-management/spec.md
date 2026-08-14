# profile-management Specification

## Purpose

多位家庭成員共用同一 App 與資料庫：成員的建立、改名、刪除（連帶
資料）與當前檢視成員的跨啟動記憶。與 app-import-engine 的「匯入
歸屬指定」、app-viewer 的「成員切換與依人檢視」共同構成多人資料
管理（change multi-profile-management，2026-08-10）。

## Requirements

### Requirement: 成員清單與新增

App MUST 提供成員管理介面：列出全部成員（顯示名稱、已綁定的遮罩
身分證、各類資料筆數摘要）並可新增成員。成員顯示名稱 MUST 為去除
前後空白後 1 至 30 字的非空字串（上限防止外溢至匯出檔名與版面），
且 MUST NOT 與既有成員重名（應用層檢查，不動 DDL）。

#### Scenario: 新增成員
- **WHEN** 使用者於成員管理介面新增成員「媽媽」
- **THEN** 成員清單出現「媽媽」（無綁定身分證、零筆資料），切換器
  選項同步出現；匯入確認面板於下次開啟時包含新成員（成員異動會
  重置進行中的匯入面板，避免引用失效成員）

#### Scenario: 重名阻擋
- **WHEN** 已有成員「媽媽」，使用者再新增「 媽媽 」（含空白）
- **THEN** 顯示重名說明並拒絕建立，成員清單不變

<!-- @trace
source: multi-profile-management
updated: 2026-08-10
code:
  - docs/verification/multi_profile_qa_closeout.md
-->

---
### Requirement: 成員改名

成員 MUST 可改顯示名稱，檢查規則與新增一致（非空、不重名）；
改名 MUST NOT 影響該成員任何資料歸屬（僅 profiles.display_name
更新）。

#### Scenario: 既有單人庫改名
- **WHEN** 使用者將既有成員「本人」改名為「爸爸」
- **THEN** 切換器、檢視頁 meta、匯入紀錄卡即時顯示新名稱，
  資料筆數不變

<!-- @trace
source: multi-profile-management
updated: 2026-08-10
code:
  - docs/verification/multi_profile_qa_closeout.md
-->

---
### Requirement: 成員刪除（連帶資料、二次確認）

刪除成員 MUST 於單一交易內清除該成員在全部資料表（含
source_documents）的所有列，最後刪除 profiles 列；中斷 MUST 整批
回滾。刪除前 MUST 顯示該成員名稱與各類資料筆數，並要求使用者
輸入該成員顯示名稱才啟用刪除；刪除後該成員來源檔案的 SHA-256
即自全庫釋放，同一檔案 MUST 可重新匯入給其他成員。

**「全部資料表」MUST 以機器可驗的方式保證**：清單 MUST 涵蓋 schema 建立
的每一張資料表，且新增資料表時 MUST 有測試在清單未跟上時失敗。凡有
`doc_id` 外鍵指向 source_documents 的表若漏列，刪除會在刪除來源紀錄那步
以外鍵限制失敗，該成員完全無法刪除。清單順序 MUST 讓 source_documents
排在所有引用它的表之後。

#### Scenario: 刪除成員
- **WHEN** 使用者刪除成員「媽媽」（確認面板輸入「媽媽」）
- **THEN** 該成員全部資料與來源紀錄清除，其他成員資料筆數不變，
  切換器不再列出該成員

#### Scenario: 名稱不符不啟用
- **WHEN** 確認面板輸入「媽」（與成員名稱不符）
- **THEN** 刪除鈕維持停用，資料庫零寫入

#### Scenario: 含新類型資料的成員
- **WHEN** 刪除一位名下只有最新加入之資料類型（如 CPAP 三表）的成員
- **THEN** 刪除成功，該類型的資料列一併清空，不因外鍵限制失敗

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/multi_profile_qa_closeout.md
  - docs/verification/viewer_history_refinement.md
-->

---
### Requirement: 當前成員狀態記憶

當前檢視成員 MUST 跨啟動記憶（App 資料目錄 settings.json，存成員
id 與介面偏好如最近使用目錄，MUST NOT 含醫療個資）；設定檔缺失、損毀或指向已刪成員時 MUST 靜默
回退：有成員則取 id 最小者，零成員則回首次啟動引導。

#### Scenario: 重啟保留
- **WHEN** 使用者切換至成員「媽媽」後關閉並重開 App
- **THEN** 檢視頁直接顯示「媽媽」的資料

#### Scenario: 失效回退
- **WHEN** settings.json 指向的成員已被刪除
- **THEN** App 以 id 最小的成員開啟，不顯示錯誤

<!-- @trace
source: multi-profile-management
updated: 2026-08-10
code:
  - docs/verification/multi_profile_qa_closeout.md
-->

---
### Requirement: 匯入紀錄刪除（單筆來源檔案連帶資料）

App MUST 可刪除單筆來源檔案（source_document）：於單一交易內
刪除該檔全部關聯資料列（medications 先於其母表）與來源紀錄本身，
中斷 MUST 整批回滾；其他成員與同成員其他來源檔案的資料 MUST
逐位元組不變。刪除後該檔案的 SHA-256 MUST 自全庫釋放，同一檔案
可重新匯入（含匯入給其他成員）。刪除前 MUST 顯示明細預覽（檔名、
匯入時間、各表關聯筆數）並要求二次確認；同成員同來源家族（健保
一族、Apple 一族）存在其他曾發生紀錄級去重跳過的來源檔案時，
預覽 MUST 顯示重疊警告（刪除可能連帶移除其他檔案也含有的紀錄，
且該些檔案無法重匯回補）。

**「全部關聯資料列」MUST 以機器可驗的方式保證**：關聯資料表清單 MUST
涵蓋 schema 建立的每一張資料表，且新增資料表時 MUST 有測試在清單未跟上
時失敗。漏列的表不只是資料殘留：若該表的 `doc_id` 有外鍵指向
source_documents，刪除會直接以外鍵限制失敗，該來源檔完全無法刪除。
明細預覽的筆數 MUST 取自同一份清單，否則預覽會少算漏列的表。

**MUST 支援對整批來源檔案的刪除**（批次組成見 `app-import-gui`）：批次
MUST 在單一交易內完成，逐筆套用與單檔相同的邏輯，MUST NOT 另寫一套刪除
流程。健保身分綁定的解除判定於交易內逐筆重算，因此刪到該成員最後一份
健保檔時才解除綁定。

#### Scenario: 誤匯刪除後重匯正確成員
- **WHEN** 「爸爸」的 Apple 匯出檔誤匯給「媽媽」，使用者於匯入
  紀錄卡刪除該筆來源檔案後，將同一檔案重新匯入並選擇「爸爸」
- **THEN** 刪除預覽顯示該檔各表筆數，確認後「媽媽」名下該檔資料
  與來源紀錄消失、其餘資料不變；重匯不再被重複檔案跳過，資料
  正確歸入「爸爸」

#### Scenario: 同人多檔重疊警告
- **WHEN** 成員「本人」名下有兩筆健保來源檔案且後匯者曾發生紀錄
  級去重跳過，使用者對先匯者開啟刪除預覽
- **THEN** 預覽顯示重疊警告；確認刪除仍可執行（警告不阻擋）

#### Scenario: 刪除中斷回滾
- **WHEN** 刪除交易中途失敗
- **THEN** 全庫資料與刪除前完全一致（無半刪狀態），並以通知列
  顯示失敗訊息

#### Scenario: 批次刪除中途失敗
- **WHEN** 批次刪除進行到第三個檔案時失敗
- **THEN** 該批全部檔案與其資料列皆保持原狀（逐位元組不變）

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/misattribution_rescue_qa_closeout.md
  - docs/verification/viewer_history_refinement.md
-->

---
### Requirement: 匯入紀錄改歸屬（合併語意）

App MUST 可將單筆來源檔案連同其全部關聯資料列改掛至另一成員，
於單一交易內完成，中斷 MUST 整批回滾。與目標成員既有紀錄重複者
MUST 採合併語意（鏡像匯入去重規則）：同去重鍵之來源列刪除、
目標列保留（encounters 合併時其名下 medications 一併刪除；同
指紋不同 canonical 者於目標列補 fingerprint_collision 旗標）；
其餘列改掛目標成員。改歸屬前 MUST 顯示明細預覽（各表搬移筆數、
與目標重複合併筆數）並要求二次確認；同成員同來源家族存在其他
曾發生紀錄級去重跳過的來源檔案時，預覽 MUST 顯示重疊警告（搬移
可能使來源成員失去其他檔案也含有的紀錄，語意同匯入紀錄刪除之
警告）；未受影響成員的資料 MUST 逐位元組不變。

**搬移範圍 MUST 涵蓋每一張資料表**。漏列的表不會產生任何錯誤：來源紀錄
改掛了、該表的資料列卻留在原成員，而回報的搬移筆數是 0，畫面上看起來像
成功。以自然去重鍵（非紀錄指紋）去重的表 MUST 鏡像其 schema 的 UNIQUE
定義；當該去重鍵已能唯一決定一筆紀錄時（例如同一裝置同一時刻的量測），
比對 MUST 只用鍵而 MUST NOT 納入數值欄位——納入數值會使同鍵不同值的列
被當成不重複而寫入衝突。

**MUST 支援對整批來源檔案的改歸屬**：批次 MUST 在單一交易內完成，逐筆
套用與單檔相同的邏輯，MUST NOT 另寫一套搬移流程。

#### Scenario: 原始檔已刪的誤匯救援
- **WHEN** 「爸爸」的 Apple 匯出檔誤匯給「媽媽」且原始檔已刪，
  使用者於匯入紀錄卡將該筆來源檔案改歸屬至「爸爸」
- **THEN** 該檔來源紀錄與全部資料列改掛「爸爸」，檢視「爸爸」
  即見該批資料，「媽媽」名下不再出現；資料零遺失

#### Scenario: 目標成員已有部分相同紀錄
- **WHEN** 改歸屬的來源檔案中部分紀錄與目標成員既有紀錄同
  去重鍵
- **THEN** 同鍵之來源列刪除、目標列保留，其餘列改掛；預覽與結果
  分別回報搬移與合併筆數

#### Scenario: 新類型資料的改歸屬
- **WHEN** 改歸屬一筆只含最新加入之資料類型（如 CPAP 三表）的來源檔案
- **THEN** 該檔的資料列全部改掛目標成員，回報的搬移筆數與實際列數相符，
  MUST NOT 留在原成員

<!-- @trace
source: viewer-and-history-refinement
updated: 2026-08-14
code:
  - docs/verification/misattribution_rescue_qa_closeout.md
  - docs/verification/viewer_history_refinement.md
-->

---
### Requirement: 健保身分綁定守恆

健保來源檔案（adapter 前綴 nhi_）改歸屬 MUST 僅允許目標成員未
綁定遮罩身分證；目標已綁定者 MUST 阻擋並說明（零寫入）。健保
來源檔案的救援操作（刪除或改歸屬）使來源成員名下不再有任何
健保來源檔案時，MUST 於同一交易內解除其遮罩身分證綁定；且若
該操作為改歸屬，MUST 同時將原綁定轉綁目標（目標依前述護欄必
未綁定）。來源成員仍持有其他健保來源檔案時綁定 MUST 不變；
非健保來源檔案的救援操作 MUST NOT 影響任何綁定。

#### Scenario: 誤綁救援（解綁＋轉綁）
- **WHEN** 「爸爸」的健保檔誤匯給未綁定身分證的新成員「媽媽」
  （「媽媽」因此誤綁「爸爸」的遮罩身分證），使用者將該檔改歸屬
  至未綁定的「爸爸」
- **THEN** 「媽媽」解除綁定、「爸爸」綁定該遮罩身分證；之後
  「爸爸」的健保檔匯入通過護欄、「媽媽」可正常綁定自己的
  身分證

#### Scenario: 目標已綁定阻擋
- **WHEN** 使用者將健保來源檔案改歸屬至已綁定其他遮罩身分證的
  成員
- **THEN** 預覽即顯示阻擋原因（檔案身分與目標成員不符），無法
  確認執行，資料庫零寫入

#### Scenario: 刪除最後一份健保檔即解綁
- **WHEN** 成員名下唯一一筆健保來源檔案被刪除
- **THEN** 該成員遮罩身分證綁定解除，成員管理介面即時反映；
  同一檔案之後可重匯給正確成員並正常綁定

<!-- @trace
source: misattribution-rescue
updated: 2026-08-12
code:
  - docs/verification/misattribution_rescue_qa_closeout.md
-->
