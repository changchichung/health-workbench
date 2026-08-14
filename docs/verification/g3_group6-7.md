# G3 驗證：Group 6-7 dashboard 與端到端（2026-08-08）

## 三要素
- V1：src/dashboard/{embed.py,generate.py,app.js,style.css,vendor/}、
  tools/validate_palette.js、scripts/e2e_idempotency.sh、README、CHANGELOG、
  tests/test_embed.py；phase0/output 清除＋ARCHIVED.md
- V2：pytest 60 項；browse 逐項斷言（Chromium）；validate_palette 雙模式；
  scripts/e2e_idempotency.sh 真實雙來源雙輪；README 流程於全新目錄重走
- V3：
  - dashboard 數百 KB（上限 10MB）；medical 與 activity 兩區塊各佔約半
  - browse 斷言：tiles=80=DB、時間軸點入含主診斷/醫囑/來源檔名、
    用藥分組數＝DISTINCT 藥品數、PS/B/C 原名成組（文字型顯示表格不繪圖）、
    搜尋 5ms（<500ms）、768px 無水平溢出、console 零錯誤、零外連
  - 色盤亮暗雙模式 ALL CHECKS PASS
  - E2E：雙輪快照 hash 相等（dbabb48f…）
  - 已知修正：Preact render 不清 fallback、長標籤截斷、>400 點縮小標記、
    Apple DTD 判型、文字型檢驗納入趨勢選單

## Subagent Review（haiku，worktree 隔離）
0 Critical / 2 Warning / 4 Info。
- 採納：parseRef 支援 + 號；補 </script> 字面值逃逸測試（test_script_tag_escaping）。
- 誤判不採納：「stale_entries 待整合品質報告」——cmd_quality 已整合
  （src/mhb_cli.py cmd_quality）。
- Spec Compliance 檢查清單 13 項全 ✓（審查報告原文）。

## 未完成（交接）
- task 7.3 之 iPad Safari 實機走查需使用者執行（Mac Chromium 部分已完成）。
