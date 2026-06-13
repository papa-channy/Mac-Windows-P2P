mod commands;
mod share;

/// Reveal the main window on the monitor under the cursor (the "active"
/// monitor), clamped to fit that monitor and centered. Fixes the multi-monitor
/// regression where the tray-hidden / single-instance re-show always reappears
/// on the last monitor, plus DPI overflow on a lower-DPI screen.
fn reveal_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else { return };

    // Monitor under the cursor → fall back to current → primary.
    let monitor = win
        .cursor_position()
        .ok()
        .and_then(|c| {
            win.available_monitors().ok().and_then(|mons| {
                mons.into_iter().find(|m| {
                    let p = m.position();
                    let s = m.size();
                    let x0 = p.x as f64;
                    let y0 = p.y as f64;
                    c.x >= x0
                        && c.x < x0 + s.width as f64
                        && c.y >= y0
                        && c.y < y0 + s.height as f64
                })
            })
        })
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());

    if let Some(mon) = monitor {
        let mp = mon.position();
        let ms = mon.size();
        // Always size to 2/3 × 2/3 of the active monitor, centered.
        let w = ((ms.width as f64) * 2.0 / 3.0) as u32;
        let h = ((ms.height as f64) * 2.0 / 3.0) as u32;
        let _ = win.set_size(tauri::PhysicalSize::new(w.max(1), h.max(1)));
        let x = mp.x + (ms.width as i32 - w as i32) / 2;
        let y = mp.y + (ms.height as i32 - h as i32) / 2;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }

    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch → reveal the existing (possibly tray-hidden) window
            // on the active monitor instead of spawning another instance.
            reveal_main_window(app);
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
                    "open" => reveal_main_window(app),
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
                        reveal_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Auto-start on login so the background clipboard sync is always available.
            let _ = app.autolaunch().enable();

            // First-launch: place + size the window for the active monitor too.
            reveal_main_window(app.handle());
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
