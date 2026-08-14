# G3 驗證：差分對帳 harness 與真實資料演練（tasks 3.1/3.2，2026-08-09）

## 3.1 parity harness — PASS

`app/tests/parity/`（harness.mjs＋parity.test.mjs＋run_parity.mjs CLI）：
同組輸入檔分別經 Python adapter（直接呼叫、攔截報告 dict）與 JS 引擎
（NodeDriver）匯入兩個空庫，dump 規則依 design Implementation Contract：
排除自增 id 與 *_at 時間戳、外鍵解析為參照列自然鍵（doc_id→sha256、
profile_id→display_name|masked_id、encounter_id→section|record_fp）、
import_stats 以解析後物件比對；增量品質報告整包深度比對
（parse_errors 訊息文字兩語言必異，僅比筆數）。

fixture 全集（進 CI）：
- nhi 單檔、apple 單檔、nhi＋apple 依序同庫（每月例行形態）、
  同檔重複匯入（冪等跳過）：**4/4 全表與報告全等**

## 3.2 真實資料本機演練 — PASS

輸入：一份健保存摺醫療類 JSON（十萬位元組量級）＋一份 Apple 健康匯出
XML（百 MB 量級，數十萬筆掃描）。素材不進 repo／CI。
NHI XML 無 Python oracle，由跨格式對帳覆蓋（見下）。

- run_parity CLI：**PASS（26.4s），全表 dump 與報告全等**
- 三方筆數對照：Python 演練庫＝JS 演練庫＝既有資料庫，**七張表逐表
  相同**；該庫即由同兩份來源檔建成（`source_documents=2`），全等即
  具名解釋（各表實際筆數不記於此，見下方註）
- 中間庫檔位於 /tmp，未入 git

### 演練首跑抓到並修復的真 bug（差分護欄的直接戰果）

首跑 FAIL：兩邊的 `apple_records` **差 1 筆**（JS 少一筆
WalkingAsymmetryPercentage）。根因：串流掃描器在 chunk 邊界切在
`<Record` 標籤名中間時（殘尾如 `<Reco` 不足 8 字元），prefix 判定
失敗把殘尾當雜訊消化，該筆消失。220MB 合成檔 55 個 chunk 邊界未踩中，
真實檔踩中一次。

修復：殘尾距 buffer 尾不足以判定標籤名時保留給下一 chunk
（apple_health.js scan＋兩份 spike 同步）。回歸：
`tests/adapters/apple_boundary.test.mjs` 對標籤名逐字元切點（+1~+7）
與屬性值中間切點全覆蓋。修復後重跑真檔演練 PASS。

## NHI XML 跨格式對帳（3.2 補充，2.5 時完成）

真實同批 JSON/XML：以（section, record_fp）對齊，r1-r7 **全部紀錄**
指紋對齊零差異；r8 白名單
語意實測定案：官方 JSON 移除換行字元（非代換空白），含換行報告（6/7）
跨格式指紋必不同，弱鍵對齊後 report_text 去空白全等 7/7。
詳 app/tests/adapters/nhi_xml.test.mjs 與 spec 修訂紀錄。

---

註（2026-08-14）：本檔原本逐表列出演練庫的實際筆數與來源檔名。此 repo
公開，而各類醫療紀錄的筆數剖面合起來構成可辨識的個人健康資訊，已改為
只記「逐表相同」與差異值。方法與結論不受影響：對帳的效力來自「全等」
這個判準本身，不來自具體數量。
