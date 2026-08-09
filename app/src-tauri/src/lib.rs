// Tauri 殼：僅插件註冊與 shell 層 command，業務邏輯一律在前端 JS（design D1）。

/// 開發模式資料庫路徑覆寫（design D5：路徑不可硬編碼）
#[tauri::command]
fn env_db_override() -> Option<String> {
    std::env::var("MHB_DB_PATH").ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![env_db_override])
        .run(tauri::generate_context!())
        .expect("app 啟動失敗");
}
