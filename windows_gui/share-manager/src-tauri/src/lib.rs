mod commands;
mod share;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch → reveal the existing (possibly tray-hidden) window
            // instead of spawning another instance.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            commands::start_clipboard_poller(app.handle().clone());
            commands::start_file_watcher(app.handle().clone());

            // Background-resident clipboard: a tray icon keeps the app (and its
            // clipboard poller) alive after the window is closed, so live clipboard
            // sharing no longer requires keeping the window open on both hosts.
            let open_i = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "완전 종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Mac-Window 공유 — 클립보드 백그라운드 동기화 중")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Auto-start on login so the background clipboard sync is always available.
            let _ = app.autolaunch().enable();
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it to the tray instead of quitting, keeping
            // the clipboard poller alive. Use the tray "완전 종료" item to exit.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
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
            commands::notify_test,
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
            commands::scan_and_publish_git,
            commands::git_file_diff,
            commands::git_config_read,
            commands::git_list_branches,
            commands::git_op_fetch,
            commands::git_op_pull,
            commands::git_op_push,
            commands::git_op_stash,
            commands::git_op_stash_pop,
            commands::publish_git_status,
            commands::list_git_status,
            commands::list_git_logs,
            commands::build_repo_graph,
            commands::git_set_token,
            commands::git_has_token,
            commands::git_clear_token,
            commands::git_test_token,
            commands::git_ssh_status,
            commands::git_generate_ssh_key,
            commands::git_publish_host_pubkey,
            commands::git_share_pat_to_peers,
            commands::git_pull_pat_from_share,
            commands::github_fetch_remote,
            commands::github_fetch_check_runs,
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
