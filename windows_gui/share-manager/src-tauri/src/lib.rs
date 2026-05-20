mod commands;
mod share;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            commands::start_clipboard_poller(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::share_root,
            commands::list_transfers,
            commands::read_manifest,
            commands::send_path,
            commands::open_path,
            commands::reveal_in_explorer,
            commands::list_directory,
            commands::parent_directory,
            commands::home_directory,
            commands::desktop_directory,
            commands::load_settings,
            commands::save_settings,
            commands::check_connection,
            commands::speed_test_local,
            commands::pick_folder,
            commands::install_icon_theme,
            commands::load_icon_theme_def,
            commands::load_policy,
            commands::save_policy,
            commands::publish_profile,
            commands::list_profiles,
            commands::detect_project_language,
            commands::list_language_presets,
            commands::list_notes,
            commands::get_note,
            commands::save_note,
            commands::delete_note,
            commands::read_shared_clipboard,
            commands::write_shared_clipboard,
            commands::list_clipboard_history,
            commands::list_clipboard_entries,
            commands::copy_to_os_clipboard,
            commands::clear_own_clipboard_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
