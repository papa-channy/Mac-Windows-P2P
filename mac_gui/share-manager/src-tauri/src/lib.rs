mod announcement;
mod clipboard;
mod commands;
mod desktop_alias;
mod discovery;
mod git;
mod log_hub;
mod mount;
mod notes;
mod notify;
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

use tauri::{AppHandle, Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance MUST be the first plugin per the docs: any
        // second launch of the binary (via Service vendor, dock click,
        // open command, …) routes its argv to the on_new_instance
        // handler instead of spawning a second process.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            on_second_instance(app, argv);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            clipboard::start_poller(app.handle().clone());
            watcher::start(app.handle().clone());
            let _ = desktop_alias::ensure_on_first_launch(app.handle());

            // macOS: window should follow the user to whatever Space
            // they're on when they re-launch / re-foreground the app.
            if let Some(win) = app.get_webview_window("main") {
                apply_macos_space_behavior(&win);
            }

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
            commands::read_file_preview,
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
            commands::install_icon_theme_from_git,
            commands::install_icon_theme_from_vsix,
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
            commands::clipboard_image_path,
            commands::copy_image_to_os_clipboard,
            commands::verify_transfer,
            commands::install_desktop_alias,
            commands::remove_desktop_alias,
            commands::desktop_alias_status,
            commands::get_release_notes,
            commands::current_app_version,
            commands::open_privacy_settings,
            commands::has_full_disk_access,
            // T2 shared clipboard + compressed gallery
            commands::read_shared_clipboard,
            commands::write_shared_clipboard,
            commands::list_clipboard_history,
            commands::list_compressed_images,
            commands::compressed_image_path,
            // T3 auto-verify pending transfers
            commands::auto_verify_pending,
            // T7 quality framework worklog
            commands::append_worklog,
            // mDNS direct-link discovery
            discovery::discover_smb_hosts,
            // T4 Log Hub
            log_hub::list_log_entries,
            log_hub::append_log_worklog,
            // T6 HTML asset inspector (send pre-flight)
            commands::inspect_html_assets,
            // T1.1 git skeleton (17 commands)
            git::scan_git_repos,
            git::scan_and_publish_git,
            git::publish_git_status,
            git::list_git_status,
            git::list_git_logs,
            git::github_fetch_remote,
            git::github_fetch_check_runs,
            git::read_remote_cache,
            git::build_repo_graph,
            git::git_file_diff,
            git::git_config_read,
            git::git_list_branches,
            // Interactive git ops (Task #44)
            git::git_op_fetch,
            git::git_op_pull,
            git::git_op_push,
            git::git_op_stash,
            git::git_op_stash_pop,
            git::git_set_token,
            git::git_has_token,
            git::git_clear_token,
            git::git_test_token,
            git::git_ssh_status,
            git::git_generate_ssh_key,
            // PAT cross-host sync (ssh + age)
            git::git_publish_host_pubkey,
            git::git_share_pat_to_peers,
            git::git_pull_pat_from_share,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS dock click / `open -a` / Spotlight re-launch fires a
            // Reopen event into the running process; tauri-plugin-single-
            // instance only catches spawn-style relaunches, so we route
            // both paths through the same activator. Reapplying the
            // collection behavior right before show + focus is what
            // makes the window actually follow the user's active Space —
            // setting it once at setup() time isn't enough because the
            // backing NSWindow may not exist yet.
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(win) = app_handle.get_webview_window("main") {
                    apply_macos_space_behavior(&win);
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        });
}

// ─── argv parsing ──────────────────────────────────────────────────

#[derive(Default, Debug)]
struct ParsedArgs {
    /// Picker flow — show CategoryPickerModal in frontend.
    send_paths: Vec<String>,
    /// Immediate-send flow — Service vendor (right-click → Windows로 보내기).
    /// Backend invokes send_path directly with the default category.
    send_now_paths: Vec<String>,
}

fn parse_args(argv: &[String]) -> ParsedArgs {
    let mut out = ParsedArgs::default();
    let mut i = 1;
    while i < argv.len() {
        match argv[i].as_str() {
            "--send" if i + 1 < argv.len() => {
                out.send_paths.push(argv[i + 1].clone());
                i += 2;
            }
            "--send-now" if i + 1 < argv.len() => {
                out.send_now_paths.push(argv[i + 1].clone());
                i += 2;
            }
            _ => i += 1,
        }
    }
    out
}

// ─── First-launch (process argv via std::env::args) ────────────────

fn handle_launch_args(app: AppHandle) {
    let argv: Vec<String> = std::env::args().collect();
    let parsed = parse_args(&argv);
    dispatch(app, parsed);
}

// ─── Second-launch (delivered by tauri-plugin-single-instance) ─────

fn on_second_instance(app: &AppHandle, argv: Vec<String>) {
    // Reapply collectionBehavior BEFORE show + focus so the window
    // follows us to the active Space on activation. After show+focus
    // the behavior change has no effect on the current activation.
    if let Some(win) = app.get_webview_window("main") {
        apply_macos_space_behavior(&win);
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    let parsed = parse_args(&argv);
    dispatch(app.clone(), parsed);
}

fn dispatch(app: AppHandle, parsed: ParsedArgs) {
    if !parsed.send_paths.is_empty() {
        let paths = parsed.send_paths.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let _ = app.emit("send-request", serde_json::json!({ "paths": paths }));
        });
        return;
    }
    if !parsed.send_now_paths.is_empty() {
        let paths = parsed.send_now_paths.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            // Tiny delay so the window has time to come up if this is a
            // first launch — share_root() may need to read the mount.
            std::thread::sleep(std::time::Duration::from_millis(300));
            immediate_send_batch(&app_clone, &paths);
        });
    }
}

// ─── Immediate-send (Service-triggered, no picker) ─────────────────

fn immediate_send_batch(app: &AppHandle, paths: &[String]) {
    use tauri_plugin_notification::NotificationExt;
    let mut ok_count = 0usize;
    let mut first_err: Option<String> = None;
    let default_category = crate::share::category_by_key("documents")
        .expect("documents category must exist");
    for p in paths {
        match transfer::engine::send(&transfer::engine::TransferRequest {
            source: std::path::PathBuf::from(p),
            category: default_category,
            direction: share::Direction::MacToWindows,
            share_root: share::share_root(),
            source_host: hostname_or("Mac"),
            source_user: std::env::var("USER").unwrap_or_else(|_| "user".into()),
            batch_name: None,
            version: 1,
            overwrite_if_exists: false,
            now: chrono::Local::now(),
        }) {
            Ok(_) => ok_count += 1,
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("{p}: {e}"));
                }
            }
        }
    }
    let title = if ok_count == paths.len() {
        format!("✓ Windows로 {ok_count}개 전송 완료")
    } else if ok_count == 0 {
        "✗ 전송 실패".to_string()
    } else {
        format!("⚠ {} / {} 전송", ok_count, paths.len())
    };
    let body = first_err.unwrap_or_else(|| {
        let summary: Vec<String> = paths
            .iter()
            .map(|p| {
                std::path::Path::new(p)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(p)
                    .to_string()
            })
            .collect();
        summary.join(", ")
    });
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();

    // Tell the frontend to refresh its transfers list — it'll watch the
    // share via the watcher too, but emit a hint so the UI updates fast.
    let _ = app.emit("transfers-changed", serde_json::Value::Null);
}

fn hostname_or(fallback: &str) -> String {
    if let Ok(out) = std::process::Command::new("scutil").args(["--get", "LocalHostName"]).output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() { return s; }
        }
    }
    std::env::var("HOSTNAME").unwrap_or_else(|_| fallback.into())
}

// ─── macOS — make our window follow the user across Spaces ─────────

#[cfg(target_os = "macos")]
fn apply_macos_space_behavior(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    // NSWindowCollectionBehaviorMoveToActiveSpace = 1 << 1
    // Combined with .managed (1 << 2) it stays a normal window but
    // follows the user to whatever space they're on when activated.
    const MOVE_TO_ACTIVE_SPACE: u64 = 1 << 1;
    const MANAGED: u64 = 1 << 2;
    let behavior: u64 = MOVE_TO_ACTIVE_SPACE | MANAGED;
    match window.ns_window() {
        Ok(ptr) if !ptr.is_null() => unsafe {
            let _: () = msg_send![ptr as *mut objc2::runtime::AnyObject,
                setCollectionBehavior: behavior];
        },
        _ => {}
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_space_behavior(_window: &tauri::WebviewWindow) {}
