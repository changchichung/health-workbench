// EDF 解析純函式（change cpap-sleep-therapy task 2.3，design D11 的 fixture 表）。
// 全部為「人為指定的已知輸入 → 人為算出的已知輸出」數值斷言，不做往返比對，
// 也不與另一個實作比對（本輪明示豁免 Python oracle 差分對帳，假設 #65）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHeader, scaleValue, isSentinel, findSignal, readSignalRecord,
  actualRecordCount, parseTAL, readAnnotations, startISO, offsetISO,
  expandYear, EdfFormatError,
} from "../../src/adapters/edf.js";
import {
  makeEdf, annotationRecord, STR_SIGNALS, SAD_SIGNALS, EVE_SIGNALS,
} from "../helpers/make_edf.mjs";

const strRecord = (over = {}) => {
  const base = {
    "Mask On": [600], "Mask Off": [780], "Mask Dur": [170],
    "Therapy Pres Me": [372], "Leak 95": [5], "AHI": [24], "AI": [24], "HI": [0],
  };
  const merged = { ...base, ...over };
  return STR_SIGNALS.map(s => merged[s.label] ?? []);
};

test("header：固定頭與訊號頭欄位逐項正確", () => {
  const bytes = makeEdf(STR_SIGNALS, [strRecord()]);
  const h = parseHeader(bytes);
  assert.equal(h.version, "0");
  assert.equal(h.reserved, "EDF");
  assert.equal(h.signalCount, 8);
  assert.equal(h.recordCount, 1);
  assert.equal(h.recordDuration, 86400);
  assert.equal(h.headerBytes, 256 + 8 * 256);
  assert.deepEqual(h.start,
    { year: 2022, month: 3, day: 27, hour: 12, minute: 0, second: 0 });
  // bytesPerRecord = (10 + 10 + 1×6) × 2
  assert.equal(h.bytesPerRecord, 52);
  const ahi = findSignal(h, "AHI");
  assert.deepEqual(
    { physMin: ahi.physMin, physMax: ahi.physMax, digMin: ahi.digMin, digMax: ahi.digMax },
    { physMin: 0, physMax: 240, digMin: 0, digMax: 2400 });
});

test("兩位年份世紀展開：85-99 為 19xx、00-84 為 20xx", () => {
  assert.equal(expandYear(22), 2022);
  assert.equal(expandYear(84), 2084);
  assert.equal(expandYear(85), 1985);
  assert.equal(expandYear(99), 1999);
  assert.equal(expandYear(0), 2000);
});

test("縮放公式：指定數位值反推出人為算好的物理值", () => {
  const bytes = makeEdf(STR_SIGNALS, [strRecord()]);
  const h = parseHeader(bytes);
  // AHI: physMin=0 physMax=240 digMin=0 digMax=2400 → 每階 0.1
  const ahi = findSignal(h, "AHI");
  assert.equal(scaleValue(24, ahi), 2.4);
  assert.equal(scaleValue(0, ahi), 0);
  assert.equal(scaleValue(2400, ahi), 240);
  // Therapy Pres: physMax=30 digMax=1500 → 每階 0.02
  const pres = findSignal(h, "Therapy Pres Me");
  assert.equal(scaleValue(372, pres), 7.44);
  // Leak 95: physMax=5 digMax=250 → 每階 0.02
  const leak = findSignal(h, "Leak 95");
  assert.equal(scaleValue(5, leak), 0.1);
  // Mask Dur: physMax=1440 digMax=1440 → 1:1
  const dur = findSignal(h, "Mask Dur");
  assert.equal(scaleValue(170, dur), 170);
});

test("縮放公式：digMax == digMin 不除以零", () => {
  const sig = { physMin: 7, physMax: 7, digMin: 5, digMax: 5 };
  assert.equal(scaleValue(5, sig), 7);
  assert.equal(scaleValue(999, sig), 7);
});

test("哨兵判定：低於 digMin 才是缺測，合法的 0 值不可被吃掉", () => {
  const bytes = makeEdf(STR_SIGNALS, [strRecord()]);
  const h = parseHeader(bytes);
  const ahi = findSignal(h, "AHI");        // digMin 0
  const dur = findSignal(h, "Mask Dur");   // digMin 0
  const pres = { physMin: 4, physMax: 20, digMin: 200, digMax: 1000 };

  // 缺測：來源以 -1 表示，低於各訊號的 digMin
  assert.equal(isSentinel(-1, ahi), true);
  assert.equal(isSentinel(-1, dur), true);
  assert.equal(isSentinel(-1, pres), true, "digMin 為正數的訊號同樣以 -1 表示缺測");

  // 合法值不得被誤判為缺測：實測素材中有數百天的分項指數真的是 0、
  // 壓力欄真的等於 digMin，用 dig === digMin 判斷會把它們全部刪成 NULL
  assert.equal(isSentinel(0, ahi), false, "AHI 為 0 是完美的一晚，不是缺測");
  assert.equal(isSentinel(0, dur), false);
  assert.equal(isSentinel(200, pres), false, "壓力等於 digMin 是合法的最低壓");
  assert.equal(isSentinel(1, ahi), false);

  // 不可用物理值比對：同一個哨兵數位值在不同訊號縮放成不同數字
  assert.equal(scaleValue(-1, dur), -1);
  assert.equal(scaleValue(-1, ahi), -0.1);
  assert.equal(scaleValue(-1, { physMin: 0, physMax: 3, digMin: 0, digMax: 150 }), -0.02);
  assert.notEqual(scaleValue(-1, ahi), scaleValue(-1, dur),
    "物理值比對必然漏判，因此判定 MUST 在數位值層做");
});

test("標籤截斷：以檔案中實際出現的 16 字元字串比對", () => {
  // "Therapy Pres Med" 超過 16 字元的來源會被截斷，findSignal 必須用
  // 截斷後的字串才找得到
  const bytes = makeEdf(STR_SIGNALS, [strRecord()]);
  const h = parseHeader(bytes);
  assert.ok(findSignal(h, "Therapy Pres Me"), "截斷後字串應找得到");
  assert.equal(findSignal(h, "Therapy Pres Med"), null, "理想名稱找不到");
  for (const s of h.signals) {
    assert.ok(s.label.length <= 16, `label 不得超過 16 字元：${s.label}`);
  }
});

test("逐 record 讀值：多 record 與多樣本槽位對得上", () => {
  const bytes = makeEdf(STR_SIGNALS, [
    strRecord({ AHI: [24] }),
    strRecord({ AHI: [25] }),
    strRecord({ AHI: [6] }),
  ]);
  const h = parseHeader(bytes);
  const ahi = findSignal(h, "AHI");
  assert.equal(actualRecordCount(bytes, h), 3);
  const got = [0, 1, 2].map(r =>
    scaleValue(readSignalRecord(bytes, h, ahi, r)[0], ahi));
  assert.deepEqual(got, [2.4, 2.5, 0.6]);
  // 多槽位訊號：Mask On 有 10 個槽（同一天可分多段使用），未用的槽位在
  // 真實檔案中是哨兵而非 0，因為 0 代表「正午整就戴上」是合法值
  const on = findSignal(h, "Mask On");
  const slots = readSignalRecord(bytes, h, on, 0);
  assert.equal(slots.length, 10);
  assert.equal(slots[0], 600);
  assert.equal(isSentinel(slots[0], on), false, "第一段是有效值");
  assert.deepEqual([...slots.slice(1)].map(v => isSentinel(v, on)),
    new Array(9).fill(true), "其餘 9 個槽位皆為未使用");
  const used = [...slots].filter(v => !isSentinel(v, on));
  assert.equal(used.length, 1, "有效段數即 session_count 的來源");
});

test("跨午夜換算：自正午起算的分鐘數解回本地時刻", () => {
  const bytes = makeEdf(STR_SIGNALS, [strRecord()], { startTime: "12.00.00" });
  const h = parseHeader(bytes);
  assert.equal(startISO(h), "2022-03-27T12:00:00");
  // Mask On=600 → 正午起 600 分 → 當日 22:00
  assert.equal(offsetISO(h, 600 * 60), "2022-03-27T22:00:00");
  // Mask Off=780 → 正午起 780 分 → 隔日 01:00（跨午夜）
  assert.equal(offsetISO(h, 780 * 60), "2022-03-28T01:00:00");
  // 邊界：720 分整＝午夜
  assert.equal(offsetISO(h, 720 * 60), "2022-03-28T00:00:00");
});

test("跨月與跨年的日曆推進", () => {
  const bytes = makeEdf(STR_SIGNALS, [strRecord()], { startDate: "31.12.22" });
  const h = parseHeader(bytes);
  assert.equal(startISO(h), "2022-12-31T12:00:00");
  assert.equal(offsetISO(h, 780 * 60), "2023-01-01T01:00:00");
});

test("截斷檔：實際 record 數以資料區長度為準", () => {
  // 宣告 5 個 record 但只寫 2 個
  const bytes = makeEdf(STR_SIGNALS, [strRecord(), strRecord()],
    { declaredRecordCount: 5 });
  const h = parseHeader(bytes);
  assert.equal(h.recordCount, 5, "header 宣告值原樣保留");
  assert.equal(actualRecordCount(bytes, h), 2, "實際可讀只有 2");
  const ahi = findSignal(h, "AHI");
  assert.equal(readSignalRecord(bytes, h, ahi, 2), null, "超出範圍回 null");
});

test("recordCount 為 -1（錄製中）：以資料區長度為準，不得當成零筆", () => {
  // EDF 規格允許 nrec = -1 表示筆數未知。直接與資料長度取 min 會得 -1，
  // 整個檔案會被靜默當成沒有資料
  const bytes = makeEdf(STR_SIGNALS, [strRecord(), strRecord(), strRecord()],
    { declaredRecordCount: -1 });
  const h = parseHeader(bytes);
  assert.equal(h.recordCount, -1);
  assert.equal(actualRecordCount(bytes, h), 3);
});

test("TAL 解析：五類事件含未分類 Apnea，時間戳 TAL 不算事件", () => {
  const byteLen = EVE_SIGNALS[0].nsamp * 2;
  const recs = [
    annotationRecord(byteLen, 0, [{ onset: 0, duration: 0, label: "Recording starts" }]),
    annotationRecord(byteLen, 0, [{ onset: 115, duration: 11, label: "Obstructive Apnea" }]),
    annotationRecord(byteLen, 0, [{ onset: 188, duration: 14, label: "Central Apnea" }]),
    annotationRecord(byteLen, 0, [{ onset: 2605, duration: 1, label: "Hypopnea" }]),
    annotationRecord(byteLen, 0, [{ onset: 8623, duration: 11, label: "Apnea" }]),
  ];
  const bytes = makeEdf(EVE_SIGNALS, recs.map(() => [[]]),
    { reserved: "EDF+D", recordDuration: 0, annotationBytes: { 0: recs } });
  const h = parseHeader(bytes);
  assert.equal(h.isAnnotationFile, true);

  const events = readAnnotations(bytes, h);
  assert.deepEqual(events.map(e => e.label), [
    "Recording starts", "Obstructive Apnea", "Central Apnea", "Hypopnea", "Apnea",
  ], "五類標籤全部解出，未分類 Apnea 不可漏");
  assert.deepEqual(events.map(e => e.onset), [0, 115, 188, 2605, 8623]);
  assert.deepEqual(events.map(e => e.duration), [0, 11, 14, 1, 11]);
});

test("TAL 解析：單一 record 內多個事件與 NUL 填充", () => {
  const s = "+0\x14\x14\0+10\x155\x14Hypopnea\x14\0+20\x153\x14Central Apnea\x14\0\0\0\0";
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i);
  const tals = parseTAL(bytes);
  assert.equal(tals.length, 3);
  assert.equal(tals[0].isTimekeeping, true, "首個 TAL 是時間戳，label 為空");
  assert.deepEqual(tals[1], { onset: 10, duration: 5, labels: ["Hypopnea"], isTimekeeping: false });
  assert.deepEqual(tals[2],
    { onset: 20, duration: 3, labels: ["Central Apnea"], isTimekeeping: false });
});

test("TAL 解析：無 duration 的事件", () => {
  const s = "+0\x14\x14\0+42\x14Central Apnea\x14\0";
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i);
  const tals = parseTAL(bytes).filter(t => !t.isTimekeeping);
  assert.equal(tals.length, 1);
  assert.equal(tals[0].onset, 42);
  assert.equal(tals[0].duration, null);
});

test("SAD：1Hz、一 record 一分鐘，尾桶樣本不足照樣可讀", () => {
  const full = new Array(60).fill(0).map((_, i) => 60 + i);   // Pulse 60..119
  const spo2 = new Array(60).fill(0).map((_, i) => 95 + (i % 3)); // 95/96/97
  const partial = new Array(20).fill(0).map((_, i) => 70 + i);
  const bytes = makeEdf(SAD_SIGNALS, [[full, spo2], [partial, spo2]],
    { recordDuration: 60 });
  const h = parseHeader(bytes);
  assert.equal(h.recordDuration, 60);
  const pulse = findSignal(h, "Pulse");
  assert.equal(pulse.nsamp / h.recordDuration, 1, "取樣率為 1Hz");

  // Pulse: physMin=18 physMax=300 digMin=18 digMax=300 → 1:1
  const r0 = readSignalRecord(bytes, h, pulse, 0);
  assert.equal(scaleValue(r0[0], pulse), 60);
  assert.equal(scaleValue(r0[59], pulse), 119);
  // 第二個 record 只給 20 個值，其餘補 digMin（=哨兵），呼叫端據此算 sample_count
  const r1 = readSignalRecord(bytes, h, pulse, 1);
  assert.equal(scaleValue(r1[0], pulse), 70);
  assert.equal(isSentinel(r1[19], pulse), false);
  assert.equal(isSentinel(r1[20], pulse), true, "第 21 個起為補滿的哨兵");
  const real = [...r1].filter(v => !isSentinel(v, pulse));
  assert.equal(real.length, 20, "有效樣本數即 sample_count 的來源");
});

test("畸形檔：明確拋錯而非回傳半殘結構", () => {
  assert.throws(() => parseHeader(new Uint8Array(100)), EdfFormatError);
  // ns 欄位為 0
  const bytes = makeEdf(STR_SIGNALS, [strRecord()]);
  const broken = bytes.slice();
  for (let i = 0; i < 4; i += 1) broken[252 + i] = " ".charCodeAt(0);
  broken[255] = "0".charCodeAt(0);
  assert.throws(() => parseHeader(broken), EdfFormatError);
  // 訊號頭被截斷
  assert.throws(() => parseHeader(bytes.slice(0, 300)), EdfFormatError);
  // startdate 格式錯
  const badDate = bytes.slice();
  for (let i = 0; i < 8; i += 1) badDate[168 + i] = "X".charCodeAt(0);
  assert.throws(() => parseHeader(badDate), EdfFormatError);
});
