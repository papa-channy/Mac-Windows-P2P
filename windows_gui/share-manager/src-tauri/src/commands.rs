use crate::share::{
    category_by_folder, manifests_dir, state_dir, ConnectionStatus, Direction, FsNode, IconTheme,
    Settings, SpeedResult, State,
};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const TREE_MAX_CHILDREN_PER_DIR: usize = 250;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn hide_console(_: &mut Command) {}

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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CategoryInfo {
    pub key: &'static str,
    pub label: &'static str,
    pub emoji: &'static str,
    pub folder: &'static str,
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
            let meta = match ent.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let name = ent.file_name().to_string_lossy().into_owned();
            let modified_iso = meta
                .modified()
                .ok()
                .and_then(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339().into())
                .unwrap_or_default();
            let size_bytes = if meta.is_file() { meta.len() } else { dir_size(&p) };
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
            });
        }
    }

    out.sort_by(|a, b| b.modified_iso.cmp(&a.modified_iso));
    Ok(out)
}

fn dir_size(p: &Path) -> u64 {
    let mut total: u64 = 0;
    for entry in walkdir::WalkDir::new(p).into_iter().filter_map(|e| e.ok()) {
        if let Ok(m) = entry.metadata() {
            if m.is_file() { total += m.len(); }
        }
    }
    total
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

#[tauri::command]
pub fn send_path(source_path: String, category: String) -> Result<String, String> {
    // Validate category early
    if crate::share::category_by_key(&category).is_none() {
        return Err(format!("unknown category: {category}"));
    }
    if !Path::new(&source_path).exists() {
        return Err(format!("source missing: {source_path}"));
    }

    // Shell out to the existing PowerShell sender so we don't duplicate logic yet.
    let here = current_script_root();
    let send_ps1 = here.join("send-to-mac.ps1");
    if !send_ps1.exists() {
        return Err(format!("send-to-mac.ps1 not found at {}", send_ps1.display()));
    }

    let pwsh = locate_pwsh();
    let mut cmd = Command::new(pwsh);
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", send_ps1.to_string_lossy().as_ref(),
        &source_path,
        "-Category", &category,
        "-NoGui",
    ]);
    hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| format!("failed to launch pwsh: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        return Err(format!("send failed (exit {:?}): {}\n{}", out.status.code(), stderr, stdout));
    }

    // Extract transfer_id from stdout if present
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("transfer_id: ") {
            return Ok(rest.trim().to_string());
        }
    }
    Ok(stdout.trim().to_string())
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

    if !is_dir {
        return node;
    }
    if depth >= max_depth {
        if let Ok(mut rd) = std::fs::read_dir(p) {
            if rd.next().is_some() {
                node.truncated = true;
            }
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
            // Skip hidden / system entries by name heuristic
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
            _ => a
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase()),
        }
    });

    let total = filtered.len();
    let take = total.min(TREE_MAX_CHILDREN_PER_DIR);
    for entry in filtered.into_iter().take(take) {
        node.children
            .push(build_tree(&entry.path(), max_depth, depth + 1));
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
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_directory() -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|e| e.to_string())?;
    Ok(format!("{}\\Desktop", home))
}

// ─── Settings ───────────────────────────────────────────────────
fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("settings.json")
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Settings {
    let p = settings_path(&app);
    if let Ok(raw) = std::fs::read_to_string(&p) {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            return s;
        }
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

    // TCP connect (single attempt, 3s timeout)
    let addr_iter = format!("{}:{}", host, port).to_socket_addrs();
    if let Ok(mut addrs) = addr_iter {
        if let Some(addr) = addrs.next() {
            let start = Instant::now();
            match TcpStream::connect_timeout(&addr, Duration::from_secs(3)) {
                Ok(_) => {
                    status.tcp_reachable = true;
                    status.tcp_latency_ms = start.elapsed().as_millis() as u64;
                }
                Err(_) => {}
            }
        }
    }

    // ICMP via ping.exe
    let mut ping_cmd = Command::new("ping");
    ping_cmd.args(["-n", "2", "-w", "1500", &host]);
    hide_console(&mut ping_cmd);
    match ping_cmd.output() {
        Ok(out) if out.status.success() => {
            status.ping_reachable = true;
            // Parse "Average = NNNms" if present
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if let Some(idx) = line.find("Average =") {
                    let tail = &line[idx + "Average =".len()..];
                    let num: String = tail.chars().filter(|c| c.is_ascii_digit()).collect();
                    if let Ok(n) = num.parse::<u64>() {
                        status.ping_latency_ms = Some(n);
                        break;
                    }
                }
                // Korean Windows uses "평균 = NNNms"
                if let Some(idx) = line.find("평균 =") {
                    let tail = &line[idx + "평균 =".len()..];
                    let num: String = tail.chars().filter(|c| c.is_ascii_digit()).collect();
                    if let Ok(n) = num.parse::<u64>() {
                        status.ping_latency_ms = Some(n);
                        break;
                    }
                }
            }
        }
        _ => {}
    }

    Ok(status)
}

#[tauri::command]
pub fn speed_test_local(bytes: Option<u64>) -> Result<SpeedResult, String> {
    let total: u64 = bytes.unwrap_or(100 * 1024 * 1024); // default 100 MB
    let chunk_size: usize = 4 * 1024 * 1024; // 4 MB
    let chunk = vec![0u8; chunk_size];

    let test_dir = crate::share::share_root().join("00_System").join("_speedtest");
    std::fs::create_dir_all(&test_dir).map_err(|e| e.to_string())?;
    let test_file = test_dir.join("speedtest.bin");

    // Write
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

    // Read
    let read_start = Instant::now();
    let mut read_total: u64 = 0;
    {
        let mut f = std::fs::File::open(&test_file).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; chunk_size];
        loop {
            let n = f.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            read_total += n as u64;
        }
    }
    let read_elapsed = read_start.elapsed();

    // Cleanup
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

// ─── VSCode icon themes ─────────────────────────────────────────
fn json_has_icon_definitions(path: &Path) -> bool {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return false,
    };
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(v) => v.get("iconDefinitions").is_some(),
        Err(_) => false,
    }
}

fn find_icon_theme_json(root: &Path) -> Option<PathBuf> {
    // Direct
    let direct = root.join("icon-theme.json");
    if direct.exists() && json_has_icon_definitions(&direct) {
        return Some(direct);
    }
    // Common VSCode extension layouts
    let subdirs = [
        "themes",
        "src",
        "dist",
        "build",
        "extension/themes",
        "extension/src",
        "extension/dist",
    ];
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
    // Root-level fallback (any .json with iconDefinitions)
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

#[tauri::command]
pub fn install_icon_theme(folder: String) -> Result<IconTheme, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(format!("폴더가 아니에요: {folder}"));
    }
    let theme_json = find_icon_theme_json(&root)
        .ok_or_else(|| "icon-theme.json (iconDefinitions 포함) 을 찾지 못했어요".to_string())?;

    let raw = std::fs::read_to_string(&theme_json).map_err(|e| e.to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("JSON 파싱 실패: {e}"))?;

    // Try package.json for display name / id
    let folder_name = root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "(unknown)".to_string());

    let pkg_path = root.join("package.json");
    let (id, name) = if let Ok(pkg_raw) = std::fs::read_to_string(&pkg_path) {
        match serde_json::from_str::<serde_json::Value>(&pkg_raw) {
            Ok(pkg) => {
                let display = pkg
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let pkg_name = pkg
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let id = pkg_name.clone().unwrap_or_else(|| folder_name.clone());
                let name = display
                    .or(pkg_name)
                    .unwrap_or_else(|| folder_name.clone());
                (id, name)
            }
            Err(_) => (folder_name.clone(), folder_name.clone()),
        }
    } else {
        (folder_name.clone(), folder_name.clone())
    };

    let icon_count = v
        .get("iconDefinitions")
        .and_then(|d| d.as_object())
        .map(|o| o.len() as u32)
        .unwrap_or(0);

    Ok(IconTheme {
        id,
        name,
        root_path: root.to_string_lossy().into_owned(),
        theme_json_path: theme_json.to_string_lossy().into_owned(),
        icon_count,
    })
}

#[tauri::command]
pub fn load_icon_theme_def(theme_json_path: String) -> Result<serde_json::Value, String> {
    let raw = std::fs::read_to_string(&theme_json_path).map_err(|e| e.to_string())?;
    let def: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("JSON 파싱 실패: {e}"))?;
    let base_dir = PathBuf::from(&theme_json_path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(serde_json::json!({
        "base_dir": base_dir,
        "definition": def,
    }))
}

// ─── Shared policy + per-host profiles in share ────────────────
fn policy_path() -> PathBuf {
    crate::share::share_root()
        .join("00_System")
        .join("10_Config")
        .join("global")
        .join("policy.json")
}

fn profiles_dir() -> PathBuf {
    crate::share::share_root()
        .join("00_System")
        .join("10_Config")
        .join("profiles")
}

#[tauri::command]
pub fn load_policy() -> Result<serde_json::Value, String> {
    let p = policy_path();
    if !p.exists() {
        return Err(format!("policy.json 없음: {}", p.display()));
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("policy.json 파싱 실패: {e}"))
}

#[tauri::command]
pub fn save_policy(policy: serde_json::Value) -> Result<(), String> {
    let p = policy_path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(&policy).map_err(|e| e.to_string())?;
    std::fs::write(&p, pretty).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn publish_profile() -> Result<String, String> {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows-unknown".to_string());
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "(unknown)".to_string());
    let now = chrono::Local::now().to_rfc3339();
    let safe_host = host.replace(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'), "_");

    let dir = profiles_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{safe_host}.profile.json"));

    let profile = serde_json::json!({
        "schema_version": 1,
        "host": host,
        "host_id": safe_host,
        "os": "windows",
        "os_version": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "user": user,
        "published_at": now,
        "tools": {
            "share_manager": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": [
            "wpf-dialogs",
            "vscode-icon-themes",
            "policy-aware-send",
            "language-detection"
        ]
    });

    let pretty = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(&file, pretty).map_err(|e| e.to_string())?;
    Ok(file.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_profiles() -> Result<Vec<serde_json::Value>, String> {
    let dir = profiles_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn detect_project_language(path: String) -> Result<serde_json::Value, String> {
    // Load markers from policy.json
    let policy = load_policy().unwrap_or_else(|_| serde_json::json!({}));
    let markers = policy
        .get("language_detection")
        .and_then(|d| d.get("markers"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let git_dirs: Vec<String> = policy
        .get("language_detection")
        .and_then(|d| d.get("git_marker_dirs"))
        .and_then(|d| d.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_else(|| vec![".git".into(), ".hg".into(), ".svn".into()]);

    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("경로 없음: {path}"));
    }

    let mut detected: Vec<String> = Vec::new();
    let mut matched_markers: Vec<serde_json::Value> = Vec::new();
    let mut has_git = false;

    // Walk depth-2 only
    for entry in walkdir::WalkDir::new(&root).max_depth(2).into_iter().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().is_dir() && git_dirs.contains(&name) {
            has_git = true;
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if let serde_json::Value::Object(map) = &markers {
            for (lang, pats) in map {
                if let serde_json::Value::Array(arr) = pats {
                    for pat in arr {
                        let pat_s = match pat.as_str() {
                            Some(s) => s,
                            None => continue,
                        };
                        if file_matches_marker(&name, pat_s) {
                            if !detected.contains(lang) {
                                detected.push(lang.clone());
                            }
                            matched_markers.push(serde_json::json!({
                                "language": lang,
                                "marker": pat_s,
                                "path": entry.path().display().to_string()
                            }));
                        }
                    }
                }
            }
        }
    }

    Ok(serde_json::json!({
        "path": path,
        "has_git": has_git,
        "detected_languages": detected,
        "markers": matched_markers,
    }))
}

fn file_matches_marker(name: &str, pattern: &str) -> bool {
    // Simple matcher: exact match OR "*.ext" glob.
    if pattern.starts_with("*.") {
        let suffix = &pattern[1..];
        return name.to_ascii_lowercase().ends_with(&suffix.to_ascii_lowercase());
    }
    name == pattern
}

// ─── Shared notes (60_Notes) ───────────────────────────────────
fn notes_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("60_Notes");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn current_host_info() -> serde_json::Value {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    serde_json::json!({ "host": host, "os": "windows" })
}

#[tauri::command]
pub fn list_notes() -> Result<Vec<serde_json::Value>, String> {
    let dir = notes_dir();
    let mut out: Vec<serde_json::Value> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
                // Strip body for list view to keep payload small
                if let Some(obj) = v.as_object_mut() {
                    if let Some(body) = obj.get("body").and_then(|x| x.as_str()) {
                        let snippet: String = body.chars().take(160).collect();
                        obj.insert("snippet".into(), serde_json::Value::String(snippet));
                    }
                    obj.remove("body");
                }
                out.push(v);
            }
        }
    }
    out.sort_by(|a, b| {
        let am = a.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
        let bm = b.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
        bm.cmp(am)
    });
    Ok(out)
}

#[tauri::command]
pub fn get_note(id: String) -> Result<serde_json::Value, String> {
    let p = notes_dir().join(format!("{}.json", sanitize_id(&id)));
    let raw = std::fs::read_to_string(&p).map_err(|e| format!("못 찾음: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_note(id: Option<String>, title: String, body: String) -> Result<serde_json::Value, String> {
    let now = chrono::Local::now().to_rfc3339();
    let id = match id {
        Some(s) if !s.is_empty() => sanitize_id(&s),
        _ => format!("note-{}", uuid::Uuid::new_v4().simple()),
    };
    let p = notes_dir().join(format!("{id}.json"));

    let created_at = if p.exists() {
        std::fs::read_to_string(&p)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| v.get("created_at").and_then(|x| x.as_str().map(String::from)))
            .unwrap_or_else(|| now.clone())
    } else {
        now.clone()
    };

    let note = serde_json::json!({
        "schema_version": 1,
        "id": id,
        "title": title,
        "body": body,
        "created_at": created_at,
        "updated_at": now,
        "updated_by": current_host_info(),
    });
    let pretty = serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?;
    std::fs::write(&p, pretty).map_err(|e| e.to_string())?;
    Ok(note)
}

#[tauri::command]
pub fn delete_note(id: String) -> Result<(), String> {
    let p = notes_dir().join(format!("{}.json", sanitize_id(&id)));
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sanitize_id(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect()
}

// ─── Shared clipboard (70_Clipboard) ───────────────────────────
fn clipboard_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("70_Clipboard");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn host_id_safe(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn own_history_path() -> PathBuf {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let safe = host_id_safe(&host);
    let safe = if safe.is_empty() { "windows".to_string() } else { safe };
    clipboard_dir().join(format!("{safe}.history.jsonl"))
}

fn append_own_clipboard_entry(text: &str) -> std::io::Result<()> {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let max_chars = 32_000;
    let stored: String = if text.chars().count() > max_chars {
        let mut s: String = text.chars().take(max_chars).collect();
        s.push_str("\n\u{2026}(truncated)");
        s
    } else {
        text.to_string()
    };

    let entry = serde_json::json!({
        "ts": chrono::Local::now().to_rfc3339(),
        "host": host,
        "os": "windows",
        "content": stored,
        "kind": "text",
        "len": text.chars().count(),
    });
    let line = serde_json::to_string(&entry).unwrap_or_default();

    use std::io::Write;
    let path = own_history_path();
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    f.write_all(line.as_bytes())?;
    f.write_all(b"\n")?;

    rotate_jsonl(&path, 200)?;
    Ok(())
}

fn rotate_jsonl(path: &Path, max_lines: usize) -> std::io::Result<()> {
    let content = std::fs::read_to_string(path)?;
    let mut lines: Vec<&str> = content.lines().collect();
    if lines.len() <= max_lines {
        return Ok(());
    }
    let start = lines.len() - max_lines;
    lines = lines[start..].to_vec();
    std::fs::write(path, lines.join("\n") + "\n")
}

// ─── File watcher (replaces UI polling) ────────────────────────
fn classify_event_path(p: &Path) -> &'static str {
    let s = p.to_string_lossy();
    let has = |needle: &str| s.contains(needle);
    if has("\\10_Exchange\\") || has("/10_Exchange/") { return "transfers"; }
    if has("\\70_Clipboard\\") || has("/70_Clipboard/") { return "clipboard"; }
    if has("\\60_Notes\\") || has("/60_Notes/") { return "notes"; }
    if has("\\profiles\\") || has("/profiles/") { return "profiles"; }
    ""
}

pub fn start_file_watcher(app: tauri::AppHandle) {
    use notify::{recommended_watcher, EventKind, RecursiveMode, Watcher};
    use tauri::Emitter;

    std::thread::spawn(move || {
        let share = crate::share::share_root();
        let watch_paths: Vec<PathBuf> = vec![
            share.join("10_Exchange"),
            share.join("00_System").join("70_Clipboard"),
            share.join("00_System").join("60_Notes"),
            share.join("00_System").join("10_Config").join("profiles"),
        ];
        for p in &watch_paths {
            let _ = std::fs::create_dir_all(p);
        }

        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = match recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("watcher init failed: {e}");
                return;
            }
        };
        for p in &watch_paths {
            if let Err(e) = watcher.watch(p, RecursiveMode::Recursive) {
                eprintln!("watch {} failed: {e}", p.display());
            }
        }

        use std::collections::HashMap;
        let mut last_emit: HashMap<&'static str, std::time::Instant> = HashMap::new();
        let debounce = std::time::Duration::from_millis(400);

        for res in rx {
            let event = match res {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                continue;
            }
            let mut topics_fired: std::collections::HashSet<&'static str> =
                std::collections::HashSet::new();
            for p in &event.paths {
                let topic = classify_event_path(p);
                if topic.is_empty() || topics_fired.contains(topic) {
                    continue;
                }
                topics_fired.insert(topic);
                let now = std::time::Instant::now();
                if let Some(prev) = last_emit.get(topic) {
                    if now.duration_since(*prev) < debounce {
                        continue;
                    }
                }
                last_emit.insert(topic, now);
                let _ = app.emit(
                    "share-changed",
                    serde_json::json!({
                        "topic": topic,
                        "path": p.to_string_lossy(),
                    }),
                );
            }
        }

        // Keep the watcher alive for the lifetime of the thread (rx drop ends loop).
        let _ = watcher;
    });
}

pub fn start_clipboard_poller(app: tauri::AppHandle) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    std::thread::spawn(move || {
        let mut last: Option<String> = None;
        // Initial small delay to let the window settle
        std::thread::sleep(std::time::Duration::from_millis(500));
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let text = match app.clipboard().read_text() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if text.is_empty() {
                continue;
            }
            if let Some(prev) = &last {
                if *prev == text {
                    continue;
                }
            }
            let _ = append_own_clipboard_entry(&text);
            last = Some(text);
        }
    });
}

#[tauri::command]
pub fn list_clipboard_entries(limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.unwrap_or(200);
    let dir = clipboard_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut all: Vec<serde_json::Value> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&p) {
            for line in content.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    all.push(v);
                }
            }
        }
    }
    all.sort_by(|a, b| {
        let at = a.get("ts").and_then(|x| x.as_str()).unwrap_or("");
        let bt = b.get("ts").and_then(|x| x.as_str()).unwrap_or("");
        bt.cmp(at)
    });
    all.truncate(limit);
    Ok(all)
}

#[tauri::command]
pub fn copy_to_os_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_own_clipboard_history() -> Result<(), String> {
    let p = own_history_path();
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_shared_clipboard() -> Result<serde_json::Value, String> {
    let p = clipboard_dir().join("current.json");
    if !p.exists() {
        return Ok(serde_json::json!({
            "content": "",
            "kind": "text",
            "created_at": null,
            "from": null,
            "empty": true,
        }));
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = v.as_object_mut() { obj.insert("empty".into(), serde_json::Value::Bool(false)); }
    Ok(v)
}

#[tauri::command]
pub fn write_shared_clipboard(content: String) -> Result<serde_json::Value, String> {
    let now_str = chrono::Local::now().to_rfc3339();
    let payload = serde_json::json!({
        "content": content,
        "kind": "text",
        "created_at": now_str,
        "from": current_host_info(),
    });

    let dir = clipboard_dir();
    let pretty = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("current.json"), &pretty).map_err(|e| e.to_string())?;

    // Append history (keep last 50)
    let ts = chrono::Local::now().format("%Y%m%dT%H%M%S%.3f").to_string();
    let hist_file = dir.join("history").join(format!("{ts}.json"));
    std::fs::write(&hist_file, &pretty).ok();
    prune_clipboard_history(50);

    Ok(payload)
}

fn prune_clipboard_history(keep: usize) {
    let h = clipboard_dir().join("history");
    if let Ok(rd) = std::fs::read_dir(&h) {
        let mut files: Vec<_> = rd.flatten().collect();
        files.sort_by_key(|e| e.file_name());
        files.reverse();
        for old in files.into_iter().skip(keep) {
            let _ = std::fs::remove_file(old.path());
        }
    }
}

#[tauri::command]
pub fn list_clipboard_history(limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.unwrap_or(20);
    let h = clipboard_dir().join("history");
    if !h.exists() { return Ok(vec![]); }
    let mut files: Vec<_> = std::fs::read_dir(&h).map_err(|e| e.to_string())?.flatten().collect();
    files.sort_by_key(|e| e.file_name());
    files.reverse();

    let mut out = Vec::new();
    for entry in files.into_iter().take(limit) {
        if let Ok(raw) = std::fs::read_to_string(entry.path()) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_language_presets() -> Result<Vec<serde_json::Value>, String> {
    let dir = crate::share::share_root()
        .join("00_System")
        .join("10_Config")
        .join("ignore_rules")
        .join("_language_presets");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("shareignore") {
            continue;
        }
        let stem = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let content = std::fs::read_to_string(&p).unwrap_or_default();
        let line_count = content.lines().filter(|l| {
            let l = l.trim();
            !l.is_empty() && !l.starts_with('#')
        }).count();
        out.push(serde_json::json!({
            "language": stem,
            "path": p.to_string_lossy().into_owned(),
            "rule_count": line_count,
        }));
    }
    out.sort_by(|a, b| a["language"].as_str().unwrap_or("").cmp(b["language"].as_str().unwrap_or("")));
    Ok(out)
}

fn current_script_root() -> PathBuf {
    // share/00_System/20_Scripts/windows_gui/  — relative to share_root
    crate::share::share_root()
        .join("00_System")
        .join("20_Scripts")
        .join("windows_gui")
}

fn locate_pwsh() -> String {
    // Prefer pwsh 7 standard install; fall back to PATH-resolved "pwsh.exe", then powershell.exe
    let candidates = [
        r"C:\Program Files\PowerShell\7\pwsh.exe",
    ];
    for c in candidates {
        if Path::new(c).exists() { return c.to_string(); }
    }
    "pwsh.exe".to_string()
}
