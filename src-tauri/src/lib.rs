mod commands;

use commands::files::select_project_folder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![select_project_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
