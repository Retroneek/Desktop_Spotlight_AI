mod commands;

use commands::files::{
    browse_project_folder, execute_filesystem_operations, execute_organization_plan,
    inspect_project_entries, preview_organization_plan, read_project_file_chunk, read_project_files,
    refresh_project_folder, rename_with_references, search_project_file_contents,
    search_project_folder, select_project_folder, undo_filesystem_operation, write_project_file,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            select_project_folder,
            refresh_project_folder,
            read_project_files,
            execute_filesystem_operations,
            preview_organization_plan,
            execute_organization_plan,
            browse_project_folder,
            search_project_folder,
            inspect_project_entries,
            read_project_file_chunk,
            search_project_file_contents,
            write_project_file,
            undo_filesystem_operation,
            rename_with_references,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
