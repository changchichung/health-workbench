# incremental-merge Specification

## Purpose

重複匯入的冪等與合併語意：健保紀錄的內容指紋、疑似改版紀錄偵測、Apple
紀錄的自然鍵冪等，以及跨來源的重複計數防護。目標是同一份資料匯入多次
不增列、也不因來源不同而被重複計算（change mvp-core-dashboard，
2026-08-09）。

## Requirements

### Requirement: 健保紀錄內容指紋
系統 SHALL 對每筆健保紀錄（含巢狀醫囑）做欄位正規化（空值統一為空字串、
去前後空白、鍵排序、巢狀清單排序）後計算 SHA-256 取前 16 bytes 為
record_fp，並以 UNIQUE(profile_id, section, record_fp) 約束防重。
正規化 MUST 使 JSON 與 XML 表示的同一筆紀錄產生相同指紋
（排序差異、空標籤 vs 空字串差異、換行差異除外化）。

#### Scenario: 視窗接續匯入
- **WHEN** 先匯入 2023-08～2026-08 視窗的下載檔，再匯入 2023-11～2026-11
  視窗的下載檔（重疊 33 個月）
- **THEN** 重疊期間紀錄不重複，僅新增 2026-08～2026-11 的新紀錄，
  資料庫縱深變成 2023-08～2026-11

#### Scenario: 冪等
- **WHEN** 同一輸入連續匯入兩次
- **THEN** 第二次所有表筆數不變且 record_fp 集合不變


<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/hwb
  - docs/verification/karen_reality.md
  - README.md
-->

---
### Requirement: 疑似改版紀錄偵測
當新匯入紀錄與既有紀錄的弱組合鍵（機構代碼＋事件日期＋節區）相同
但 record_fp 不同時，系統 SHALL 兩筆並存並於品質報告列為
superseded_candidate 對照組，MUST NOT 自動刪除或覆蓋任一筆。

#### Scenario: 健保端修改歷史資料
- **WHEN** 新批次中同院同日紀錄的診斷名稱因健保端改版而不同
- **THEN** 新舊兩筆並存，品質報告列出對照供使用者裁決


<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/hwb
  - docs/verification/karen_reality.md
  - README.md
-->

---
### Requirement: Apple 紀錄自然鍵冪等
Apple 紀錄 SHALL 以 UNIQUE(type, start_ts, end_ts, source_name, value)
自然鍵配合 INSERT OR IGNORE 達成冪等；全量歷史重複匯出重匯 MUST 不增筆。

#### Scenario: 每月重新匯出
- **WHEN** 下月的全量匯出（含上月全部歷史）匯入
- **THEN** 僅新增上次匯入後的新紀錄


<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/hwb
  - docs/verification/karen_reality.md
  - README.md
-->

---
### Requirement: 跨來源重複計數防護
對多來源同型別的計數型資料（步數、能量），聚合統計 SHALL 以
「每日每來源分別加總後取單日最大值」計算，MUST NOT 直接跨來源加總。

#### Scenario: iPhone 與 Watch 同日記步
- **WHEN** 同一日 iPhone 記 6,000 步、Watch 記 7,500 步
- **THEN** 該日步數統計為 7,500，非 13,500

<!-- @trace
source: mvp-core-dashboard
updated: 2026-08-09
code:
  - bin/hwb
  - docs/verification/karen_reality.md
  - README.md
-->