# G3 驗證：Group 5 knowledge 對照（2026-08-08）

## 三要素
- V1：src/knowledge/{labs.py,drugs.py,forbidden.py,labs.yaml}、CLI knowledge
  子命令、nhi adapter 匯入後自動正規化、tests/test_knowledge.py
- V2：pytest 52 項全綠＋真實資料驗證（品項 CSV 96.8MB → 快取、正規化重算、join 統計）
- V3：labs.yaml 40 條完整條目（65 個別名鍵）；真實資料正規化 65/68，
  unmapped 3 筆＝有意識保留之 PS/B/C（身分不確定寧缺勿錯，已記於 labs.yaml 註解）；
  藥品快取 45,175 代號（資料集版本 2026-08-08，政府資料開放授權）；
  join 命中約半數——未命中具名解釋：西醫的 6 碼診療項目代碼（非藥品）、
  中醫 63 筆為中藥代碼（另屬中藥品項檔，v2）、牙科 4 筆為處置代碼。
- design Open Question 結案：資料集欄位含藥品中英文名/成分/ATC/仿單超連結，
  授權=政府資料開放授權（data.gov.tw/dataset/23715 license: OGDL）。

## 補充決策
- eGFR 三變體驗證各自獨立（test_egfr_not_merged）。
- 條目 description 現階段為「名稱正規化＋邊界提醒」層級，統一引用健保署
  檢驗結果說明頁（2026-08-08 實測存在）；逐項深化說明與專屬來源是 v2 內容工作。
