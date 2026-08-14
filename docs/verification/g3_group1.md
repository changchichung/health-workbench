# G3 驗證：Group 1 骨架與資料庫（2026-08-08）

## 三要素
- V1 改了什麼：src/mhb_cli.py、src/store/{schema,db,fingerprint}.py、
  src/quality/quality_report.py、src/adapters/__init__.py、
  tests/{test_cli,test_store,test_fingerprint,test_quality_report}.py
- V2 測了什麼：`python3 -m pytest tests/ -q`（22 項，含 TDD RED→GREEN：
  fingerprint 先寫測試確認 collection error 後實作）
- V3 結果：22 passed in 0.42s；`mhb --help` 列出四子命令；
  空庫 `mhb status` schema 版本 1、各表 0 筆；`mhb quality` 輸出八欄位結構。

## Subagent Review（haiku，worktree 隔離）
3 Critical / 4 Warning / 4 Info。處置：
- 採納修正：medications 冪等（UNIQUE(encounter_id,section,source_index)+OR IGNORE）、
  fingerprint_collision 旗標防重複累加、表名白名單防護、COALESCE 哨兵
  -1→-999999.25、CLI rebuild 失敗碼不被吞、medications 欄名統一 section。
- 誤判不採納：apple_workouts 無冪等（schema 實有 UNIQUE+OR IGNORE）；
  LIKE 子字串誤匹配（搜尋整串旗標名，受控詞彙表下無誤匹配路徑）。
- 新增測試：test_fingerprint_collision_flag、test_medication_idempotent、
  test_illegal_table_rejected。
