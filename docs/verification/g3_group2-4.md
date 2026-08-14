# G3 驗證：Group 2-4 健保/Apple adapter 與合併層（2026-08-08）

## 三要素
- V1：src/adapters/{nhi_json,apple_health,nhi_fieldmap}.py、
  tests/{test_nhi,test_apple,test_merge}.py、fixtures/{nhi_sample.json,apple_sample.xml}
- V2：`python3 -m pytest tests/ -q`（43 項）＋真實資料實測：
  健保檔匯入、Apple 資料夾匯入（百 MB 量級計時）、各自二次匯入
- V3：43 passed；健保 80/386/68/7/4/1/2 全對上 Phase 0 基準；
  Apple 數十萬筆＋數百 workouts、個位數秒（契約 60 秒）、檔內去重數十筆；
  二次匯入均「SHA-256 相同跳過」；同內容異檔重匯零新增（測試層驗證）。

## 實測驅動的規格外修正
- 疑似改版偵測誤報：真實資料 10 組全是「同次就醫多筆申報」常態
  （診察費/檢查費分列、復健針灸系列）。修正：弱鍵加就醫序號＋限跨批次
  （doc_id 不同）。修正後誤報 0。
- Apple 判型失敗：真實匯出檔開頭數 KB DTD，根元素在 4KB 外。
  修正：判型讀 64KB＋認 DOCTYPE。

## Subagent Review（haiku，worktree 隔離）
3 Critical / 3 Warning / 3 Info。處置：
- 採納：zip 資源管理（_ZipMember context manager）、歸戶防護補政策
  （檔案缺 b1.1 中止；Apple 先匯入之未綁定 profile 由健保首匯認領綁定）、
  date_ranges 排除 out_of_range、對帳鍵名明確化（expected_in_file/
  inserted_new）、未知欄位統計改 {節區:{欄位:次數}}。
- 記錄待辦：跨來源防雙計聚合將以 store 層 helper 於 dashboard task 實作
  （避免測試自帶邏輯的套套風險）。
- 新增測試：test_profile_bind_after_apple_first、test_missing_masked_id_abort。
