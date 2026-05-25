// commands.rs — Tauri command surface. Mirrors the Windows-side command
// names and request/response shapes (see windows_gui/share-manager) so the
// React frontend can target either backend through identical `invoke` calls.
//
// The Mac side replaces the Windows phase-1 PowerShell shim with a direct
// call into transfer::engine — same on-disk artifacts, one less hop.

use crate::share::{
    category_by_folder, manifests_dir, state_dir, ConnectionStatus, Direction, FsNode, IconTheme,
    Settings, SpeedResult, State,
};
use crate::transfer;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const TREE_MAX_CHILDREN_PER_DIR: usize = 250;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TransferItem {
    pub direction: String,
    pub state: String,
    pub category_key: String,
    pub category_label: String,
    pub category_emoji: String,
    pub category_folder: String,
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub modified_iso: String,
    pub is_dir: bool,
    /// Resolved by scanning the matching manifests dir for a manifest whose
    /// `destination.primary_file` equals `name`. None if no manifest found
    /// (orphan file — pre-shareguard contents).
    pub transfer_id: Option<String>,
}

#[tauri::command]
pub fn share_root() -> String {
    crate::share::share_root().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn list_transfers(direction: String, state: String) -> Result<Vec<TransferItem>, String> {
    let dir = Direction::parse(&direction).ok_or_else(|| format!("invalid direction: {direction}"))?;
    let st  = State::parse(&state).ok_or_else(|| format!("invalid state: {state}"))?;
    let base = state_dir(dir, st);
    if !base.exists() {
        return Ok(vec![]);
    }

    // Pre-load manifests for this direction → primary_file lookup map.
    let mut manifest_index: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mdir = crate::share::manifests_dir(dir);
    if let Ok(rd) = std::fs::read_dir(&mdir) {
        for ent in rd.flatten() {
            let p = ent.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            let raw = match std::fs::read(&p) { Ok(r) => r, Err(_) => continue };
            let v: serde_json::Value = match serde_json::from_slice(&raw) { Ok(v) => v, Err(_) => continue };
            let tid = v.get("transfer_id").and_then(|x| x.as_str()).map(String::from);
            let primary = v.get("destination").and_then(|d| d.get("primary_file")).and_then(|x| x.as_str()).map(String::from);
            if let (Some(t), Some(p)) = (tid, primary) {
                manifest_index.insert(p, t);
            }
        }
    }

    let mut out = Vec::new();
    let read_cat = std::fs::read_dir(&base).map_err(|e| e.to_string())?;
    for entry in read_cat.flatten() {
        let cat_path = entry.path();
        if !cat_path.is_dir() { continue; }
        let cat_folder = match cat_path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let cat = category_by_folder(&cat_folder);
        let (cat_key, cat_label, cat_emoji) = match cat {
            Some(c) => (c.key.to_string(), c.label.to_string(), c.emoji.to_string()),
            None    => (cat_folder.clone(), cat_folder.clone(), "📁".to_string()),
        };

        let items = match std::fs::read_dir(&cat_path) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for ent in items.flatten() {
            let p = ent.path();
            let meta = match ent.metadata() { Ok(m) => m, Err(_) => continue };
            let name = ent.file_name().to_string_lossy().into_owned();
            // skip hidden / sentinel
            if name.starts_with('.') { continue; }
            let modified_iso = meta
                .modified()
                .ok()
                .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339())
                .unwrap_or_default();
            let size_bytes = if meta.is_file() { meta.len() } else { dir_size(&p) };
            let transfer_id = manifest_index.get(&name).cloned();
            out.push(TransferItem {
                direction: dir.token().to_string(),
                state:     st.folder().to_string(),
                category_key: cat_key.clone(),
                category_label: cat_label.clone(),
                category_emoji: cat_emoji.clone(),
                category_folder: cat_folder.clone(),
                path: p.to_string_lossy().into_owned(),
                name,
                size_bytes,
                modified_iso,
                is_dir: meta.is_dir(),
                transfer_id,
            });
        }
    }
    out.sort_by(|a, b| b.modified_iso.cmp(&a.modified_iso));
    Ok(out)
}

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

#[tauri::command]
pub fn read_manifest(transfer_id: String) -> Result<serde_json::Value, String> {
    for dir in [Direction::MacToWindows, Direction::WindowsToMac] {
        let p = manifests_dir(dir).join(format!("{transfer_id}.json"));
        if p.exists() {
            let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
            let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            return Ok(v);
        }
    }
    Err(format!("manifest not found: {transfer_id}"))
}

/// Mac-side send: route directly through transfer::engine. Default direction
/// is mac_to_windows because that's the entry-point case (Quick Action click).
/// A 2nd optional arg flips it for the rare programmatic case.
#[tauri::command]
pub fn send_path(app: tauri::AppHandle, source_path: String, category: String) -> Result<String, String> {
    let req = transfer::engine::build_request(
        PathBuf::from(&source_path),
        &category,
        Direction::MacToWindows,
        1,
        false,
    )
    .map_err(|e| e.to_string())?;
    match transfer::engine::send(&req) {
        Ok(o) => {
            crate::log_hub::append_log(
                "send",
                serde_json::json!({
                    "event": "send_ok",
                    "source": source_path,
                    "category": category,
                    "transfer_id": o.transfer_id,
                }),
            );
            crate::notify::dispatch(
                &app,
                crate::notify::NotifyEvent::SendOk,
                "✓ Windows로 전송 완료",
                &format!("{} → {}", file_label(&source_path), category),
            );
            Ok(o.transfer_id)
        }
        Err(e) => {
            let msg = e.to_string();
            crate::log_hub::append_log(
                "error",
                serde_json::json!({
                    "event": "send_fail",
                    "source": source_path,
                    "category": category,
                    "stderr": msg,
                }),
            );
            crate::notify::dispatch(
                &app,
                crate::notify::NotifyEvent::SendFail,
                "✗ 전송 실패",
                &format!("{}: {}", file_label(&source_path), msg.lines().next().unwrap_or("")),
            );
            Err(msg)
        }
    }
}

fn file_label(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

#[tauri::command]
pub fn send_path_force(app: tauri::AppHandle, source_path: String, category: String) -> Result<String, String> {
    let req = transfer::engine::build_request(
        PathBuf::from(&source_path),
        &category,
        Direction::MacToWindows,
        1,
        true,
    )
    .map_err(|e| e.to_string())?;
    match transfer::engine::send(&req) {
        Ok(o) => {
            crate::log_hub::append_log(
                "send",
                serde_json::json!({
                    "event": "send_ok",
                    "source": source_path,
                    "category": category,
                    "transfer_id": o.transfer_id,
                    "forced": true,
                }),
            );
            crate::notify::dispatch(
                &app,
                crate::notify::NotifyEvent::SendOk,
                "✓ Windows로 전송 완료 (overwrite)",
                &format!("{} → {}", file_label(&source_path), category),
            );
            Ok(o.transfer_id)
        }
        Err(e) => {
            let msg = e.to_string();
            crate::log_hub::append_log(
                "error",
                serde_json::json!({
                    "event": "send_fail",
                    "source": source_path,
                    "category": category,
                    "stderr": msg,
                    "forced": true,
                }),
            );
            crate::notify::dispatch(
                &app,
                crate::notify::NotifyEvent::SendFail,
                "✗ 전송 실패 (overwrite)",
                &format!("{}: {}", file_label(&source_path), msg.lines().next().unwrap_or("")),
            );
            Err(msg)
        }
    }
}

#[tauri::command]
pub fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_in_explorer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_directory(path: String, max_depth: u32) -> Result<FsNode, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path not found: {path}"));
    }
    Ok(build_tree(&p, max_depth, 0))
}

fn build_tree(p: &Path, max_depth: u32, depth: u32) -> FsNode {
    let meta = std::fs::metadata(p).ok();
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| p.to_string_lossy().into_owned());
    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let size_bytes = if is_dir { 0 } else { meta.as_ref().map(|m| m.len()).unwrap_or(0) };

    let mut node = FsNode {
        name,
        path: p.to_string_lossy().into_owned(),
        is_dir,
        size_bytes,
        children: Vec::new(),
        truncated: false,
        child_overflow: 0,
    };
    if !is_dir { return node; }
    if depth >= max_depth {
        if let Ok(mut rd) = std::fs::read_dir(p) {
            if rd.next().is_some() { node.truncated = true; }
        }
        return node;
    }

    let entries: Vec<_> = match std::fs::read_dir(p) {
        Ok(rd) => rd.flatten().collect(),
        Err(_) => return node,
    };
    let mut filtered: Vec<_> = entries
        .into_iter()
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| !n.starts_with('.') && !n.starts_with('$'))
                .unwrap_or(true)
        })
        .collect();
    filtered.sort_by(|a, b| {
        let ad = a.metadata().map(|m| m.is_dir()).unwrap_or(false);
        let bd = b.metadata().map(|m| m.is_dir()).unwrap_or(false);
        match (ad, bd) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().to_string_lossy().to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase()),
        }
    });
    let total = filtered.len();
    let take = total.min(TREE_MAX_CHILDREN_PER_DIR);
    for entry in filtered.into_iter().take(take) {
        node.children.push(build_tree(&entry.path(), max_depth, depth + 1));
    }
    if total > take {
        node.child_overflow = (total - take) as u32;
    }
    node
}

#[tauri::command]
pub fn parent_directory(path: String) -> Result<String, String> {
    PathBuf::from(&path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "no parent".to_string())
}

#[tauri::command]
pub fn home_directory() -> Result<String, String> {
    std::env::var("HOME").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_directory() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    Ok(format!("{}/Desktop", home))
}

// ─── Settings ──────────────────────────────────────────────────
fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("settings.json")
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Settings {
    let p = settings_path(&app);
    if let Ok(raw) = std::fs::read_to_string(&p) {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) { return s; }
    }
    Settings::default()
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let p = settings_path(&app);
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

// ─── Network probes ────────────────────────────────────────────
#[tauri::command]
pub fn check_connection(host: String, port: Option<u16>) -> Result<ConnectionStatus, String> {
    let port = port.unwrap_or(445);
    let mut status = ConnectionStatus {
        host: host.clone(),
        port,
        tcp_reachable: false,
        tcp_latency_ms: 0,
        ping_reachable: false,
        ping_latency_ms: None,
    };

    if let Ok(mut addrs) = format!("{host}:{port}").to_socket_addrs() {
        if let Some(addr) = addrs.next() {
            let start = Instant::now();
            if TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok() {
                status.tcp_reachable = true;
                status.tcp_latency_ms = start.elapsed().as_millis() as u64;
            }
        }
    }

    // Mac ping: -c count, -W timeout in ms.
    let out = Command::new("ping")
        .args(["-c", "2", "-W", "1500", &host])
        .output();
    if let Ok(out) = out {
        if out.status.success() {
            status.ping_reachable = true;
            let text = String::from_utf8_lossy(&out.stdout);
            // "round-trip min/avg/max/stddev = 1.234/2.345/3.456/0.123 ms"
            for line in text.lines() {
                if let Some(idx) = line.find("min/avg/max") {
                    let after = &line[idx..];
                    let parts: Vec<&str> = after.split('=').collect();
                    if parts.len() >= 2 {
                        let nums: Vec<&str> = parts[1].trim().split('/').collect();
                        if nums.len() >= 2 {
                            if let Ok(avg) = nums[1].trim().parse::<f64>() {
                                status.ping_latency_ms = Some(avg.round() as u64);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(status)
}

#[tauri::command]
pub fn speed_test_local(bytes: Option<u64>) -> Result<SpeedResult, String> {
    let total: u64 = bytes.unwrap_or(100 * 1024 * 1024);
    let chunk_size: usize = 4 * 1024 * 1024;
    let chunk = vec![0u8; chunk_size];

    let test_dir = crate::share::share_root().join("00_System").join("_speedtest");
    std::fs::create_dir_all(&test_dir).map_err(|e| e.to_string())?;
    let test_file = test_dir.join("speedtest.bin");

    let write_start = Instant::now();
    {
        let mut f = std::fs::File::create(&test_file).map_err(|e| e.to_string())?;
        let mut written: u64 = 0;
        while written < total {
            let to_write = std::cmp::min(chunk_size as u64, total - written) as usize;
            f.write_all(&chunk[..to_write]).map_err(|e| e.to_string())?;
            written += to_write as u64;
        }
        f.sync_all().map_err(|e| e.to_string())?;
    }
    let write_elapsed = write_start.elapsed();

    let read_start = Instant::now();
    let mut read_total: u64 = 0;
    {
        let mut f = std::fs::File::open(&test_file).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; chunk_size];
        loop {
            let n = f.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            read_total += n as u64;
        }
    }
    let read_elapsed = read_start.elapsed();

    let _ = std::fs::remove_file(&test_file);
    let _ = std::fs::remove_dir(&test_dir);

    let mb = (read_total as f64) / (1024.0 * 1024.0);
    let w_sec = write_elapsed.as_secs_f64().max(0.000_001);
    let r_sec = read_elapsed.as_secs_f64().max(0.000_001);

    Ok(SpeedResult {
        bytes: read_total,
        write_ms: write_elapsed.as_millis() as u64,
        read_ms: read_elapsed.as_millis() as u64,
        write_mb_per_sec: mb / w_sec,
        read_mb_per_sec: mb / r_sec,
    })
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let path = rx.recv().map_err(|e| e.to_string())?;
    Ok(path.map(|fp| fp.to_string()))
}

// ─── Mount status ──────────────────────────────────────────────
#[tauri::command]
pub fn mount_status() -> serde_json::Value {
    match crate::mount::current_mount_url() {
        Some(p) => serde_json::json!({
            "mounted": true,
            "path": p.to_string_lossy(),
        }),
        None => serde_json::json!({
            "mounted": false,
            "path": null,
        }),
    }
}

#[tauri::command]
pub fn ensure_mount() -> serde_json::Value {
    match crate::mount::ensure_mounted(Duration::from_secs(12)) {
        Some(p) => serde_json::json!({
            "mounted": true,
            "path": p.to_string_lossy(),
        }),
        None => serde_json::json!({
            "mounted": false,
            "path": null,
            "hint": "mw CLI 미설치이거나 마운트 실패",
        }),
    }
}

// ─── VSCode icon themes (same logic as Windows) ────────────────
fn json_has_icon_definitions(path: &Path) -> bool {
    let raw = match std::fs::read_to_string(path) { Ok(s) => s, Err(_) => return false };
    matches!(
        serde_json::from_str::<serde_json::Value>(&raw),
        Ok(v) if v.get("iconDefinitions").is_some()
    )
}

/// Read package.json's contributes.iconThemes[].path entry, resolve it
/// relative to the package.json dir. Returns Some if a usable JSON is
/// found via that authoritative pointer.
fn icon_theme_path_via_package_json(pkg_path: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(pkg_path).ok()?;
    let pkg: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let themes = pkg.get("contributes")?.get("iconThemes")?.as_array()?;
    let base = pkg_path.parent()?;
    for t in themes {
        if let Some(rel) = t.get("path").and_then(|v| v.as_str()) {
            let resolved = base.join(rel.trim_start_matches("./"));
            if resolved.exists() && json_has_icon_definitions(&resolved) {
                return Some(resolved);
            }
        }
    }
    None
}

fn find_icon_theme_json(root: &Path) -> Option<PathBuf> {
    // Authoritative path: package.json's contributes.iconThemes[].path.
    // VSIX layouts use root/extension/package.json; git-checkout layouts
    // use root/package.json directly.
    for pkg_candidate in [root.join("package.json"), root.join("extension").join("package.json")] {
        if pkg_candidate.exists() {
            if let Some(p) = icon_theme_path_via_package_json(&pkg_candidate) {
                return Some(p);
            }
        }
    }

    // Heuristic fallback: well-known relative paths.
    let direct = root.join("icon-theme.json");
    if direct.exists() && json_has_icon_definitions(&direct) { return Some(direct); }
    let subdirs = ["themes", "src", "dist", "build", "extension/themes", "extension/src", "extension/dist"];
    for sub in &subdirs {
        let dir = root.join(sub);
        if dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().and_then(|s| s.to_str()) == Some("json")
                        && json_has_icon_definitions(&p)
                    {
                        return Some(p);
                    }
                }
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) == Some("json")
                && json_has_icon_definitions(&p)
            {
                return Some(p);
            }
        }
    }
    None
}

fn icon_theme_cache_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let root = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("MacWindowShare")
        .join("icon-themes");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn sanitize_basename(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// Download a VSIX (zip) and unzip it into the icon-theme cache, then
/// run install_icon_theme on the unzipped tree. The .vsix layout puts
/// the actual theme JSON at `extension/<...>/icon-theme.json`, found
/// authoritatively via the bundled `extension/package.json`.
#[tauri::command]
pub fn install_icon_theme_from_vsix(url: String, slug: Option<String>) -> Result<IconTheme, String> {
    use std::process::Command;
    let cache_root = icon_theme_cache_root()?;
    let basename = slug
        .as_deref()
        .map(sanitize_basename)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let from_url: String = url
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or("theme")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if from_url.is_empty() { "theme".to_string() } else { from_url }
        });
    let dest = cache_root.join(&basename);
    // Always re-download to pick up newer marketplace versions
    if dest.exists() { std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?; }
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let tmp_vsix = std::env::temp_dir().join(format!("{basename}-{}.vsix", uuid::Uuid::new_v4()));

    // --compressed: marketplace serves the VSIX gzip-encoded; without
    // this curl writes the gzip-wrapped bytes and unzip can't parse them.
    let out = Command::new("curl")
        .args(["-fsSL", "--compressed", "-o", tmp_vsix.to_string_lossy().as_ref(), &url])
        .output()
        .map_err(|e| format!("curl 실행 실패: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "VSIX 다운로드 실패 (exit {}): {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // VSIX = ZIP. /usr/bin/unzip is always present on macOS.
    let out = Command::new("/usr/bin/unzip")
        .args(["-q", "-o", tmp_vsix.to_string_lossy().as_ref(), "-d", dest.to_string_lossy().as_ref()])
        .output()
        .map_err(|e| format!("unzip 실행 실패: {e}"))?;
    let _ = std::fs::remove_file(&tmp_vsix);
    if !out.status.success() {
        return Err(format!(
            "VSIX 압축 해제 실패: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    install_icon_theme(dest.to_string_lossy().into_owned())
}

/// Clone a git repo containing a VSCode icon theme into the local cache,
/// then run install_icon_theme on it. Returns the IconTheme metadata so the
/// frontend can persist it in settings.appearance.icon_themes.
///
/// Cache location: ~/Library/Application Support/MacWindowShare/icon-themes/
#[tauri::command]
pub fn install_icon_theme_from_git(repo_url: String) -> Result<IconTheme, String> {
    use std::process::Command;
    let cache_root = icon_theme_cache_root()?;

    // Use the repo's basename as the cache subdir (sanitized).
    let basename: String = sanitize_basename(
        repo_url
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .rsplit('/')
            .next()
            .unwrap_or("theme"),
    );
    if basename.is_empty() {
        return Err(format!("invalid repo url: {repo_url}"));
    }
    let dest = cache_root.join(&basename);

    if dest.exists() {
        // Pull latest. Best-effort; ignore errors so stale cached repo still works.
        let _ = Command::new("git")
            .args(["-C", dest.to_string_lossy().as_ref(), "pull", "--ff-only", "--depth", "1"])
            .output();
    } else {
        let out = Command::new("git")
            .args(["clone", "--depth", "1", &repo_url, dest.to_string_lossy().as_ref()])
            .output()
            .map_err(|e| format!("git clone failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "git clone exit {}: {}",
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }

    install_icon_theme(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn install_icon_theme(folder: String) -> Result<IconTheme, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(format!("폴더가 아니에요: {folder}"));
    }
    let theme_json = find_icon_theme_json(&root)
        .ok_or_else(|| "icon-theme.json (iconDefinitions 포함) 을 찾지 못했어요".to_string())?;
    let raw = std::fs::read_to_string(&theme_json).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("JSON 파싱 실패: {e}"))?;

    let folder_name = root.file_name().map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "(unknown)".to_string());
    let pkg_path = root.join("package.json");
    let (id, name) = if let Ok(pkg_raw) = std::fs::read_to_string(&pkg_path) {
        match serde_json::from_str::<serde_json::Value>(&pkg_raw) {
            Ok(pkg) => {
                let display = pkg.get("displayName").and_then(|v| v.as_str()).map(String::from);
                let pkg_name = pkg.get("name").and_then(|v| v.as_str()).map(String::from);
                let id = pkg_name.clone().unwrap_or_else(|| folder_name.clone());
                let name = display.or(pkg_name).unwrap_or_else(|| folder_name.clone());
                (id, name)
            }
            Err(_) => (folder_name.clone(), folder_name.clone()),
        }
    } else { (folder_name.clone(), folder_name.clone()) };

    let icon_count = v.get("iconDefinitions").and_then(|d| d.as_object())
        .map(|o| o.len() as u32).unwrap_or(0);

    Ok(IconTheme {
        id, name,
        root_path: root.to_string_lossy().into_owned(),
        theme_json_path: theme_json.to_string_lossy().into_owned(),
        icon_count,
    })
}

#[tauri::command]
pub fn load_icon_theme_def(theme_json_path: String) -> Result<serde_json::Value, String> {
    let raw = std::fs::read_to_string(&theme_json_path).map_err(|e| e.to_string())?;
    let def: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("JSON 파싱 실패: {e}"))?;
    let base_dir = PathBuf::from(&theme_json_path).parent()
        .map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(serde_json::json!({ "base_dir": base_dir, "definition": def }))
}

// ─── Policy / profiles / language detection ────────────────────
#[tauri::command]
pub fn load_policy() -> Result<serde_json::Value, String> { crate::policy::load() }

#[tauri::command]
pub fn save_policy(policy: serde_json::Value) -> Result<(), String> { crate::policy::save(policy) }

#[tauri::command]
pub fn publish_profile() -> Result<String, String> { crate::policy::publish_profile() }

#[tauri::command]
pub fn list_profiles() -> Result<Vec<serde_json::Value>, String> { crate::policy::list_profiles() }

#[tauri::command]
pub fn detect_project_language(path: String) -> Result<serde_json::Value, String> {
    crate::policy::detect_project_language(path)
}

#[tauri::command]
pub fn list_language_presets() -> Result<Vec<serde_json::Value>, String> {
    crate::policy::list_language_presets()
}

// ─── Notes ─────────────────────────────────────────────────────
#[tauri::command]
pub fn list_notes() -> Result<Vec<serde_json::Value>, String> { crate::notes::list() }

#[tauri::command]
pub fn get_note(id: String) -> Result<serde_json::Value, String> { crate::notes::get(&id) }

#[tauri::command]
pub fn save_note(id: Option<String>, title: String, body: String) -> Result<serde_json::Value, String> {
    crate::notes::save(id, title, body)
}

#[tauri::command]
pub fn delete_note(id: String) -> Result<(), String> { crate::notes::delete(&id) }

// ─── Clipboard ─────────────────────────────────────────────────
#[tauri::command]
pub fn list_clipboard_entries(limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    crate::clipboard::list_entries(limit.unwrap_or(200))
}

#[tauri::command]
pub fn copy_to_os_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_own_clipboard_history() -> Result<(), String> {
    crate::clipboard::clear_own_history()
}

/// Return an absolute filesystem path for a stored clipboard image. The
/// frontend pipes this through tauri's `convertFileSrc` to render it via
/// the asset protocol.
#[tauri::command]
pub fn clipboard_image_path(image_ref: String) -> Result<String, String> {
    crate::clipboard::image_path_for_ref(&image_ref)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn copy_image_to_os_clipboard(app: tauri::AppHandle, image_ref: String) -> Result<(), String> {
    crate::clipboard::copy_image_to_os_clipboard(&app, &image_ref)
}

// ─── Shared clipboard (Windows §13 v2 mirror) ─────────────────
//
// These four wrap the helpers added in clipboard.rs. Frontend calls
// `read_shared_clipboard` to render the sticky-note panel,
// `write_shared_clipboard(content)` when the user edits it, and
// `list_clipboard_history(limit)` to populate the history flyout.

#[tauri::command]
pub fn read_shared_clipboard() -> Result<serde_json::Value, String> {
    crate::clipboard::read_shared_clipboard()
}

#[tauri::command]
pub fn write_shared_clipboard(content: String) -> Result<serde_json::Value, String> {
    crate::clipboard::write_shared_clipboard(content)
}

#[tauri::command]
pub fn list_clipboard_history(limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    crate::clipboard::list_clipboard_history(limit.unwrap_or(20))
}

#[tauri::command]
pub fn list_compressed_images() -> Result<Vec<serde_json::Value>, String> {
    crate::clipboard::list_compressed_images()
}

#[tauri::command]
pub fn compressed_image_path(image_ref: String) -> Result<String, String> {
    crate::clipboard::compressed_image_path(&image_ref)
}

// ─── Auto-verify pending transfers (T3) ────────────────────────
//
// Walks all manifests in the windows_to_mac direction (incoming files)
// and runs `verify_transfer` on each that hasn't been verified yet.
// Returns the count newly checked. Side effects:
//   - writes a tiny cache file <share>/00_System/80_Logs/verify/<id>.json
//     so subsequent ItemsView render can paint a ✓/✗ badge without
//     recomputing
//   - appends one log line per result (Wave B's Log Hub consumes these)

fn verify_cache_dir() -> PathBuf {
    crate::share::share_root()
        .join("00_System")
        .join("80_Logs")
        .join("verify")
}

#[tauri::command]
pub fn auto_verify_pending(app: tauri::AppHandle) -> Result<u32, String> {
    if !crate::mount::is_share_mounted() {
        return Ok(0);
    }
    let mdir = crate::share::manifests_dir(Direction::WindowsToMac);
    if !mdir.exists() {
        return Ok(0);
    }
    let cache = verify_cache_dir();
    let _ = std::fs::create_dir_all(&cache);

    let mut done = 0u32;
    if let Ok(rd) = std::fs::read_dir(&mdir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let tid = match p.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            // Skip if we already verified this transfer.
            if cache.join(format!("{tid}.json")).exists() {
                continue;
            }
            match verify_transfer(tid.clone()) {
                Ok(r) => {
                    let summary = serde_json::json!({
                        "transfer_id": r.transfer_id,
                        "ok": r.ok,
                        "checked": r.checked,
                        "mismatches": r.mismatches,
                        "missing": r.missing,
                        "ts": chrono::Local::now().to_rfc3339(),
                    });
                    let _ = std::fs::write(
                        cache.join(format!("{tid}.json")),
                        serde_json::to_string(&summary).unwrap_or_default(),
                    );
                    // Mirror Windows side: feed the shared 80_Logs hub
                    // so the Log Hub view shows Mac-originated activity
                    // alongside Windows entries.
                    if r.ok {
                        crate::log_hub::append_log(
                            "recv",
                            serde_json::json!({
                                "event": "verify_ok",
                                "transfer_id": r.transfer_id,
                                "checked": r.checked,
                                "direction": r.direction,
                            }),
                        );
                        crate::notify::dispatch(
                            &app,
                            crate::notify::NotifyEvent::VerifyOk,
                            "✓ 무결성 OK",
                            &format!("{} · {} files", r.transfer_id, r.checked),
                        );
                    } else {
                        crate::log_hub::append_log(
                            "error",
                            serde_json::json!({
                                "event": "verify_fail",
                                "transfer_id": r.transfer_id,
                                "mismatches": r.mismatches,
                                "missing": r.missing,
                                "direction": r.direction,
                            }),
                        );
                        crate::notify::dispatch(
                            &app,
                            crate::notify::NotifyEvent::VerifyFail,
                            "⚠ 무결성 불일치",
                            &format!(
                                "{} · mismatches={} missing={}",
                                r.transfer_id, r.mismatches, r.missing
                            ),
                        );
                    }
                    done += 1;
                }
                Err(err) => {
                    crate::log_hub::append_log(
                        "error",
                        serde_json::json!({
                            "event": "verify_error",
                            "transfer_id": tid,
                            "error": err,
                        }),
                    );
                }
            }
        }
    }
    Ok(done)
}

// ─── Worklog append (T7) ───────────────────────────────────────
//
// Writes a markdown bullet (or arbitrary multi-line body) to
// `mac_gui/share-manager/mockups/quality/WORKLOG/<date>.md`, creating
// the file if needed. Frontend uses this from any panel to journal
// what just happened.
#[tauri::command]
pub fn append_worklog(date: String, body: String) -> Result<(), String> {
    // Safety: date is part of a filename — must be plain YYYY-MM-DD.
    if !date.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("invalid date: {date}"));
    }
    // Resolve repo-relative path from the running executable. In dev mode
    // (cargo tauri dev) and release we both land somewhere under the
    // project tree; walk up until we find `mac_gui/`.
    let mut cur = std::env::current_exe().map_err(|e| e.to_string())?;
    let target_rel = std::path::Path::new("mac_gui/share-manager/mockups/quality/WORKLOG");
    let target = loop {
        cur = match cur.parent() {
            Some(p) => p.to_path_buf(),
            None => return Err("could not locate mac_gui/ in any parent dir".into()),
        };
        let candidate = cur.join(target_rel);
        if candidate.exists() {
            break candidate;
        }
        if cur.parent().is_none() {
            return Err("could not locate WORKLOG dir".into());
        }
    };
    let path = target.join(format!("{date}.md"));
    let mut existing = std::fs::read_to_string(&path).unwrap_or_default();
    if !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&body);
    if !body.ends_with('\n') {
        existing.push('\n');
    }
    std::fs::write(&path, existing).map_err(|e| e.to_string())
}

// ─── Transfer integrity verification ───────────────────────────
//
// Re-walk a transfer's manifest, recompute SHA-256 of every payload file
// against the share, and report mismatches. This is the user-facing
// "did the file arrive intact?" check.

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileVerifyResult {
    pub path: String,
    pub expected: String,
    pub actual: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VerifyResult {
    pub transfer_id: String,
    pub direction: String,
    pub mode: String,
    pub ok: bool,
    pub checked: u32,
    pub mismatches: u32,
    pub missing: u32,
    pub files: Vec<FileVerifyResult>,
}

fn manifest_path_for(transfer_id: &str) -> Option<(Direction, std::path::PathBuf)> {
    for dir in [Direction::MacToWindows, Direction::WindowsToMac] {
        let p = crate::share::manifests_dir(dir).join(format!("{transfer_id}.json"));
        if p.exists() { return Some((dir, p)); }
    }
    None
}

#[tauri::command]
pub fn verify_transfer(transfer_id: String) -> Result<VerifyResult, String> {
    use crate::transfer::hashing;
    use crate::transfer::manifest::Manifest;

    let (dir, manifest_path) = manifest_path_for(&transfer_id)
        .ok_or_else(|| format!("manifest not found: {transfer_id}"))?;
    let raw = std::fs::read(&manifest_path).map_err(|e| e.to_string())?;
    let m: Manifest = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;

    // Destination base is share/<direction.exchange_folder>/20_Ready/<cat_folder>/
    let dest_base = crate::share::share_root().join(&m.destination.share_path);

    let mut results = Vec::with_capacity(m.files.len());
    let mut mismatches = 0u32;
    let mut missing = 0u32;

    for entry in &m.files {
        // For file mode the manifest's `path` is the final filename;
        // for directory mode the destination is a folder containing
        // <primary_file>/<path>. We don't have nested-relative paths in
        // the v1 phase-1 manifest (totals.files_included always == 1
        // for file mode), so just join primary_file when mode != file.
        let abs = if m.mode == "directory" {
            // Reconstruct: dest_base/<primary_file>/<entry.path>
            // …but for v1 file mode entry.path IS the primary_file.
            // Directory mode currently writes a single entry covering
            // the whole folder. Recompute the dir-hash instead.
            dest_base.join(&m.destination.primary_file)
        } else {
            dest_base.join(&entry.path)
        };

        if !abs.exists() {
            missing += 1;
            results.push(FileVerifyResult {
                path: entry.path.clone(),
                expected: entry.sha256.clone(),
                actual: String::new(),
                ok: false,
                error: Some(format!("missing at {}", abs.display())),
            });
            continue;
        }

        // Recompute hash
        let actual = if m.mode == "directory" {
            match hashing::dir_hash(&abs) {
                Ok(d) => d.combined,
                Err(e) => {
                    results.push(FileVerifyResult {
                        path: entry.path.clone(),
                        expected: entry.sha256.clone(),
                        actual: String::new(),
                        ok: false,
                        error: Some(e.to_string()),
                    });
                    mismatches += 1;
                    continue;
                }
            }
        } else {
            match hashing::sha256_file(&abs) {
                Ok(s) => s,
                Err(e) => {
                    results.push(FileVerifyResult {
                        path: entry.path.clone(),
                        expected: entry.sha256.clone(),
                        actual: String::new(),
                        ok: false,
                        error: Some(e.to_string()),
                    });
                    mismatches += 1;
                    continue;
                }
            }
        };

        let ok = actual == entry.sha256;
        if !ok { mismatches += 1; }
        results.push(FileVerifyResult {
            path: entry.path.clone(),
            expected: entry.sha256.clone(),
            actual,
            ok,
            error: None,
        });
    }

    let checked = results.len() as u32;
    Ok(VerifyResult {
        transfer_id,
        direction: dir.token().to_string(),
        mode: m.mode,
        ok: mismatches == 0 && missing == 0,
        checked,
        mismatches,
        missing,
        files: results,
    })
}

// ─── Desktop alias ─────────────────────────────────────────────
#[tauri::command]
pub fn install_desktop_alias() -> Result<(), String> {
    crate::desktop_alias::install()
}

#[tauri::command]
pub fn remove_desktop_alias() -> Result<(), String> {
    crate::desktop_alias::remove()
}

#[tauri::command]
pub fn desktop_alias_status() -> serde_json::Value {
    use crate::desktop_alias::{current_status, AliasStatus};
    match current_status() {
        AliasStatus::Healthy => serde_json::json!({ "status": "healthy" }),
        AliasStatus::Misdirected(target) => serde_json::json!({
            "status": "misdirected",
            "target": target.to_string_lossy(),
        }),
        AliasStatus::BlockedByFile => serde_json::json!({ "status": "blocked_by_file" }),
        AliasStatus::Absent => serde_json::json!({ "status": "absent" }),
    }
}

// ─── Release notes ─────────────────────────────────────────────
#[tauri::command]
pub fn get_release_notes(app: tauri::AppHandle) -> Result<Vec<crate::announcement::ReleaseEntry>, String> {
    crate::announcement::load(&app)
}

#[tauri::command]
pub fn current_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Probe a Full-Disk-Access-protected path. Returns true if we currently
/// have FDA; false if we don't. As a side effect a failed read also
/// causes macOS to register our bundle in the FDA list (so the user can
/// actually find the toggle in System Settings without clicking +).
#[tauri::command]
pub fn has_full_disk_access() -> bool {
    // TCC.db is owned by root and only readable with Full Disk Access.
    // Every Mac has this file; opening it (read-only) is the canonical
    // FDA probe used by Cocoa apps.
    if std::fs::File::open("/Library/Application Support/com.apple.TCC/TCC.db").is_ok() {
        return true;
    }
    // Fallback probe: ~/Library/Mail — also FDA-only. Helps when running
    // on a stripped-down macOS install without the system TCC.db.
    if let Ok(home) = std::env::var("HOME") {
        let mail = std::path::PathBuf::from(home).join("Library").join("Mail");
        if std::fs::read_dir(mail).is_ok() {
            return true;
        }
    }
    false
}

/// Open System Settings to the Privacy & Security → Full Disk Access pane,
/// where the user can grant share-manager unrestricted filesystem access
/// so it stops hitting per-folder TCC prompts.
#[tauri::command]
pub fn open_privacy_settings(pane: Option<String>) -> Result<(), String> {
    // Known macOS x-apple anchors:
    //   Privacy_AllFiles               → Full Disk Access
    //   Privacy_DesktopFolder          → Desktop folder
    //   Privacy_DocumentsFolder        → Documents folder
    //   Privacy_DownloadsFolder        → Downloads folder
    //   Privacy_AppBundles             → App management
    let anchor = pane.as_deref().unwrap_or("Privacy_AllFiles");
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
    std::process::Command::new("open")
        .arg(&url)
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── T6 HTML dependency pre-flight ────────────────────────────────
//
// Mirror of windows_gui/.../commands.rs::inspect_html_assets. Scans a
// single .html file for *local relative* asset references that would
// not travel with a single-file send. Absolute URLs, data URIs, mailto:,
// javascript:, and anchors are filtered out so the caller only sees
// references that need to ship alongside.
//
// Used as a send pre-flight: the picker offers to send the .html's
// parent folder instead when any flagged asset is missing or has-inline-
// style is false but there are external references.

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HtmlAsset {
    pub reference: String,
    pub kind: String, // css | script | img | other
    pub exists: bool, // sibling file present next to the html
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HtmlInspect {
    pub is_html: bool,
    pub has_inline_style: bool,
    pub parent_dir: String,
    pub assets: Vec<HtmlAsset>,
}

fn html_extract_refs(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (pat, is_url) in [("href=", false), ("src=", false), ("url(", true)] {
        for (idx, _) in html.match_indices(pat) {
            let after = &html[idx + pat.len()..];
            let val: Option<String> = if is_url {
                let a = after.trim_start();
                let first = a.chars().next();
                if first == Some('"') || first == Some('\'') {
                    let qc = first.unwrap();
                    a[1..].find(qc).map(|e| a[1..1 + e].to_string())
                } else {
                    a.find(')').map(|e| a[..e].trim().to_string())
                }
            } else {
                let first = after.chars().next();
                if first == Some('"') || first == Some('\'') {
                    let qc = first.unwrap();
                    after[1..].find(qc).map(|e| after[1..1 + e].to_string())
                } else {
                    Some(
                        after
                            .split(|c: char| c.is_whitespace() || c == '>')
                            .next()
                            .unwrap_or("")
                            .to_string(),
                    )
                }
            };
            if let Some(v) = val {
                if !v.is_empty() {
                    out.push(v);
                }
            }
        }
    }
    out
}

fn html_classify_asset(s: &str) -> &'static str {
    let l = s.to_ascii_lowercase();
    if l.ends_with(".css") {
        "css"
    } else if l.ends_with(".js") || l.ends_with(".mjs") {
        "script"
    } else if [
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
    ]
    .iter()
    .any(|e| l.ends_with(e))
    {
        "img"
    } else {
        "other"
    }
}

#[tauri::command]
pub fn inspect_html_assets(path: String) -> Result<HtmlInspect, String> {
    let p = Path::new(&path);
    let is_html = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"))
        .unwrap_or(false);
    if !is_html || !p.is_file() {
        return Ok(HtmlInspect {
            is_html: false,
            has_inline_style: false,
            parent_dir: String::new(),
            assets: vec![],
        });
    }
    let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    let has_inline_style = content.to_ascii_lowercase().contains("<style");
    let parent = p.parent().unwrap_or_else(|| Path::new("."));

    let mut assets = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in html_extract_refs(&content) {
        let r = raw.trim().to_string();
        if r.is_empty() || r.starts_with('#') {
            continue;
        }
        let lower = r.to_ascii_lowercase();
        if lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("//")
            || lower.starts_with("data:")
            || lower.starts_with("mailto:")
            || lower.starts_with("javascript:")
            || lower.starts_with("tel:")
        {
            continue;
        }
        if !seen.insert(r.clone()) {
            continue;
        }
        let clean = r.split(['?', '#']).next().unwrap_or(&r);
        let rel = clean.replace('/', std::path::MAIN_SEPARATOR_STR);
        let exists = parent.join(&rel).exists() || parent.join(clean).exists();
        let kind = html_classify_asset(clean).to_string();
        assets.push(HtmlAsset {
            reference: r,
            kind,
            exists,
        });
    }
    Ok(HtmlInspect {
        is_html: true,
        has_inline_style,
        parent_dir: parent.to_string_lossy().into_owned(),
        assets,
    })
}

#[cfg(test)]
mod html_inspect_tests {
    use super::*;
    use std::io::Write as _;

    #[test]
    fn non_html_extension_returns_is_html_false() {
        let td = tempfile::tempdir().unwrap();
        let p = td.path().join("readme.txt");
        std::fs::write(&p, "<html></html>").unwrap();
        let r = inspect_html_assets(p.to_string_lossy().into_owned()).unwrap();
        assert!(!r.is_html);
        assert!(r.assets.is_empty());
    }

    #[test]
    fn detects_inline_style_and_local_assets() {
        let td = tempfile::tempdir().unwrap();
        let html = td.path().join("page.html");
        let mut f = std::fs::File::create(&html).unwrap();
        f.write_all(
            br#"<html><head><style>body{}</style>
<link rel="stylesheet" href="theme.css">
<script src="app.js"></script></head>
<body><img src="hero.png"><a href="https://example.com">x</a></body></html>"#,
        )
        .unwrap();
        // Create only one sibling so we can prove `exists` distinguishes.
        std::fs::write(td.path().join("theme.css"), b"").unwrap();
        let r = inspect_html_assets(html.to_string_lossy().into_owned()).unwrap();
        assert!(r.is_html);
        assert!(r.has_inline_style);
        let refs: Vec<&str> = r.assets.iter().map(|a| a.reference.as_str()).collect();
        assert!(refs.contains(&"theme.css"));
        assert!(refs.contains(&"app.js"));
        assert!(refs.contains(&"hero.png"));
        // Absolute URL filtered out.
        assert!(!refs.contains(&"https://example.com"));
        let css = r.assets.iter().find(|a| a.reference == "theme.css").unwrap();
        assert_eq!(css.kind, "css");
        assert!(css.exists);
        let js = r.assets.iter().find(|a| a.reference == "app.js").unwrap();
        assert_eq!(js.kind, "script");
        assert!(!js.exists);
        let img = r.assets.iter().find(|a| a.reference == "hero.png").unwrap();
        assert_eq!(img.kind, "img");
        assert!(!img.exists);
    }

    #[test]
    fn dedupes_repeated_refs_and_strips_query() {
        let td = tempfile::tempdir().unwrap();
        let html = td.path().join("page.htm");
        std::fs::write(
            &html,
            br#"<link href="a.css?v=1"><link href="a.css?v=2"><link href="a.css">"#,
        )
        .unwrap();
        std::fs::write(td.path().join("a.css"), b"").unwrap();
        let r = inspect_html_assets(html.to_string_lossy().into_owned()).unwrap();
        // 3 distinct text forms ("a.css?v=1", "a.css?v=2", "a.css") survive
        // the seen-set (we dedupe on the raw reference, not the cleaned
        // path) — and all three should resolve to existing because the
        // query-strip happens in the existence probe.
        assert_eq!(r.assets.len(), 3);
        for a in &r.assets {
            assert_eq!(a.kind, "css");
            assert!(a.exists, "{} should resolve", a.reference);
        }
    }
}

#[cfg(test)]
mod html_inspect_extra_tests {
    use super::*;

    #[test]
    fn filters_protocol_prefixes_and_anchors() {
        let td = tempfile::tempdir().unwrap();
        let html = td.path().join("page.html");
        std::fs::write(
            &html,
            br##"<html><body>
<a href="#top">top</a>
<a href="mailto:foo@example.com">m</a>
<a href="tel:+1234">t</a>
<a href="javascript:void(0)">j</a>
<a href="data:text/plain;base64,YWJj">d</a>
<a href="//cdn.example.com/x.js">proto-rel</a>
<a href="http://x.example.com/y">http</a>
</body></html>"##,
        )
        .unwrap();
        let r = inspect_html_assets(html.to_string_lossy().into_owned()).unwrap();
        assert!(r.is_html);
        // All of those refs are filtered out; nothing should remain.
        assert_eq!(r.assets.len(), 0, "all 7 refs are non-local");
    }

    #[test]
    fn classifies_kinds_by_extension() {
        let td = tempfile::tempdir().unwrap();
        let html = td.path().join("page.html");
        std::fs::write(
            &html,
            br#"<link href="m.mjs"><img src="i.WEBP"><a href="readme.md">"#,
        )
        .unwrap();
        let r = inspect_html_assets(html.to_string_lossy().into_owned()).unwrap();
        // case-insensitive extension classification
        let mjs = r.assets.iter().find(|a| a.reference == "m.mjs").unwrap();
        assert_eq!(mjs.kind, "script");
        let webp = r.assets.iter().find(|a| a.reference == "i.WEBP").unwrap();
        assert_eq!(webp.kind, "img");
        let md = r.assets.iter().find(|a| a.reference == "readme.md").unwrap();
        assert_eq!(md.kind, "other");
    }

    #[test]
    fn url_in_css_inline_style_attr_picked_up() {
        let td = tempfile::tempdir().unwrap();
        let html = td.path().join("page.html");
        std::fs::write(
            &html,
            br#"<div style="background: url('bg.png') no-repeat"></div>"#,
        )
        .unwrap();
        let r = inspect_html_assets(html.to_string_lossy().into_owned()).unwrap();
        let bg = r.assets.iter().find(|a| a.reference == "bg.png");
        assert!(bg.is_some(), "url() in style attr should be detected");
        assert_eq!(bg.unwrap().kind, "img");
    }

    #[test]
    fn missing_file_returns_propagated_error() {
        let r = inspect_html_assets("/nonexistent/path.html".to_string()).unwrap();
        // Not an html file (doesn't exist) → returns is_html: false.
        assert!(!r.is_html);
    }
}
