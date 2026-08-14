# Jenny 規格符合度審計（2026-08-09）

方法：六份 specs＋Implementation Contract 逐條對實作獨立重驗
（不信任先前結論；每項以測試/實測/查詢取證）。

## 發現與處置

| # | Spec 條款 | 實際狀態 | 嚴重度 | 處置 |
|---|----------|---------|--------|------|
| 1 | Contract「解析部分失敗→續行並記錄，NEVER 靜默丟棄」 | 壞紀錄使整批中止（實測 ProgrammingError） | High | 已修：兩 adapter 逐筆 guard 續行、parse_errors 進品質報告；test_partial_failure_continues |
| 2 | health-database「所有資料表 profile_id 為複合索引首欄」 | medications 唯一索引以 encounter_id 起首 | Medium | 已修：schema v3 增 idx_medications_profile(profile_id, encounter_id)＋MIGRATIONS[2]；實庫升級實測 |
| 3 | nhi-import「未知欄位記入品質報告」 | r11 節區未知欄位未統計（canonical 有留存不丟失） | Low | 已修：r11 加 note_unknown |
| 4 | knowledge「比對不到者顯示原始名稱並標 unmapped」 | 顯示原始名稱但無標記 | Low | 已修：展開視圖加「品項檔未對照」flag |
| 5 | dashboard「深淺色雙模式」 | 色盤驗證有、深色實機證據缺 | 證據補強 | 已補：forced-dark 截圖確認完整渲染 |

其餘 27 條 requirement 逐條核對均符合（證據：65 pytest、browse 斷言集、
E2E 冪等、真實資料對帳，見 docs/verification/g3_*.md）。

## 結論
NON-COMPLIANT（審前）→ 修正後 **COMPLIANT**。65 tests 全綠。
