// StoreDriver 的 tauri-plugin-sql 實作（App 端）。介面與 node_driver 同形。
// 注意：交易依賴 plugin 連線序列化（task 0.3 kill 演練已驗證原子性）；
// 上層以「同一時間僅一個匯入」防重入（app-import-gui spec）。
const BATCH_SIZE = 20000;

function resolveLoad() {
  const sql = window.__TAURI__?.sql;
  const load = sql?.Database?.load?.bind(sql.Database)
    || sql?.default?.load?.bind(sql.default)
    || sql?.load;
  if (!load) throw new Error("tauri-plugin-sql 不可用（withGlobalTauri 未注入）");
  return load;
}

export class TauriDriver {
  static async open(dbPath) {
    const d = new TauriDriver();
    d.db = await resolveLoad()(`sqlite:${dbPath}`);
    d.path = dbPath;
    await d.execute("PRAGMA foreign_keys = ON");
    return d;
  }

  async execute(sql, params = []) {
    const r = await this.db.execute(sql, params);
    return { changes: r.rowsAffected ?? 0, lastInsertRowid: r.lastInsertId ?? 0 };
  }

  async select(sql, params = []) {
    return this.db.select(sql, params);
  }

  // 批次寫入＝json_each 單參數展開（design D2 修訂；兩 driver 同 SQL 形狀）
  async batchInsert(table, columns, rows, { ignore = false } = {}) {
    if (rows.length === 0) return 0;
    const verb = ignore ? "INSERT OR IGNORE" : "INSERT";
    const sel = columns.map((_, c) => `json_extract(value,'$[${c}]')`).join(", ");
    const sql = `${verb} INTO ${table} (${columns.join(", ")}) SELECT ${sel} FROM json_each($1)`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const r = await this.db.execute(sql, [JSON.stringify(rows.slice(i, i + BATCH_SIZE))]);
      inserted += r.rowsAffected ?? 0;
    }
    return inserted;
  }

  async transaction(fn) {
    await this.execute("BEGIN");
    try {
      const result = await fn(this);
      await this.execute("COMMIT");
      return result;
    } catch (err) {
      await this.execute("ROLLBACK").catch(() => {});
      throw err;
    }
  }

  async close() {
    await this.db.close();
  }
}
