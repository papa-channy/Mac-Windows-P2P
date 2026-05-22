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
pub fn send_path(source_path: String, category: String) -> Result<String, String> {
    let req = transfer::engine::build_request(
        PathBuf::from(&source_path),
        &category,
        Direction::MacToWindows,
        1,
        false,
    )
    .map_err(|e| e.to_string())?;
    match transfer::engine::send(&req) {
        Ok(o) => Ok(o.transfer_id),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn send_path_force(source_path: String, category: String) -> Result<String, String> {
    let req = transfer::engine::build_request(
        PathBuf::from(&source_path),
        &category,
        Direction::MacToWindows,
        1,
        true,
    )
    .map_err(|e| e.to_string())?;
    transfer::engine::send(&req)
        .map(|o| o.transfer_id)
        .map_err(|e| e.to_string())
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
