# apple-health-import Specification

## Purpose

TBD - created by archiving change 'mvp-core-dashboard'. Update Purpose after archive.

## Requirements

### Requirement: 串流解析與型別擷取
系統 SHALL 以串流方式（iterparse 等常數記憶體法）解析 Apple Health
匯出的主 XML（檔名 MAY 為本地化名稱如「輸出.xml」，MUST 以內容而非
檔名判型），擷取健康型別（身體組成/血壓/心率/睡眠/血氧）與活動型別
（步數/距離/能量/步態/飲食等）之 Record 與 Workout 元素。
百 MB 量級檔案 MUST 於 60 秒內完成匯入。

#### Scenario: 大檔匯入
- **WHEN** 匯入百 MB 量級、數十萬筆 Record 的輸出.xml
- **THEN** 60 秒內完成，尖峰記憶體不隨檔案大小線性成長


<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/mhb
  - docs/verification/karen_reality.md
  - README.md
-->

---
### Requirement: 來源別單位正規化
系統 SHALL 維護來源正規化規則表（sourceName → 欄位修正），
至少涵蓋：體脂率以小數儲存者（0.255 標單位 %）MUST 換算為百分比 25.5。
未涵蓋之來源資料 SHALL 原樣入庫並可於規則表擴充後重算。

#### Scenario: 好轻體脂率修正
- **WHEN** 匯入 sourceName=好轻、type=體脂率、value=0.255、unit=% 的紀錄
- **THEN** 正規化值為 25.5%，原始值 0.255 保留可追溯


<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/mhb
  - docs/verification/karen_reality.md
  - README.md
-->

---
### Requirement: 佔位日期與離群值品質旗標
系統 SHALL 對 epoch 佔位日期（2000-01-01 以前之 startDate）標記
quality_flag=epoch_placeholder_date；SHALL 對超出型別合理範圍的量測
（如體重 <30 或 >200 kg）標記 out_of_range。被標記資料 MUST 入庫
但 MUST NOT 進入趨勢統計。

#### Scenario: 1970 佔位日期
- **WHEN** 匯入 startDate=1970-01-02 的體重紀錄
- **THEN** 該筆入庫且帶 epoch_placeholder_date 旗標，體重趨勢圖不含此點

#### Scenario: 離群體重
- **WHEN** 匯入一筆低於合理下界（<30 kg）的體重紀錄
- **THEN** 該筆入庫且帶 out_of_range 旗標，不進趨勢


<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/mhb
  - docs/verification/karen_reality.md
  - README.md
-->

---
### Requirement: 匯出檔內部重複去除
同一匯出檔內相同 (type, startDate, endDate, sourceName, value) 的紀錄
（多裝置雙上報）SHALL 只入庫一筆，去除數量記入品質報告。

#### Scenario: 手錶手機雙上報
- **WHEN** 匯出檔含 27 筆完全相同的重複紀錄
- **THEN** 各只入庫一筆，品質報告顯示 skipped_dup=27

<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/mhb
  - docs/verification/karen_reality.md
  - README.md
-->