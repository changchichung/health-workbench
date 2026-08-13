import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { appleHealthAdapter } from "../../src/adapters/apple_health.js";
import { EngineStore } from "../../src/engine/store.js";
import { createProfile } from "../../src/engine/profiles.js";
import { nodeFileSource, resolveAppleDirNode } from "../helpers/node_source.mjs";

const REPO = new URL("../../..", import.meta.url).pathname;
const FIXTURE = `${REPO}/tests/fixtures/apple_sample.xml`;

async function freshDriver() {
  const d = new NodeDriver();
  await initSchema(d);
  d.pid = await createProfile(d, "本人"); // opts.profileId 必填（歸屬指定）
  return d;
}

test("匯入 apple fixture：與 Python CLI 同檔逐表筆數一致", async () => {
  const d = await freshDriver();
  const r = await appleHealthAdapter.importSource(
    await nodeFileSource(FIXTURE), d, null, { profileId: d.pid });
  assert.equal(r.status, "ok");
  const js = await new EngineStore(d).tableCounts();
  await d.close();

  const tmp = mkdtempSync(path.join(tmpdir(), "mhb-apple-"));
  const pyDb = path.join(tmp, "py.sqlite");
  execFileSync("python3", ["-m", "src.mhb_cli", "--db", pyDb, "import",
    FIXTURE, "--yes", "--no-rebuild"], { cwd: REPO, encoding: "utf-8" });
  const py = JSON.parse(execFileSync("python3", ["-c", [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from src.store.db import Store",
    `s = Store(${JSON.stringify(pyDb)})`,
    "print(json.dumps(s.table_counts()))",
  ].join("\n")], { cwd: REPO, encoding: "utf-8" }));
  assert.deepEqual(js, py, `JS=${JSON.stringify(js)} Python=${JSON.stringify(py)}`);
});

test("來源別單位規則：好轻體脂 0.255 → 25.5，原值保留＋旗標", async () => {
  const d = await freshDriver();
  await appleHealthAdapter.importSource(await nodeFileSource(FIXTURE), d, null, { profileId: d.pid });
  const rows = await d.select(
    "SELECT value_numeric, value_normalized, quality_flags FROM apple_records"
    + " WHERE type_zh='體脂率' AND value_numeric <= 1");
  assert.ok(rows.length >= 1, "fixture 應含 0-1 小數體脂紀錄（去識別化來源名）");
  for (const r of rows) {
    assert.ok(r.value_numeric <= 1);
    assert.equal(r.value_normalized, Math.round(r.value_numeric * 10000) / 100);
    assert.ok(r.quality_flags.includes("unit_normalized"));
  }
  await d.close();
});

test("品質旗標：epoch 佔位日期與離群值", async () => {
  const d = await freshDriver();
  await appleHealthAdapter.importSource(await nodeFileSource(FIXTURE), d, null, { profileId: d.pid });
  const [{ c: epoch }] = await d.select(
    "SELECT count(*) c FROM apple_records WHERE quality_flags LIKE '%epoch_placeholder_date%'");
  const [{ c: outlier }] = await d.select(
    "SELECT count(*) c FROM apple_records WHERE quality_flags LIKE '%out_of_range%'");
  assert.ok(epoch >= 1, "fixture 含 1970 佔位");
  assert.ok(outlier >= 1, "fixture 含 不可能的極低值 離群");
  await d.close();
});

test("檔內重複去除＋重複檔案跳過", async () => {
  const d = await freshDriver();
  const r1 = await appleHealthAdapter.importSource(
    await nodeFileSource(FIXTURE), d, null, { profileId: d.pid });
  const skipped = r1.report.dedup.skipped_dup.apple_records || 0;
  assert.ok(skipped >= 1, "fixture 含 27 筆型重複，應有檔內去重");
  const r2 = await appleHealthAdapter.importSource(
    await nodeFileSource(FIXTURE), d, null, { profileId: d.pid });
  assert.equal(r2.status, "skipped_duplicate");
  await d.close();
});

test("zip 匯入：壓縮後匯入結果與 XML 直接匯入等價（含中文檔名成員）", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "mhb-zip-"));
  const xmlCopy = path.join(tmp, "輸出.xml");
  copyFileSync(FIXTURE, xmlCopy);
  const zipPath = path.join(tmp, "export.zip");
  execFileSync("python3", ["-c", [
    "import zipfile, sys",
    `z = zipfile.ZipFile(${JSON.stringify(zipPath)}, 'w', zipfile.ZIP_DEFLATED)`,
    `z.write(${JSON.stringify(xmlCopy)}, 'apple_health_export/輸出.xml')`,
    "z.close()",
  ].join("\n")], { encoding: "utf-8" });

  const dXml = await freshDriver();
  await appleHealthAdapter.importSource(await nodeFileSource(FIXTURE), dXml, null, { profileId: dXml.pid });
  const xmlCounts = await new EngineStore(dXml).tableCounts();
  await dXml.close();

  const dZip = await freshDriver();
  const rz = await appleHealthAdapter.importSource(
    await nodeFileSource(zipPath), dZip, null, { profileId: dZip.pid });
  assert.equal(rz.status, "ok");
  assert.match(rz.report.source.filename, /export\.zip:apple_health_export\/輸出\.xml/);
  const zipCounts = await new EngineStore(dZip).tableCounts();
  await dZip.close();
  assert.deepEqual(zipCounts, xmlCounts);
});

test("資料夾情境：resolveAppleDirNode 找到非 cda 的 XML", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "mhb-dir-"));
  copyFileSync(FIXTURE, path.join(tmp, "export_cda.xml"));
  copyFileSync(FIXTURE, path.join(tmp, "輸出.xml"));
  const resolved = await resolveAppleDirNode(tmp);
  assert.equal(path.basename(resolved), "輸出.xml");
});

test("內容判型：DTD 前導的 XML 與 zip 檔都被識別", async () => {
  const src = await nodeFileSource(FIXTURE);
  const header = await src.readAt(0, Math.min(65536, src.size));
  assert.ok(appleHealthAdapter.detect(header, "改名.dat"));
  const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  assert.ok(appleHealthAdapter.detect(zipHeader, "export.zip"));
});
