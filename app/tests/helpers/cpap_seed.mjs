// CPAP 來源檔與三表的合成資料 seed（doc_rescue.test.mjs 與
// nondestructive.test.mjs 共用）。形狀照 DDL 欄位，數值為合成圓整值：
// 本 repo 公開，真實天數與事件數合起來是可辨識的個人健康資訊
// （紀律同 tests/helpers/batch_vector.mjs 檔頭）。
//
// 直接 INSERT 而不走 adapter：這兩個 harness 驗的是刪除／改歸屬／回滾的
// 語意，資料如何進庫不影響該語意。要驗匯入路徑本身請用
// tests/adapters/resmed_import.test.mjs（走真實 EDF fixture）。
//
// 新增 CPAP 欄位或表時，這裡與 app/src/store/schema.js 的 DDL 一起改，
// 否則兩個 harness 的斷言宇宙會靜默漏掉新欄位。
export async function seedCpapDoc(d, pid, { sha = "cpap-1", device = "Dev",
  date = "2023-06-12", tsSuffix = "20:00:00" } = {}) {
  const doc = await d.execute(
    "INSERT INTO source_documents(profile_id,filename,sha256,adapter,adapter_version)"
    + " VALUES(?,?,?,?,?)", [pid, `${sha}.edf`, sha, "resmed_edf", "1"]);
  const docId = doc.lastInsertRowid;
  await d.execute(
    "INSERT INTO cpap_daily(profile_id,doc_id,device,summary_date,ahi)"
    + " VALUES(?,?,?,?,?)", [pid, docId, device, date, 2.4]);
  await d.execute(
    "INSERT INTO cpap_events(profile_id,doc_id,device,session_date,start_ts,event_type)"
    + " VALUES(?,?,?,?,?,?)", [pid, docId, device, date, `${date}T${tsSuffix}`, "Apnea"]);
  await d.execute(
    "INSERT INTO cpap_oximetry(profile_id,doc_id,device,session_date,minute_ts,"
    + "spo2_min,sample_count) VALUES(?,?,?,?,?,?,?)",
    [pid, docId, device, date, `${date}T${tsSuffix}`, 95, 60]);
  return docId;
}

export const cpapCounts = async (d) => ({
  daily: (await d.select("SELECT COUNT(*) c FROM cpap_daily"))[0].c,
  events: (await d.select("SELECT COUNT(*) c FROM cpap_events"))[0].c,
  oximetry: (await d.select("SELECT COUNT(*) c FROM cpap_oximetry"))[0].c,
});
