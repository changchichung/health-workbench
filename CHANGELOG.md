# Changelog

## 0.1.0（2026-08-08）MVP 核心四件套

- `mhb` CLI：import（自動判型、冪等）/ rebuild / status / quality / knowledge update
- 健保存摺醫療類 JSON adapter：14 節區、藥局調劑回退、醫囑對帳、遮罩身分證歸戶
- Apple Health adapter：串流解析、來源別單位修正、epoch/離群旗標、檔內去重
- 跨批次累加合併：內容指紋（D1）、視窗接續、疑似改版偵測、步數防雙計
- knowledge：labs.yaml 40 條（附來源與引用日期）、健保藥品品項快取 join、
  非結論式用語建置檢查
- 單檔互動 dashboard：總覽/時間軸/用藥/趨勢＋全文搜尋，離線可用、
  深淺色、<10MB 閘門、繁體中文
