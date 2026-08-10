// driver 契約 smoke（task 1.3）：同一份程式碼由 node:test（NodeDriver）
// 與 App 內（TauriDriver，apply 期以 dev spike 驅動、輸出全等已驗證）
// 各跑一次的共用例程；保留供日後 driver 改動時複驗。
import { initSchema } from "./schema.js";

const COLS = ["profile_id", "doc_id", "activity", "start_ts", "end_ts",
  "duration_min", "source_name", "quality_flags"];

export async function runSmoke(driver) {
  await initSchema(driver);
  const tables = (await driver.select(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map(r => r.name);
  await driver.execute("INSERT INTO profiles(display_name) VALUES ('smoke')");
  await driver.execute(
    "INSERT INTO source_documents(profile_id,filename,sha256,adapter,adapter_version)"
    + " VALUES (1,'smoke','deadbeef','smoke','0')");
  const rows = Array.from({ length: 1000 }, (_, i) => [
    1, 1, "Walking",
    `2026-01-01 ${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`,
    "2026-01-02 00:00:00", i, `s${i % 7}`, ""]);
  const first = await driver.transaction(
    (tx) => tx.batchInsert("apple_workouts", COLS, rows, { ignore: true }));
  const dup = await driver.batchInsert("apple_workouts", COLS, rows, { ignore: true });
  const [{ c }] = await driver.select("SELECT count(*) c FROM apple_workouts");
  const [{ s }] = await driver.select("SELECT sum(duration_min) s FROM apple_workouts");
  return { tables, first, dup, count: c, dur_sum: s };
}
