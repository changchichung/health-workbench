# myhealthbank — 個人健康資料工作台

把台灣健保「健康存摺」下載檔與 Apple 健康匯出，整理成可累積、可搜尋、
可帶去回診討論的本機個人健康紀錄。**所有資料只留在你的裝置上**，
不需要帳號、不上傳雲端、檢視時不需要網路。

> 本工具僅協助整理、搜尋與視覺化使用者自行提供的健康資料，不提供診斷、
> 治療、用藥或其他醫療判斷建議。如有醫療問題，請諮詢合格醫事人員。

## 使用流程

```
1. 下載自己的資料
   - 健保：登入健康存摺（myhealthbank.nhi.gov.tw）→ 下載「醫療類」
     JSON 與 XML（建議兩種都下載；工具以 JSON 為主）
   - Apple：iPhone 健康 App → 個人頭像 → 匯出所有健康資料 → 把
     apple_health_export（zip 或解壓後資料夾）傳到電腦

2. 匯入（自動判型、可重複執行、冪等累加）
   python3 -m src.mhb_cli import ~/Downloads/健康存摺醫療類_YYYMMDD.JSON
   python3 -m src.mhb_cli import ~/Downloads/apple_health_export

3. 開啟 dashboard（匯入後自動產出；也可手動重建）
   python3 -m src.mhb_cli rebuild
   open data/dashboard_YYYYMMDD-private.html
```

每隔一段時間（例如每月）重複以上流程：健保三年滾動視窗會被自動
累積合併成不斷加深的個人縱深，重複資料不會重複入庫。

### 其他命令

```
python3 -m src.mhb_cli status              # schema 版本與各表筆數
python3 -m src.mhb_cli quality             # 全庫品質報告（唯讀）
python3 -m src.mhb_cli knowledge update    # 更新健保藥品品項快取（手動觸發）
```

## 隱私與資料位置

- 個人資料全部在 `data/`（原始下載檔、SQLite 資料庫、dashboard 單檔），
  已列入 `.gitignore`，NEVER 進版本控制。
- dashboard 檔名帶 `-private` 後綴且頁首有紅字提醒：**單檔內含全部
  嵌入資料，請勿外傳**。
- 刪除全部資料：刪掉 `data/` 目錄即可（原始下載檔請自行另存或一併刪除）。
- 檢視 dashboard 零網路請求；藥品仿單等外部連結僅在點擊時才離開頁面。
- `knowledge update` 是唯一主動連網的命令（下載健保藥品品項開放資料集）。

## 開發

- Python 3.13 標準庫 + PyYAML；前端 Preact + htm（vendored，免 build）。
- 測試：`python3 -m pytest tests/`；端到端：`scripts/e2e_idempotency.sh`。
- 規格 SSOT：`openspec/`；Phase 0 格式研究：`docs/20260808_phase0_findings.md`。
- `phase0/` 為已封存的探索原型，不再演進。
