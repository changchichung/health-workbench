import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeDriver } from "../../src/store/node_driver.js";
import { attachDrugs } from "../../src/knowledge/drugs.js";

const REPO = new URL("../../..", import.meta.url).pathname;
const REAL_CACHE = path.join(REPO, "data/drug_items.sqlite");

async function fixtureCache() {
  const p = path.join(mkdtempSync(path.join(tmpdir(), "mhb-drug-")), "drug_items.sqlite");
  const d = new NodeDriver(p);
  await d.execute(`CREATE TABLE drug_items(
    code TEXT PRIMARY KEY, name_en TEXT, name_zh TEXT, ingredient TEXT,
    dosage_form TEXT, atc TEXT, leaflet_url TEXT, valid_until TEXT)`);
  await d.execute("CREATE TABLE cache_meta(key TEXT PRIMARY KEY, value TEXT)");
  await d.execute("INSERT INTO drug_items VALUES('A012345678','TESTDRUG','測試藥',"
    + "'testium','錠','N02BE01','https://example.invalid/leaflet','1150101')");
  await d.execute("INSERT INTO cache_meta VALUES('updated_at','2026-08-08')");
  await d.close();
  return p;
}

test("lookup：醫囑代碼前 10 碼命中；查無回 null；meta 可讀", async () => {
  const cache = await fixtureCache();
  const d = new NodeDriver();
  const drugs = await attachDrugs(d, cache);
  assert.equal(drugs.available, true);
  const hit = await drugs.lookup("A012345678ZZZ");
  assert.equal(hit.name_zh, "測試藥");
  assert.equal(await drugs.lookup("B999999999"), null);
  assert.equal(await drugs.lookup(null), null);
  assert.equal((await drugs.meta()).updated_at, "2026-08-08");
  await drugs.detach();
  await d.close();
});

test("快取不存在：available=false 且全部回 null（不外連）", async () => {
  const d = new NodeDriver();
  const drugs = await attachDrugs(d, "/nonexistent/dir/drug_items.sqlite");
  assert.equal(drugs.available, false);
  assert.equal(await drugs.lookup("A012345678"), null);
  assert.equal(await drugs.meta(), null);
  await d.close();
});

test("真實快取（本機才跑）：既有醫囑代碼可 join", { skip: !existsSync(REAL_CACHE) }, async () => {
  const d = new NodeDriver();
  const drugs = await attachDrugs(d, REAL_CACHE);
  assert.equal(drugs.available, true);
  const meta = await drugs.meta();
  assert.ok(meta.updated_at);
  await drugs.detach();
  await d.close();
});
