# Spike：JS 端串流解析 Apple Health 匯出（2026-08-09）

## 問題

Tauri App 化若採「匯入邏輯全 JS 重寫」路線（D-A 方案 1），唯一技術風險是
WebView 內的 JS 能否處理百 MB 量級的 Apple `輸出.xml`（真實檔數十萬筆；
需預留更大檔案空間）。本 spike 以 220MB／90.4 萬筆（其中命中 WANTED
型別 64 萬筆）的去識別化合成檔驗證，規模高於真實檔約 20%。

## 結果（全數通過）

| 項目 | 結果 | 門檻 |
|---|---|---|
| JS 分塊串流解析 220MB | **2.97s（74MB/s）**，峰值 RSS 295MB | 每月一次的匯入，<60s 都可接受 |
| 與 Python oracle 差分對帳 | **指紋全等**（`8fe91262bac635af`），64 萬筆逐型別計數、workouts、epoch 旗標全部一致 | 必須全等 |
| zip 串流路徑（DecompressionStream deflate-raw） | 19.7MB zip → 220MB，**0.35s**，RSS 98MB；正確解出中文檔名成員 | 可行即可 |
| Python 同檔基準 | 5.22s（42MB/s，ET.iterparse） | 參考值：JS 反而快 76% |

## 方法

- `gen_synthetic_export.py`：合成器。混入雜訊型別（28% 非 WANTED）、
  5% 帶 MetadataEntry 子元素的多行 Record、XML entity（`&amp;`）、
  epoch 佔位日期、DTD 前導。資料全合成，無個資。
- `parse_spike.mjs`：純 JS 解析器。4MB 分塊讀＋TextDecoder streaming
  （UTF-8 跨塊邊界安全）＋殘尾接續緩衝；抽 `<Record>`/`<Workout>`
  start tag 屬性，含 entity 解碼。無任何外部依賴，即 App 端可用寫法。
- `oracle_parse.py`：import 正式 adapter 的 WANTED 清單，以相同欄位
  定義產指紋，驗證「Python 版當 oracle 差分對帳」護欄本身可行。
- `zip_stream_spike.mjs`：純 JS 讀 zip EOCD／central directory，
  member 壓縮流餵 `DecompressionStream('deflate-raw')`（Web 標準 API，
  Safari 16.4+／WebView2 均支援）。

## 已知未覆蓋（留給 propose/apply）

1. 本測試跑在 Node（V8）。Windows WebView2 同為 V8 引擎，等價；
   macOS WKWebView 是 JavaScriptCore，字串吞吐可能慢 2-3x，
   但餘裕巨大（3x 慢仍 <10s）。apply 第一個 task 應在真實 Tauri
   WebView 內重跑本 spike 確認。
2. Tauri fs plugin 分塊讀的 IPC 吞吐、以及 tauri-plugin-sql 大量
   insert 的 IPC 開銷未測；設計上以批次 insert（單 transaction、
   多列 VALUES）緩解，於 apply 實測。
3. JS `parseFloat`（前綴寬鬆）與 Python `float()`（嚴格）對畸形數值
   行為不同；正式實作需明定數值解析契約並收進差分測試。
