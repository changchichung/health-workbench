# knowledge-annotations — 檢驗與藥品解讀對照

## ADDED Requirements

### Requirement: 條目結構與來源標註
knowledge 條目 SHALL 以版本化 YAML 維護於 repo，每條 MUST 含：
normalized_name、aliases、description、source_name、source_url、
cited_date。缺任一欄位 MUST 使建置失敗。dashboard 顯示說明時
SHALL 同時顯示來源名稱與引用日期。

#### Scenario: 完整條目顯示
- **WHEN** 檢視 Hemoglobin 檢驗說明
- **THEN** 顯示說明文字、來源（如國健署成人預防保健專區）與引用日期

#### Scenario: 缺來源欄位
- **WHEN** labs.yaml 有條目缺 source_url
- **THEN** 建置失敗並指出條目名

### Requirement: 非結論式用語約束
knowledge 條目與 dashboard 顯示文案 MUST 通過禁用詞清單檢查
（禁用：診斷、預測、你可能罹患、建議停藥、換藥、不適合、
正常/不正常之判定式用法）；引述原始報告文字時 SHALL 標示為原文，
不受此限。

#### Scenario: 條目含結論式用語
- **WHEN** 條目 description 寫「數值過高代表你可能罹患糖尿病」
- **THEN** 建置失敗並指出違規詞

### Requirement: 藥品資訊對接
系統 SHALL 以醫囑代碼比對本機快取的健保藥品品項檔（記錄資料集
版本日期），為每筆用藥提供商品名、成分名與食藥署仿單查詢連結；
比對不到者 SHALL 顯示原始醫囑名稱並標 unmapped。快取更新 MUST 為
使用者主動觸發（mhb knowledge update），MUST NOT 於匯入或建置時外連。

#### Scenario: 藥品連結
- **WHEN** 檢視任一筆醫囑代碼可對應品項檔的用藥紀錄
- **THEN** 顯示成分名與仿單平台查詢連結，並標示品項檔版本日期

#### Scenario: 離線建置
- **WHEN** 無網路環境執行 mhb rebuild
- **THEN** 建置成功，藥品資訊使用既有快取

### Requirement: 過時提醒
品質報告 SHALL 對 cited_date 超過一年的 knowledge 條目與超過一年的
藥品品項快取提出更新提醒，MUST NOT 自動更新。

#### Scenario: 引用過期
- **WHEN** 條目 cited_date=2025-06-01，今日為 2026-08-08
- **THEN** mhb quality 輸出該條目於過時清單
