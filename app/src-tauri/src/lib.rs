// Tauri 殼：插件註冊與 shell 層基礎設施 command，業務邏輯一律在前端 JS
// （design D1）。SQLite 橋（db_*）：每個 DB 路徑固定一條 rusqlite 連線、
// Mutex 序列化，提供真正的單連線交易語意（design D2 修訂二：
// tauri-plugin-sql 的 sqlx 10 連線池會讓跨呼叫 BEGIN/COMMIT 落在不同
// 連線，頁面重載遺留孤兒交易造成幽靈讀，2026-08-09 實測棄用）。

use rusqlite::types::{ToSqlOutput, Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};

struct DbState(Mutex<HashMap<String, Connection>>);

fn json_to_sql(v: &serde_json::Value) -> Result<ToSqlOutput<'_>, String> {
    Ok(match v {
        serde_json::Value::Null => ToSqlOutput::Owned(SqlValue::Null),
        serde_json::Value::Bool(b) => ToSqlOutput::Owned(SqlValue::Integer(*b as i64)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                ToSqlOutput::Owned(SqlValue::Integer(i))
            } else {
                ToSqlOutput::Owned(SqlValue::Real(n.as_f64().ok_or("數值超界")?))
            }
        }
        serde_json::Value::String(s) => ToSqlOutput::Borrowed(ValueRef::Text(s.as_bytes())),
        _ => return Err("不支援的參數型別（僅 null/bool/number/string）".into()),
    })
}

fn sql_to_json(v: ValueRef<'_>) -> Result<serde_json::Value, String> {
    Ok(match v {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(i) => serde_json::Value::from(i),
        ValueRef::Real(f) => serde_json::Value::from(f),
        ValueRef::Text(t) => {
            serde_json::Value::from(std::str::from_utf8(t).map_err(|e| e.to_string())?)
        }
        ValueRef::Blob(_) => return Err("不支援 BLOB 欄位".into()),
    })
}

fn with_conn<T>(
    state: &State<'_, DbState>,
    path: &str,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if !map.contains_key(path) {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        map.insert(path.to_string(), conn);
    }
    f(map.get(path).unwrap())
}

#[tauri::command]
fn db_execute(
    state: State<'_, DbState>,
    path: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<(i64, i64), String> {
    with_conn(&state, &path, |conn| {
        let bound: Vec<ToSqlOutput> = params
            .iter()
            .map(json_to_sql)
            .collect::<Result<_, _>>()?;
        let changes = conn
            .execute(&sql, params_from_iter(bound))
            .map_err(|e| e.to_string())?;
        Ok((changes as i64, conn.last_insert_rowid()))
    })
}

#[tauri::command]
fn db_select(
    state: State<'_, DbState>,
    path: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    with_conn(&state, &path, |conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let bound: Vec<ToSqlOutput> = params
            .iter()
            .map(json_to_sql)
            .collect::<Result<_, _>>()?;
        let mut rows = stmt
            .query(params_from_iter(bound))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut obj = serde_json::Map::new();
            for (i, name) in cols.iter().enumerate() {
                obj.insert(
                    name.clone(),
                    sql_to_json(row.get_ref(i).map_err(|e| e.to_string())?)?,
                );
            }
            out.push(obj);
        }
        Ok(out)
    })
}

#[tauri::command]
fn db_close(state: State<'_, DbState>, path: String) -> Result<bool, String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    Ok(map.remove(&path).is_some())
}

/// 開發模式資料庫路徑覆寫（design D5：路徑不可硬編碼）
#[tauri::command]
fn env_db_override() -> Option<String> {
    std::env::var("MHB_DB_PATH").ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(DbState(Mutex::new(HashMap::new())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_execute, db_select, db_close, env_db_override
        ])
        .run(tauri::generate_context!())
        .expect("app 啟動失敗");
}
