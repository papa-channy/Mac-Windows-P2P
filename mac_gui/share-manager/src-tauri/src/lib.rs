mod announcement;
mod clipboard;
mod commands;
mod desktop_alias;
mod mount;
mod notes;
mod policy;
mod share;
mod transfer;
mod watcher;

#[cfg(test)]
pub(crate) mod test_util {
    //! Shared serialization point for tests that mutate process env (e.g.
    //! `$MW_SHARE_ROOT`, `$HOME`). Acquire this before touching env vars.
    use std::sync::Mutex;
    pub static ENV_LOCK: Mutex<()> = Mutex::new(());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            clipboard::start_poller(app.handle().clone());
            watcher::start(app.handle().clone());
            // Idempotent: re-creates the desktop symlink if the user dragged
            // share-manager.app into /Applications and the link is missing
            // or stale. Auto-update never invalidates this because the link
            // resolves /Applications/share-manager.app dynamically.
            let _ = desktop_alias::ensure_on_first_launch(app.handle());
            handle_launch_args(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::share_root,
            commands::list_transfers,
            commands::read_manifest,
            commands::send_path,
            commands::send_path_force,
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
            commands::mount_status,
            commands::ensure_mount,
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
            commands::list_clipboard_entries,
            commands::copy_to_os_clipboard,
            commands::clear_own_clipboard_history,
            commands::install_desktop_alias,
            commands::remove_desktop_alias,
            commands::desktop_alias_status,
            commands::get_release_notes,
            commands::current_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// If the binary was invoked as `share-manager --send <path>`, emit a
/// `send-request` event for the frontend to display the send dialog.
/// This is the entry point the Swift Quick Action launcher hits.
fn handle_launch_args(app: tauri::AppHandle) {
    use tauri::Emitter;
    let args: Vec<String> = std::env::args().collect();
    let mut send_paths: Vec<String> = Vec::new();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--send" if i + 1 < args.len() => {
                send_paths.push(args[i + 1].clone());
                i += 2;
            }
            _ => i += 1,
        }
    }
    if send_paths.is_empty() { return; }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let _ = app.emit("send-request", serde_json::json!({ "paths": send_paths }));
    });
}
