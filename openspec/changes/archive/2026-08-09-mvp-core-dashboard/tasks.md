# Tasks: MVP 核心四件套單檔儀表板

## 1. 骨架與資料庫（design D6 CLI 與模組架構、D1 合併鍵基礎）

- [x] 1.1 建立 src/ 模組骨架與 `mhb` CLI 入口（mhb_cli.py：import/rebuild/status/quality 四個子命令雛形；依 design「D6: CLI 與模組架構 — 單一 `mhb` 入口、adapter 註冊制」）。行為：`python3 -m src.mhb_cli --help` 列出四個子命令與繁中說明。驗證：執行該命令比對輸出；pytest tests/test_cli.py::test_help。
- [x] 1.2 實作 health-database 的多人預留 schema 與 schema 版本化：profiles、source_documents、encounters、medications、lab_results、reports、immunizations、body_measurements、apple_records、apple_workouts、schema_version，全表含 profile_id。行為：初始化空庫後 `mhb status` 顯示 schema 版本與各表筆數 0。驗證：pytest tests/test_store.py::test_schema_init 檢查表清單與 UNIQUE 約束存在。
- [x] 1.3 實作來源追溯與品質旗標貫穿的 store 寫入層：insert API 強制帶 source_document 外鍵、節區、索引、quality_flags。行為：缺 source 參數的寫入拋出明確錯誤。驗證：pytest tests/test_store.py::test_source_required、test_quality_flag_rollup。
- [x] 1.4 實作健保紀錄內容指紋函式，落實 design「D1: 健保側合併鍵 — 內容雜湊指紋而非欄位組合鍵」（正規化：空值統一/去空白/鍵排序/巢狀排序 → SHA-256 前 16 bytes）。行為：JSON 與 XML 表示的同一筆紀錄（Phase 0 已知差異：排序/空標籤/引號）產生相同 record_fp。驗證：pytest tests/test_fingerprint.py 用去識別化雙格式 fixture 對測。

- [x] 1.5 實作品質報告產生模組（quality_report.py）：依 design Implementation Contract 的固定結構 JSON（source/sections/date_ranges/quality_flags/unmapped_lab_names/superseded_candidates/stale_knowledge/dedup）＋人讀摘要；`mhb import` 印增量、`mhb quality` 印全庫，共用同一模組。行為：對空庫與 fixture 庫各產生一份，結構欄位齊全順序固定。驗證：pytest tests/test_quality_report.py::test_schema_complete、test_incremental_vs_full。

## 2. 健保匯入 adapter（nhi-import）

- [x] 2.1 建立去識別化 fixture：從真實下載檔改寫院所/診斷/藥名/日期後存 tests/fixtures/nhi_sample.json（涵蓋 14 節區、調劑紀錄、無資料節區、未知欄位）。行為：fixture 不含任何真實個資且結構與真檔同構。驗證：rg 掃描 fixture 無真實院所名與遮罩身分證前綴；人工過目一次。
- [x] 2.2 實作 14 節區完整解析（含大小寫正規化、無資料佔位、未知欄位保留 extra_json）。行為：匯入 fixture 後各節區筆數與品質報告一致、unknown_field 有統計。驗證：pytest tests/test_nhi.py::test_full_sections、test_unknown_field_preserved。
- [x] 2.3 實作藥局交付調劑日期回退（r1.5 空 → r1.6，type=pharmacy_dispensing）。驗證：pytest tests/test_nhi.py::test_pharmacy_fallback。
- [x] 2.4 實作巢狀醫囑明細完整入庫與對帳（r1_1/r3_1/r9_1，含 r3_1 牙位欄）。行為：匯入後 medications 筆數 = 原始檔逐節區加總，對帳寫入品質報告。驗證：pytest tests/test_nhi.py::test_medication_reconciliation。
- [x] 2.5 實作遮罩身分證歸戶防護（b1.1 不符即中止、零寫入）與檔案指紋防重複匯入（SHA-256 已存在即跳過）。驗證：pytest tests/test_nhi.py::test_profile_mismatch_abort、test_same_file_skip。

## 3. Apple 匯入 adapter（apple-health-import）

- [x] 3.1 建立去識別化 Apple fixture（縮小版 XML：健康+活動型別、好轻體脂小數、1970 佔位、不可能的極低值 離群、27 筆型重複、Workout）。驗證：rg 掃描無真實姓名；pytest fixture 載入成功。
- [x] 3.2 實作串流解析與型別擷取（iterparse、以內容判型不看檔名、Record+Workout）。行為：以百 MB 量級真檔實測 60 秒內完成且記憶體平坦。驗證：pytest tests/test_apple.py::test_stream_parse（fixture）；真檔計時記錄於品質報告。
- [x] 3.3 實作來源別單位正規化規則表（好轻體脂率 0.255→25.5%，原值保留）。驗證：pytest tests/test_apple.py::test_source_unit_rules。
- [x] 3.4 實作佔位日期與離群值品質旗標（epoch_placeholder_date、out_of_range 範圍表）與匯出檔內部重複去除。驗證：pytest tests/test_apple.py::test_epoch_flag、test_outlier_flag、test_intra_file_dedup。

## 4. 合併層（incremental-merge）

- [x] 4.1 以 D1 指紋實作健保紀錄內容指紋合併：UNIQUE(profile_id, section, record_fp) + INSERT OR IGNORE。行為：同輸入二次匯入零新增；重疊視窗只增新紀錄。驗證：pytest tests/test_merge.py::test_idempotent、test_window_extension（雙 fixture 模擬視窗位移）、test_fingerprint_collision_flag（IGNORE 前內容比對，衝突記 fingerprint_collision 旗標）。
- [x] 4.2 實作疑似改版紀錄偵測（弱組合鍵同、指紋異 → superseded_candidate 進品質報告，不自動刪）。驗證：pytest tests/test_merge.py::test_superseded_detection。
- [x] 4.3 實作 Apple 紀錄自然鍵冪等（沿 Phase 0 機制正式化）與跨來源重複計數防護（每日每來源加總取最大之聚合視圖）。驗證：pytest tests/test_merge.py::test_apple_idempotent、test_step_dedup（iPhone 6000+Watch 7500→7500）。

## 5. knowledge 對照（knowledge-annotations，design D4、D5）

- [x] 5.1 下載健保藥品品項開放資料集建立本機快取（mhb knowledge update），落實 design「D4: knowledge 對照表 — 版本化 YAML＋建置時 join」，確認欄位與授權（design Open Question 結案），記錄資料集版本日期。行為：快取後離線可查醫囑代碼。驗證：`mhb knowledge update` 後對用藥紀錄中任一實際醫囑代碼查得成分名；授權條款記入 docs/。
- [x] 5.2 建立 labs.yaml（前置：§2 健保匯入與 §4 合併層完成、真實資料已入庫）：先以 `sqlite3 data/mhb.sqlite "SELECT DISTINCT item_name FROM lab_results"` 匯出檢驗名清單並去識別化存 tests/fixtures/sample_lab_names.txt（僅項目名，無數值無日期，項目名本身非個資），以此為底，依 design「D5: 檢驗名稱正規化 — 規則表映射，未匹配保留原名」撰寫別名表（Hb/HB、Lym/Lym.、eGFR 三變體各自獨立）與條目結構與來源標註（國健署/醫院來源+cited_date）。行為：unmapped 清單為空或逐項有意識保留。驗證：pytest tests/test_knowledge.py::test_entry_schema、test_alias_mapping、test_egfr_not_merged；`mhb quality` unmapped 清單過目。
- [x] 5.3 實作檢驗名稱正規化欄位寫入（test_name_normalized，unmapped 旗標）與藥品資訊對接（代碼 join、仿單連結、快取版本顯示）。驗證：pytest tests/test_knowledge.py::test_normalized_write、test_drug_join。
- [x] 5.4 實作非結論式用語約束與過時提醒：禁用詞清單檢查（建置失敗含位置）、cited_date/快取超過一年進 mhb quality 提醒。驗證：pytest tests/test_knowledge.py::test_forbidden_words_fail、test_stale_reminder。

## 6. 儀表板（dashboard-generator，design D2 嵌入分層、D3 Preact + htm）

- [x] 6.1 實作嵌入資料產生器，滿足資料嵌入分層 requirement 與 design「D2: 嵌入分層 — 醫療類全量、活動類預聚合、明細留庫」，含全字串 HTML 跳脫與體積計量。行為：輸出各層體積明細；含 "<1cm" 的報告文字正確跳脫。驗證：pytest tests/test_embed.py::test_layering、test_escaping、test_size_report。
- [x] 6.2 建立單檔殼與資料載入，依 design「D3: 前端技術 — Preact + htm（2026-08-08 定案）」：單檔自足與體積上限（>10MB 建置失敗列明細、檔名 dashboard_YYYYMMDD-private.html 不覆蓋、零執行期外連）。驗證：pytest tests/test_embed.py::test_size_gate、test_no_overwrite；產出檔以 browse 開啟斷網驗證 network 面板零請求。
- [x] 6.3 實作四件套視圖：總覽 tiles、就醫時間軸（篩選+點入明細+來源檔名）、用藥清單（分組+仿單連結）、趨勢圖（正規化名分組、參考值、Apple+成健同圖、深淺色、色盤驗證器通過）。驗證：browse 逐項斷言——總覽 tiles 數字與資料庫 COUNT 一致；時間軸點入任一事件顯示主診斷＋醫囑清單＋來源檔名；用藥清單任一分組筆數=資料庫該代碼筆數；趨勢圖含參考值帶且 unmapped 項目以原名成組出現；validate_palette.js（dataviz 技能附帶之色盤驗證腳本，apply 時複製至 repo tools/validate_palette.js 固定版本）雙模式 PASS；768px 寬度下無水平溢出。
- [x] 6.4 實作客戶端全文搜尋（跨類別、分組結果、點入視圖）。驗證：browse 輸入用藥清單中任一實際藥名斷言結果面板含對應用藥紀錄且輸入至呈現 <500ms（js 計時）；pytest tests/test_search_index.py::test_index_build。
- [x] 6.5 落實個資與醫療邊界防護：頁首聲明與勿外傳提示、介面文案禁用詞檢查納入建置。驗證：pytest tests/test_embed.py::test_disclaimer_present；禁用詞檢查對故意違規 fixture 失敗。

## 7. 端到端與品質收尾

- [x] 7.1 `mhb import` 自動判型整合（健保 JSON/Apple zip 或資料夾/無法判型明確報錯），匯入後自動 rebuild 並印品質報告摘要。行為：對兩種真檔各執行一次，輸出品質報告；對 .txt 檔報錯列支援格式。驗證：pytest tests/test_cli.py::test_detect_dispatch、test_unknown_format_error；真檔手動執行記錄輸出。
- [x] 7.2 端到端冪等演練：真實健保檔＋Apple 匯出各匯入兩次，斷言全表筆數與 record_fp 集合不變（Implementation Contract 驗收）。驗證：scripts/e2e_idempotency.sh 輸出 PASS。
- [x] 7.3 以真實資料產出 dashboard 於 Mac Safari/Chrome 與 iPad Safari 實機開啟，四件套與搜尋逐項走查（G3 行為順序 dogfood）。驗證：走查清單勾完、發現問題開 issue 回修。
- [x] 7.4 文件收尾：README（下載→匯入→開檔流程、隱私說明、資料位置與刪除方式）、CHANGELOG、phase0/ 標註封存狀態並刪除 phase0/output/ 原型產物（mhb.sqlite、report.html）。驗證：照 README 從零走一遍流程成功。

## 8. UX 迭代（2026-08-09 使用者回饋，回寫規格）

- [x] 8.1 實作篩選連動：時間軸院所選單依類型縮減、切類型重置院所。驗證：browse 斷言選單 19→3；pytest 全綠。
- [x] 8.2 實作用藥醫令分類（藥品/中醫用藥/診療項目與其他三分頁）。驗證：browse 斷言分類計數 63/22/44。
- [x] 8.3 實作處方時間軸展開（長條=處方、高度=給藥日數）與明細列跳轉該次就醫。驗證：browse 斷言展開含 svg 長條、點明細跳時間軸並展開。
- [x] 8.4 實作搜尋結果跳轉與捲動定位（就醫/用藥/檢驗 → 對應視圖展開/選中＋scrollIntoView）。驗證：browse 斷言跳轉後目標 top≈12px。
- [x] 8.5 實作匯入紀錄顯示與匯入統計記錄：schema v2（source_documents.import_stats）＋MIGRATIONS 前向遷移，總覽匯入紀錄表。驗證：pytest test_schema_migration_v1_to_v2、test_finalize_import_stats；真實 v1 庫升級實測；browse 斷言 2 筆紀錄含統計。
