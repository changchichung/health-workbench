import test from "node:test";
import assert from "node:assert/strict";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { appleHealthAdapter } from "../../src/adapters/apple_health.js";

// 回歸：chunk 邊界切在「<Record」標籤名中間時，紀錄不得被丟棄。
// 真實 百 MB 量級 檔差分對帳抓到（數十萬 vs 數十萬），根因＝掃描器對
// 不足 8 字元的殘尾 prefix 判定失敗後把「<Reco」當雜訊消化掉。

const XML = `<?xml version="1.0"?><HealthData>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="s" unit="count" startDate="2026-01-01 08:00:00 +0800" endDate="2026-01-01 08:01:00 +0800" value="100"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="s" unit="count" startDate="2026-01-02 08:00:00 +0800" endDate="2026-01-02 08:01:00 +0800" value="200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="s" unit="count" startDate="2026-01-03 08:00:00 +0800" endDate="2026-01-03 08:01:00 +0800" value="300"/>
</HealthData>`;

function sourceWithSplit(text, splitAt) {
  const bytes = new TextEncoder().encode(text);
  return {
    name: "boundary.xml",
    size: bytes.length,
    async readAt(offset, len) { return bytes.subarray(offset, offset + len); },
    async *stream() {
      yield bytes.subarray(0, splitAt);
      yield bytes.subarray(splitAt);
    },
  };
}

test("chunk 切在 <Record 標籤名中間：三筆全數入庫", async () => {
  // 對第二筆 Record 的標籤名逐字元位置各切一次（含 '<' 後 1~7 字元）
  const secondRecord = XML.indexOf("<Record", XML.indexOf("<Record") + 1);
  for (let off = 1; off <= 7; off++) {
    const d = new NodeDriver();
    await initSchema(d);
    const r = await appleHealthAdapter.importSource(
      sourceWithSplit(XML, secondRecord + off), d, null, {});
    assert.equal(r.report.sections.apple_records.records, 3,
      `切點 +${off}：掃描筆數`);
    const [{ c }] = await d.select("SELECT count(*) c FROM apple_records");
    assert.equal(c, 3, `切點 +${off}：入庫筆數`);
    await d.close();
  }
});

test("chunk 切在屬性值中間：紀錄完整（殘尾接續原有覆蓋）", async () => {
  const mid = XML.indexOf('value="200"') + 3;
  const d = new NodeDriver();
  await initSchema(d);
  await appleHealthAdapter.importSource(sourceWithSplit(XML, mid), d, null, {});
  const rows = await d.select(
    "SELECT value_numeric v FROM apple_records ORDER BY start_ts");
  assert.deepEqual(rows.map(r => r.v), [100, 200, 300]);
  await d.close();
});
