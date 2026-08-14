# G3 驗證：tauri-desktop-app tasks 第 5 組（檢視器遷移，2026-08-09）

落地形：檢視器＝iframe srcdoc 內嵌「同構單檔 dashboard」（provider
payload → assemble 模板），匯出＝同一份字串寫檔。app.js/style.css/
vendor 逐位元組原樣遷入（防漂移測試鎖定與 src/dashboard/ 全等）。

## 5.1 DataProvider — PASS

- `provider/payload.js`：embed.py build_payload 全移植（醫療層全量、
  活動層日聚合：計數型日加總取最大、量測型日中位數、品質旗標排除、
  藥品 join、knowledge 條目）；`pyRound` 實作 Python round-half-even
- node:test：**JS payload 與 Python build_payload 對同一庫數值全等**
  （generated_at 除外）；shape.json 契約驗證通過
- App 內實測：數十萬筆 apple_records 的庫 payload 組裝＋渲染正常，
  嵌入分層有效（產出 600KB）

## 5.2 app.js 遷入＋自動刷新 — PASS（互動走查留 6.3）

- iframe 渲染成功：dashboard 完整載入（含醫療邊界聲明、總覽 tiles）
- 匯入完成 → onImported → 檢視器自動刷新（實測：匯入新診所紀錄後
  encounters 5→6 即時反映，毋須重啟）
- 開 App 即見最新資料（boot → viewer.refresh）；空庫顯示匯入引導
- 四分頁互動逐 scenario 走查（篩選連動、三分類、時間軸、雙向跳轉、
  搜尋）＝與單檔版同一份 app.js，於 6.3 使用者日常演練實機確認

## 5.3 單檔 HTML 匯出 — PASS

- node:test：**assemble 輸出的嵌入資料與 `mhb rebuild` 產出全等**
  （時間戳除外）；`</script>` 逃逸防護測試通過；10MB 上限沿用
- App 內實測：匯出 /tmp 檔成功（600KB，與檢視器同 bytes——同一份字串）
- 匯出對話框預設使用者文件目錄、檔名帶日期＋private 字樣、
  提示含個資警語
