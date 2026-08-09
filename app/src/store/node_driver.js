// StoreDriver 的 node:sqlite 實作（測試與 parity harness 用，不進 App bundle）。
// 介面契約（design D2）：execute / select / batchInsert / transaction，
// 全部回傳 Promise，與 App 端 tauri_driver 同形。
import { DatabaseSync } from "node:sqlite";

const BATCH_SIZE = 20000;

export class NodeDriver {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async execute(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...params);
    return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
  }

  async select(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  // 批次寫入＝json_each 單參數展開（task 0.3 實測：多列 VALUES 在
  // tauri-plugin-sql/sqlx 的參數綁定成本災難性，json_each 快 8 倍以上；
  // 兩個 driver 用同一種 SQL 形狀確保行為等價）。每批 BATCH_SIZE 列。
  // ignore=true 時用 INSERT OR IGNORE（自然鍵冪等去重）。回傳實際寫入列數。
  async batchInsert(table, columns, rows, { ignore = false } = {}) {
    if (rows.length === 0) return 0;
    const verb = ignore ? "INSERT OR IGNORE" : "INSERT";
    const sel = columns.map((_, c) => `json_extract(value,'$[${c}]')`).join(", ");
    const sql = `${verb} INTO ${table} (${columns.join(", ")}) SELECT ${sel} FROM json_each(?)`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const info = this.db.prepare(sql).run(JSON.stringify(rows.slice(i, i + BATCH_SIZE)));
      inserted += Number(info.changes);
    }
    return inserted;
  }

  // 交易：fn 內丟出即整批回滾並重丟。
  async transaction(fn) {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async close() {
    this.db.close();
  }
}
