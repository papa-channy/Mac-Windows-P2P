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
            commands::start_file_watcher(app.handle().clone());
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
            commands::install_icon_theme_from_git,
            commands::install_icon_theme_from_vsix,
            commands::load_icon_theme_def,
            commands::verify_transfer,
            commands::auto_verify_pending,
            commands::list_log_entries,
            commands::append_worklog,
            commands::list_compressed_images,
            commands::compressed_image_path,
            commands::inspect_html_assets,
            commands::scan_git_repos,
            commands::publish_git_status,
            commands::list_git_status,
            commands::git_set_token,
            commands::git_has_token,
            commands::git_clear_token,
            commands::git_test_token,
            commands::git_ssh_status,
            commands::git_generate_ssh_key,
            commands::github_fetch_remote,
            commands::read_remote_cache,
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
            commands::clipboard_image_path,
            commands::copy_image_to_os_clipboard,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
