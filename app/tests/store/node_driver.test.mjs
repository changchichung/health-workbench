import test from "node:test";
import assert from "node:assert/strict";
import { NodeDriver } from "../../src/store/node_driver.js";

const DDL = "CREATE TABLE t (k TEXT, v REAL, UNIQUE(k))";

test("execute：DDL 與單筆寫入回報 changes", async () => {
  const d = new NodeDriver();
  await d.execute(DDL);
  const r = await d.execute("INSERT INTO t VALUES (?, ?)", ["a", 1]);
  assert.equal(r.changes, 1);
  await d.close();
});

test("select：回傳物件列", async () => {
  const d = new NodeDriver();
  await d.execute(DDL);
  await d.execute("INSERT INTO t VALUES ('a', 1), ('b', 2)");
  const rows = await d.select("SELECT k, v FROM t ORDER BY k");
  assert.deepEqual(rows.map(r => [r.k, r.v]), [["a", 1], ["b", 2]]);
  await d.close();
});

test("batchInsert：跨批次（>BATCH_SIZE 列）全數寫入", async () => {
  const d = new NodeDriver();
  await d.execute(DDL);
  const rows = Array.from({ length: 40003 }, (_, i) => [`k${i}`, i]);
  const n = await d.batchInsert("t", ["k", "v"], rows);
  assert.equal(n, 40003);
  const [{ c }] = await d.select("SELECT count(*) c FROM t");
  assert.equal(c, 40003);
  await d.close();
});

test("batchInsert ignore：自然鍵重複列被冪等跳過並回報實際寫入數", async () => {
  const d = new NodeDriver();
  await d.execute(DDL);
  await d.batchInsert("t", ["k", "v"], [["a", 1], ["b", 2]]);
  const n = await d.batchInsert("t", ["k", "v"], [["a", 9], ["c", 3]], { ignore: true });
  assert.equal(n, 1);
  const [{ v }] = await d.select("SELECT v FROM t WHERE k='a'");
  assert.equal(v, 1);
  await d.close();
});

test("transaction：fn 丟出即整批回滾", async () => {
  const d = new NodeDriver();
  await d.execute(DDL);
  await assert.rejects(
    d.transaction(async (tx) => {
      await tx.batchInsert("t", ["k", "v"], [["a", 1], ["b", 2]]);
      throw new Error("模擬中斷");
    }),
    /模擬中斷/,
  );
  const [{ c }] = await d.select("SELECT count(*) c FROM t");
  assert.equal(c, 0);
  await d.close();
});

test("transaction：成功即提交並回傳 fn 結果", async () => {
  const d = new NodeDriver();
  await d.execute(DDL);
  const out = await d.transaction(async (tx) => {
    await tx.batchInsert("t", ["k", "v"], [["a", 1]]);
    return "ok";
  });
  assert.equal(out, "ok");
  const [{ c }] = await d.select("SELECT count(*) c FROM t");
  assert.equal(c, 1);
  await d.close();
});
