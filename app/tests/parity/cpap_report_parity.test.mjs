// CPAP 的報告層跨語言對帳（2026-08-14 紅隊指出的防線缺口）。
//
// 既有的 parity harness 只接 nhi_json / nhi_xml / apple_health，因為 Python
// 端沒有 resmed adapter（CLI 功能凍結），所以無法做「同輸入檔各自匯入再比對」
// 的匯入層 parity。缺口在於：CPAP 三表的 quality_flags 與 date_ranges 兩端
// 從未被真正比對過，未來 Python 端漏加表也不會有測試轉紅。
//
// 補法：改比對**報告層**。由 JS 匯入合成 CPAP 素材建出一個實體庫，再讓兩端
// 各自對**同一個庫檔**產生 quality_flag_counts 與 date_ranges，逐位元組比對。
// 這正好涵蓋本輪改動的那兩份清單，且不需要 Python 具備 CPAP 匯入能力。
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeDriver } from "../../src/store/node_driver.js";
import { initSchema } from "../../src/store/schema.js";
import { createProfile } from "../../src/engine/profiles.js";
import { EngineStore } from "../../src/engine/store.js";
import { resmedEdfAdapter } from "../../src/adapters/resmed_edf.js";
import { REPO } from "./harness.mjs";
import { makeEdf, annotationRecord, STR_SIGNALS, SAD_SIGNALS, EVE_SIGNALS }
  from "../helpers/make_edf.mjs";

function memSource(bytes, name) {
  return { name, size: bytes.length,
    async readAt(o, l) { return bytes.subarray(o, o + l); },
    async *stream() { yield bytes; } };
}
const textSource = (t, n) => memSource(new TextEncoder().encode(t), n);
const IDENT = "#VRN     1\n#PNA     S9_AutoSet\n#SRN     XXXXXXXXX\n";

// 合成一天的 STR record；多段使用會讓 adapter 寫入 multi_session 旗標，
// 這正是要驗證兩端都統計得到的那個旗標
function day({ on = [600, 900], off = [780, 1000], dur = 460 } = {}) {
  const map = { "Mask On": on, "Mask Off": off, "Mask Dur": [dur],
    "Therapy Pres Me": [372], "Leak 95": [5], AHI: [24], AI: [24], HI: [0] };
  return STR_SIGNALS.map(s => map[s.label] ?? []);
}

test("CPAP 報告層同構：JS 與 Python 對同一個庫產生相同的品質旗標與日期範圍",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "cpap-parity-"));
    const dbPath = join(dir, "cpap.sqlite");
    const d = new NodeDriver(dbPath);
    await initSchema(d);
    const pid = await createProfile(d, "本人");

    const entries = [
      { relPath: "Identification.tgt", source: textSource(IDENT, "i") },
      { relPath: "STR.edf",
        source: memSource(makeEdf(STR_SIGNALS, [day(), day()],
          { startDate: "27.03.22" }), "STR.edf") },
      { relPath: "DATALOG/20230612_203533_EVE.edf",
        source: memSource((() => {
          const byteLen = EVE_SIGNALS[0].nsamp * 2;
          const recs = [{ onset: 115, duration: 11, label: "Obstructive Apnea" }]
            .map(e => annotationRecord(byteLen, 0, [e]));
          return makeEdf(EVE_SIGNALS, recs.map(() => [[]]),
            { reserved: "EDF+D", recordDuration: 0, annotationBytes: { 0: recs },
              startDate: "12.06.23", startTime: "20.35.33" });
        })(), "e.edf") },
      { relPath: "DATALOG/20230612_223536_SAD.edf",
        source: memSource(makeEdf(SAD_SIGNALS,
          [[new Array(60).fill(70), new Array(60).fill(96)]],
          { recordDuration: 60, startDate: "12.06.23", startTime: "22.35.36" }),
        "s.edf") },
    ];
    const res = await resmedEdfAdapter.importSourceSet(
      { rootName: "resmed", entries }, d, null, { profileId: pid });
    assert.equal(res.status, "ok");

    // 前置條件：素材真的產生了旗標與三張表的資料，否則這個對帳是空的
    const [{ c: flagged }] = await d.select(
      "SELECT count(*) c FROM cpap_daily WHERE quality_flags != ''");
    assert.ok(flagged > 0, "素材必須產生 quality_flags，否則比對沒有意義");
    for (const t of ["cpap_daily", "cpap_events", "cpap_oximetry"]) {
      const [{ c }] = await d.select(`SELECT count(*) c FROM ${t}`);
      assert.ok(c > 0, `${t} 必須有資料`);
    }

    const store = new EngineStore(d);
    const jsFlags = await store.qualityFlagCounts();
    const [jsRanges] = [await (async () => {
      // dateRanges 未 export，改以同一份對照表在此重算，語意與 quality_report.js
      // 的 DATE_RANGE_COLUMNS 相同；真正的守衛是下面與 Python 的比對
      const { buildIncremental } = await import("../../src/engine/quality_report.js");
      const r = await buildIncremental(store, { sourceInfo: {}, sections: {} });
      return r.date_ranges;
    })()];
    await d.close();

    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from src.store.db import Store",
      "from src.quality.quality_report import _date_ranges",
      "s = Store(sys.argv[1])",
      "print(json.dumps({'flags': s.quality_flag_counts(),",
      "                  'ranges': _date_ranges(s)}, ensure_ascii=False))",
    ].join("\n");
    const out = execFileSync("python3", ["-c", script, dbPath],
      { cwd: REPO, encoding: "utf-8" });
    const py = JSON.parse(out);

    assert.deepEqual(jsFlags, py.flags,
      "兩端的 quality_flag_counts 必須全等：清單漏表會在這裡現形");
    assert.deepEqual(jsRanges, py.ranges,
      "兩端的 date_ranges 必須全等（含鍵的集合與各自的起訖值）");
    assert.ok(Object.keys(jsRanges).includes("cpap_daily"),
      "CPAP 三表必須在日期範圍內，否則這個對帳沒有涵蓋到本輪的改動");
    assert.ok(Object.keys(jsFlags).length > 0, "必須真的比對到旗標");
  });
