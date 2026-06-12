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
    /// Filled from the matching manifest whose `destination.primary_file`
    /// equals `name`. None if no manifest references this file.
    pub transfer_id: Option<String>,
    /// "ok" | "mismatch" from the verify cache, or None if not yet verified.
    pub verify_status: Option<String>,
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

    // Pre-load this direction's manifests → primary_file → transfer_id index.
    let mut manifest_index: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Ok(rd) = std::fs::read_dir(manifests_dir(dir)) {
        for ent in rd.flatten() {
            let p = ent.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            if let Ok(raw) = std::fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let tid = v.get("transfer_id").and_then(|x| x.as_str()).map(String::from);
                    let primary = v
                        .get("destination")
                        .and_then(|d| d.get("primary_file"))
                        .and_then(|x| x.as_str())
                        .map(String::from);
                    if let (Some(tid), Some(primary)) = (tid, primary) {
                        manifest_index.insert(primary, tid);
                    }
                }
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
            let transfer_id = manifest_index.get(&name).cloned();
            let verify_status = transfer_id.as_deref().and_then(read_verify_status);
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
                verify_status,
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

// ─── Transfer integrity verification ───────────────────────────
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

fn sha256_file(path: &Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

// §4.4 combined dir-hash: SHA-256 over concatenated "<rel>\0<sha256>\n"
// lines, entries sorted lexicographically by relative path.
//
// MUST match Mac's transfer::hashing::dir_hash exactly for cross-host verify:
//   1. skip hidden files (any rel component starting with '.', e.g. .git/.DS_Store)
//   2. rel path: backslash→slash, then NFC-normalize (Korean NFD↔NFC parity)
//   3. sort lexicographically; combined = rel\0sha\n (\n = 0x0A)
fn dir_hash_combined(root: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use unicode_normalization::UnicodeNormalization;
    let mut rows: Vec<(String, String)> = Vec::new();
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() { continue; }
        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rel
            .components()
            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
        {
            continue;
        }
        let rel_s: String = rel.to_string_lossy().replace('\\', "/").nfc().collect();
        let sha = sha256_file(entry.path()).map_err(|e| e.to_string())?;
        rows.push((rel_s, sha));
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Sha256::new();
    for (rel, sha) in rows {
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        hasher.update(sha.as_bytes());
        hasher.update([0x0Au8]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[tauri::command]
pub fn verify_transfer(transfer_id: String) -> Result<VerifyResult, String> {
    run_verify(&transfer_id)
}

fn run_verify(transfer_id: &str) -> Result<VerifyResult, String> {
    let mut found: Option<(Direction, serde_json::Value)> = None;
    for dir in [Direction::MacToWindows, Direction::WindowsToMac] {
        let p = manifests_dir(dir).join(format!("{transfer_id}.json"));
        if p.exists() {
            let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
            let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            found = Some((dir, v));
            break;
        }
    }
    let (dir, m) = found.ok_or_else(|| format!("manifest not found: {transfer_id}"))?;

    let mode = m.get("mode").and_then(|x| x.as_str()).unwrap_or("file").to_string();
    let share_path = m
        .get("destination")
        .and_then(|d| d.get("share_path"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let dest_base = crate::share::share_root().join(share_path);
    let files = m.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();

    let mut results = Vec::new();
    let mut mismatches = 0u32;
    let mut missing = 0u32;

    for entry in &files {
        let path = entry.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let expected = entry
            .get("sha256")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let abs = dest_base.join(&path);

        if !abs.exists() {
            missing += 1;
            results.push(FileVerifyResult {
                path,
                expected,
                actual: String::new(),
                ok: false,
                error: Some(format!("missing at {}", abs.display())),
            });
            continue;
        }

        let actual_res = if abs.is_dir() {
            dir_hash_combined(&abs)
        } else {
            sha256_file(&abs).map_err(|e| e.to_string())
        };
        match actual_res {
            Ok(actual) => {
                let ok = actual == expected;
                if !ok { mismatches += 1; }
                results.push(FileVerifyResult { path, expected, actual, ok, error: None });
            }
            Err(e) => {
                mismatches += 1;
                results.push(FileVerifyResult { path, expected, actual: String::new(), ok: false, error: Some(e) });
            }
        }
    }

    let checked = results.len() as u32;
    let result = VerifyResult {
        transfer_id: transfer_id.to_string(),
        direction: dir.token().to_string(),
        mode,
        ok: mismatches == 0 && missing == 0,
        checked,
        mismatches,
        missing,
        files: results,
    };
    write_verify_cache(&result);
    Ok(result)
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
        append_log("error", serde_json::json!({
            "event": "send_fail", "source": source_path, "category": category,
            "exit": out.status.code(), "stderr": stderr.trim(),
        }));
        return Err(format!("send failed (exit {:?}): {}\n{}", out.status.code(), stderr, stdout));
    }

    // Extract transfer_id from stdout if present
    let tid = stdout
        .lines()
        .find_map(|l| l.strip_prefix("transfer_id: ").map(|r| r.trim().to_string()))
        .unwrap_or_else(|| stdout.trim().to_string());
    append_log("send", serde_json::json!({
        "event": "send_ok", "source": source_path, "category": category, "transfer_id": tid,
    }));
    Ok(tid)
}

// ─── HTML dependency pre-flight (avoid shipping a bare .html) ───
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HtmlAsset {
    pub reference: String,
    pub kind: String,   // css | script | img | other
    pub exists: bool,   // sibling file present next to the html
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HtmlInspect {
    pub is_html: bool,
    pub has_inline_style: bool,
    pub parent_dir: String,
    pub assets: Vec<HtmlAsset>,
}

fn extract_html_refs(html: &str) -> Vec<String> {
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
                    Some(after.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string())
                }
            };
            if let Some(v) = val {
                if !v.is_empty() { out.push(v); }
            }
        }
    }
    out
}

fn classify_asset(s: &str) -> &'static str {
    let l = s.to_ascii_lowercase();
    if l.ends_with(".css") { "css" }
    else if l.ends_with(".js") || l.ends_with(".mjs") { "script" }
    else if [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"].iter().any(|e| l.ends_with(e)) { "img" }
    else { "other" }
}

/// Scan a single .html file for *local relative* asset references that
/// would not travel with a single-file send. Absolute URLs, data URIs,
/// and anchors are ignored. Used as a send pre-flight warning.
#[tauri::command]
pub fn inspect_html_assets(path: String) -> Result<HtmlInspect, String> {
    let p = Path::new(&path);
    let is_html = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"))
        .unwrap_or(false);
    if !is_html || !p.is_file() {
        return Ok(HtmlInspect { is_html: false, has_inline_style: false, parent_dir: String::new(), assets: vec![] });
    }
    let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    let has_inline_style = content.to_ascii_lowercase().contains("<style");
    let parent = p.parent().unwrap_or_else(|| Path::new("."));

    let mut assets = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in extract_html_refs(&content) {
        let r = raw.trim().to_string();
        if r.is_empty() || r.starts_with('#') { continue; }
        let lower = r.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://")
            || lower.starts_with("//") || lower.starts_with("data:")
            || lower.starts_with("mailto:") || lower.starts_with("javascript:")
            || lower.starts_with("tel:")
        { continue; }
        if !seen.insert(r.clone()) { continue; }
        // Strip query/fragment for the existence probe.
        let clean = r.split(['?', '#']).next().unwrap_or(&r);
        let rel = clean.replace('/', std::path::MAIN_SEPARATOR_STR);
        let exists = parent.join(&rel).exists() || parent.join(clean).exists();
        let kind = classify_asset(clean).to_string();
        assets.push(HtmlAsset { reference: r, kind, exists });
    }
    Ok(HtmlInspect {
        is_html: true,
        has_inline_style,
        parent_dir: parent.to_string_lossy().into_owned(),
        assets,
    })
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
fn icon_theme_cache_root() -> Result<PathBuf, String> {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .map_err(|e| format!("LOCALAPPDATA 없음: {e}"))?;
    let dir = base.join("MacWindowShare").join("icon-themes");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sanitize_basename(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// Catalog button → download a marketplace VSIX (zip), extract, install.
#[tauri::command]
pub fn install_icon_theme_from_vsix(url: String, slug: Option<String>) -> Result<IconTheme, String> {
    let cache_root = icon_theme_cache_root()?;
    let basename = slug
        .as_deref()
        .map(sanitize_basename)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let from_url = sanitize_basename(url.trim_end_matches('/').rsplit('/').next().unwrap_or("theme"));
            if from_url.is_empty() { "theme".to_string() } else { from_url }
        });
    let dest = cache_root.join(&basename);
    if dest.exists() { std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?; }
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let tmp_vsix = std::env::temp_dir().join(format!("{basename}-{}.vsix", uuid::Uuid::new_v4()));

    // curl.exe (built into Win10 1803+). --compressed: marketplace serves gzip.
    let mut cmd = Command::new("curl.exe");
    cmd.args(["-fsSL", "--compressed", "-o", tmp_vsix.to_string_lossy().as_ref(), &url]);
    hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| format!("curl 실행 실패: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "VSIX 다운로드 실패 (exit {}): {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // tar.exe (bsdtar, built into Win10 1803+) extracts zip/vsix.
    let mut cmd = Command::new("tar.exe");
    cmd.args(["-xf", tmp_vsix.to_string_lossy().as_ref(), "-C", dest.to_string_lossy().as_ref()]);
    hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| format!("tar 실행 실패: {e}"))?;
    let _ = std::fs::remove_file(&tmp_vsix);
    if !out.status.success() {
        return Err(format!(
            "VSIX 압축 해제 실패: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    install_icon_theme(dest.to_string_lossy().into_owned())
}

/// URL input → git clone --depth 1, then install.
#[tauri::command]
pub fn install_icon_theme_from_git(repo_url: String) -> Result<IconTheme, String> {
    let cache_root = icon_theme_cache_root()?;
    let basename = sanitize_basename(
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
        let mut cmd = Command::new("git");
        cmd.args(["-C", dest.to_string_lossy().as_ref(), "pull", "--ff-only"]);
        hide_console(&mut cmd);
        let _ = cmd.output();
    } else {
        let mut cmd = Command::new("git");
        cmd.args(["clone", "--depth", "1", &repo_url, dest.to_string_lossy().as_ref()]);
        hide_console(&mut cmd);
        let out = cmd.output().map_err(|e| format!("git clone 실행 실패: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "git clone exit {}: {}",
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    install_icon_theme(dest.to_string_lossy().into_owned())
}

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

// ─── Git status dashboard ──────────────────────────────────────
fn git_share_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("90_Git");
    let _ = std::fs::create_dir_all(&p);
    p
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitCommitInfo {
    pub sha: String,
    pub msg: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RepoStatus {
    pub owner_repo: Option<String>,
    pub path: String,
    pub branch: String,
    pub head: String,
    pub upstream: Option<String>,
    pub dirty: u32,
    pub dirty_files: Vec<String>,
    pub unpushed: u32,
    pub ahead: u32,
    pub behind: u32,
    pub stash: u32,
    pub last_commit: Option<GitCommitInfo>,
    pub remote_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HostGitSnapshot {
    pub schema_version: u32,
    pub host: String,
    pub os: String,
    pub scanned_at: String,
    pub repos: Vec<RepoStatus>,
}

/// Richer git runner than `run_git`: captures stdout+stderr+exit code for
/// interactive ops surfaced to the user. Mirrors Mac `git.rs` run_git_op (F-7).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitOpResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn run_git_op(repo: &Path, args: &[&str]) -> GitOpResult {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    hide_console(&mut cmd);
    match cmd.output() {
        Ok(o) => GitOpResult {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).trim().to_string(),
            exit_code: o.status.code(),
        },
        Err(e) => GitOpResult {
            ok: false,
            stdout: String::new(),
            stderr: format!("git exec failed: {e}"),
            exit_code: None,
        },
    }
}

/// Append a git-op outcome to the local jsonl log (reuses existing `append_log`;
/// "send" on success / "error" on failure — both are allowed categories).
fn log_git_op(op: &str, repo: &Path, r: &GitOpResult) {
    let category = if r.ok { "send" } else { "error" };
    append_log(
        category,
        serde_json::json!({
            "event": if r.ok { format!("git_{op}_ok") } else { format!("git_{op}_fail") },
            "op": op,
            "repo": repo.to_string_lossy(),
            "stderr": r.stderr.lines().take(3).collect::<Vec<_>>().join("\n"),
            "exit": r.exit_code,
        }),
    );
}

#[tauri::command]
pub fn git_op_fetch(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["fetch", "--all", "--prune"]);
    log_git_op("fetch", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_pull(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    // --ff-only: never start a merge on divergence; surface a clear error instead.
    let r = run_git_op(repo, &["pull", "--ff-only"]);
    log_git_op("pull", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_push(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["push"]);
    log_git_op("push", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_stash(repo_path: String, message: Option<String>) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let msg = message.unwrap_or_else(|| "share-manager auto stash".to_string());
    let r = run_git_op(repo, &["stash", "push", "-u", "-m", &msg]);
    log_git_op("stash", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_stash_pop(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["stash", "pop"]);
    log_git_op("stash_pop", repo, &r);
    Ok(r)
}

fn run_git(repo: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn normalize_owner_repo(url: &str) -> Option<String> {
    let u = url.trim();
    let i = u.find("github.com")?;
    let rest = &u[i + "github.com".len()..];
    let rest = rest.trim_start_matches([':', '/']);
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

fn repo_status_at(repo: &Path) -> RepoStatus {
    let branch = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "?".into());
    let head = run_git(repo, &["rev-parse", "HEAD"]).unwrap_or_default();
    let upstream = run_git(repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    let porcelain = run_git(repo, &["status", "--porcelain"]).unwrap_or_default();
    let dirty_files: Vec<String> = porcelain
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let dirty = dirty_files.len() as u32;

    let (mut ahead, mut behind) = (0u32, 0u32);
    if upstream.is_some() {
        if let Some(lr) = run_git(repo, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
            let nums: Vec<&str> = lr.split_whitespace().collect();
            if nums.len() == 2 {
                behind = nums[0].parse().unwrap_or(0);
                ahead = nums[1].parse().unwrap_or(0);
            }
        }
    }
    let stash = run_git(repo, &["stash", "list"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);
    let last_commit = run_git(repo, &["log", "-1", "--format=%H%x1f%s%x1f%cI"]).and_then(|s| {
        let parts: Vec<&str> = s.split('\u{1f}').collect();
        if parts.len() == 3 {
            Some(GitCommitInfo { sha: parts[0].into(), msg: parts[1].into(), date: parts[2].into() })
        } else {
            None
        }
    });
    let remote_url = run_git(repo, &["remote", "get-url", "origin"]);
    let owner_repo = remote_url.as_deref().and_then(normalize_owner_repo);

    RepoStatus {
        owner_repo,
        path: repo.to_string_lossy().into_owned(),
        branch,
        head,
        upstream,
        dirty,
        dirty_files,
        unpushed: ahead,
        ahead,
        behind,
        stash,
        last_commit,
        remote_url,
    }
}

fn scan_root_for_repos(root: &Path, exclude: &std::collections::HashSet<String>, found: &mut Vec<PathBuf>) {
    let walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if !e.file_type().is_dir() {
                return true;
            }
            let n = e.file_name().to_string_lossy().to_lowercase();
            !(n == ".git" || exclude.contains(&n))
        });
    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_dir() {
            continue;
        }
        let p = entry.path();
        // Skip dirs already inside a found repo (avoid nested re-listing).
        if found.iter().any(|r| p.starts_with(r)) {
            continue;
        }
        if p.join(".git").exists() {
            found.push(p.to_path_buf());
        }
    }
}

#[tauri::command]
pub fn scan_git_repos(app: tauri::AppHandle) -> Result<Vec<RepoStatus>, String> {
    let settings = load_settings(app);
    let exclude: std::collections::HashSet<String> = settings
        .git
        .exclude_dirs
        .iter()
        .map(|s| s.to_lowercase())
        .collect();

    let mut roots: Vec<PathBuf> = Vec::new();
    for c in b'C'..=b'Z' {
        let d = PathBuf::from(format!("{}:\\", c as char));
        if d.exists() {
            roots.push(d);
        }
    }
    for r in &settings.git.extra_roots {
        let p = PathBuf::from(r);
        if p.exists() && !roots.iter().any(|x| x == &p) {
            roots.push(p);
        }
    }

    let mut found: Vec<PathBuf> = Vec::new();
    for root in &roots {
        scan_root_for_repos(root, &exclude, &mut found);
    }
    found.sort();
    let repos: Vec<RepoStatus> = found.iter().map(|p| repo_status_at(p)).collect();
    Ok(repos)
}

#[tauri::command]
pub fn publish_git_status(repos: Vec<RepoStatus>) -> Result<String, String> {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let safe = host_id_safe(&host);
    let safe = if safe.is_empty() { "windows".to_string() } else { safe };
    let snapshot = HostGitSnapshot {
        schema_version: 1,
        host: host.clone(),
        os: "windows".into(),
        scanned_at: chrono::Local::now().to_rfc3339(),
        repos,
    };
    let path = git_share_dir().join(format!("{safe}.git-status.json"));
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_git_status() -> Result<Vec<HostGitSnapshot>, String> {
    let dir = git_share_dir();
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        if p.file_name().and_then(|s| s.to_str()).map(|n| n.ends_with(".git-status.json")).unwrap_or(false) {
            if let Ok(raw) = std::fs::read_to_string(&p) {
                if let Ok(snap) = serde_json::from_str::<HostGitSnapshot>(&raw) {
                    out.push(snap);
                }
            }
        }
    }
    Ok(out)
}

// ─── Commit logs (for the per-repo graph) ─────────────────────
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CommitNode {
    pub sha: String,
    pub parents: Vec<String>,
    pub msg: String,
    pub author: String,
    pub date: String,
}

fn repo_commit_log(repo: &Path, branch: &str, n: usize) -> Vec<CommitNode> {
    // %H sha, %P parents(space-sep), %s subject, %an author, %cI committer ISO date
    let fmt = "--format=%H%x1f%P%x1f%s%x1f%an%x1f%cI";
    let count = format!("-{n}");
    let raw = match run_git(repo, &["log", &count, fmt, branch]) {
        Some(s) => s,
        None => return Vec::new(),
    };
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| {
            let p: Vec<&str> = l.split('\u{1f}').collect();
            if p.len() != 5 {
                return None;
            }
            let parents = p[1].split_whitespace().map(|s| s.to_string()).collect();
            Some(CommitNode {
                sha: p[0].to_string(),
                parents,
                msg: p[2].to_string(),
                author: p[3].to_string(),
                date: p[4].to_string(),
            })
        })
        .collect()
}

/// Branches worth logging for a repo: default + current (deduped).
fn graph_branches(repo: &Path, status: &RepoStatus) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if status.branch != "?" && !status.branch.is_empty() {
        out.push(status.branch.clone());
    }
    // default branch from origin/HEAD if resolvable
    if let Some(def) = run_git(repo, &["rev-parse", "--abbrev-ref", "origin/HEAD"]) {
        let def = def.trim_start_matches("origin/").to_string();
        if !def.is_empty() && !out.contains(&def) {
            out.push(def);
        }
    }
    out
}

/// Single disk walk: status snapshot + commit-log file, both published.
#[tauri::command]
pub fn scan_and_publish_git(app: tauri::AppHandle) -> Result<usize, String> {
    let settings = load_settings(app);
    let exclude: std::collections::HashSet<String> =
        settings.git.exclude_dirs.iter().map(|s| s.to_lowercase()).collect();

    let mut roots: Vec<PathBuf> = Vec::new();
    for c in b'C'..=b'Z' {
        let d = PathBuf::from(format!("{}:\\", c as char));
        if d.exists() {
            roots.push(d);
        }
    }
    for r in &settings.git.extra_roots {
        let p = PathBuf::from(r);
        if p.exists() && !roots.iter().any(|x| x == &p) {
            roots.push(p);
        }
    }

    let mut found: Vec<PathBuf> = Vec::new();
    for root in &roots {
        scan_root_for_repos(root, &exclude, &mut found);
    }
    found.sort();

    let mut statuses: Vec<RepoStatus> = Vec::new();
    // logs: owner_repo (or path) → branch → [CommitNode]
    let mut logs: std::collections::BTreeMap<String, std::collections::BTreeMap<String, Vec<CommitNode>>> =
        std::collections::BTreeMap::new();

    for p in &found {
        let st = repo_status_at(p);
        let key = st.owner_repo.clone().unwrap_or_else(|| st.path.clone());
        let mut by_branch = std::collections::BTreeMap::new();
        for b in graph_branches(p, &st) {
            let log = repo_commit_log(p, &b, 50);
            if !log.is_empty() {
                by_branch.insert(b, log);
            }
        }
        if !by_branch.is_empty() {
            logs.insert(key, by_branch);
        }
        statuses.push(st);
    }

    // publish status
    publish_git_status(statuses)?;
    // publish logs
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let safe = host_id_safe(&host);
    let safe = if safe.is_empty() { "windows".to_string() } else { safe };
    let logdoc = serde_json::json!({
        "schema_version": 1, "host": host, "os": "windows",
        "scanned_at": chrono::Local::now().to_rfc3339(), "logs": logs,
    });
    std::fs::write(
        git_share_dir().join(format!("{safe}.git-log.json")),
        serde_json::to_string(&logdoc).unwrap_or_default(),
    ).map_err(|e| e.to_string())?;

    Ok(found.len())
}

#[tauri::command]
pub fn list_git_logs() -> Result<serde_json::Value, String> {
    let dir = git_share_dir();
    let mut hosts = serde_json::Map::new();
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.ends_with(".git-log.json") {
            if let Ok(raw) = std::fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let host = v.get("host").and_then(|x| x.as_str()).unwrap_or(name).to_string();
                    hosts.insert(host, v);
                }
            }
        }
    }
    Ok(serde_json::Value::Object(hosts))
}

// ─── Layer 3 Inspector helpers (raw diff + config) ────────────
/// Diff text for a file. side = "working" (vs HEAD), "staged" (vs HEAD), or "remote"
/// (vs origin/<default-branch> last-fetched).
#[tauri::command]
pub fn git_file_diff(repo_path: String, file: String, side: Option<String>) -> Result<String, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() && !repo.exists() {
        return Err("레포 경로가 유효하지 않음".into());
    }
    let mode = side.as_deref().unwrap_or("working");
    let args: Vec<&str> = match mode {
        "staged" => vec!["diff", "--cached", "--", &file],
        "remote" => vec!["diff", "@{u}..HEAD", "--", &file],
        _        => vec!["diff", "HEAD", "--", &file],
    };
    Ok(run_git(repo, &args).unwrap_or_default())
}

#[tauri::command]
pub fn git_config_read(repo_path: String) -> Result<String, String> {
    let p = Path::new(&repo_path).join(".git").join("config");
    if !p.exists() { return Err("config 파일 없음".into()); }
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_list_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repo = Path::new(&repo_path);
    let out = run_git(repo, &["branch", "--format=%(refname:short)"]).unwrap_or_default();
    let mut v: Vec<String> = out.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if v.is_empty() { v.push("main".to_string()); }
    Ok(v)
}

// ─── Git credentials (PAT in OS keychain) + SSH + API validation ──
const KEYRING_SERVICE: &str = "mac-window-git";
const KEYRING_USER: &str = "github-pat";

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn share_config_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("10_Config");
    let _ = std::fs::create_dir_all(&p);
    p
}
fn host_keys_dir() -> PathBuf {
    let p = share_config_dir().join("host-keys");
    let _ = std::fs::create_dir_all(&p);
    p
}
fn git_token_share_dir() -> PathBuf {
    let p = share_config_dir().join("git-token");
    let _ = std::fs::create_dir_all(&p);
    p
}
fn my_host_sanitized() -> String {
    let h = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let safe = host_id_safe(&h);
    if safe.is_empty() { "windows".into() } else { safe }
}
fn my_ssh_pub_path() -> Result<PathBuf, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    for name in ["mac_window_git_ed25519.pub", "id_ed25519.pub"] {
        let p = ssh.join(name);
        if p.exists() { return Ok(p); }
    }
    Err("ssh ed25519 키가 없습니다 — Settings → Git → SSH 키 생성 먼저".into())
}
fn my_ssh_priv_path() -> Result<PathBuf, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    for name in ["mac_window_git_ed25519", "id_ed25519"] {
        let p = ssh.join(name);
        if p.exists() { return Ok(p); }
    }
    Err("ssh ed25519 개인키가 없습니다".into())
}
fn list_peer_pubkeys() -> Result<Vec<(String, String)>, String> {
    let dir = host_keys_dir();
    let me = my_host_sanitized();
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&dir) { Ok(r) => r, Err(_) => return Ok(out) };
    for e in rd.flatten() {
        let p = e.path();
        let stem = p.file_name().and_then(|s| s.to_str())
            .and_then(|s| s.strip_suffix(".ssh.pub")).map(|s| s.to_string());
        let Some(host) = stem else { continue };
        if host == me { continue; }
        if let Ok(pubkey) = std::fs::read_to_string(&p) {
            out.push((host, pubkey.trim().to_string()));
        }
    }
    Ok(out)
}

/// age-encrypt `token` to an ssh-ed25519 public-key line (one recipient).
/// Pure (no IO) — the PAT cross-host crypto core. Mirrors Mac git.rs.
fn encrypt_token_to_pubkey(token: &str, pubkey_line: &str) -> Result<Vec<u8>, String> {
    use age::ssh::Recipient as SshRecipient;
    use age::Encryptor;
    use std::io::Write as _;
    use std::str::FromStr;
    let recipient = SshRecipient::from_str(pubkey_line)
        .map_err(|e| format!("ssh 공개키 파싱 실패: {e:?}"))?;
    let encryptor = Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or("recipient 가 비었음")?;
    let mut out = Vec::new();
    let mut writer = encryptor.wrap_output(&mut out).map_err(|e| format!("encrypt 시작 실패: {e}"))?;
    writer.write_all(token.as_bytes()).map_err(|e| format!("encrypt write 실패: {e}"))?;
    writer.finish().map_err(|e| format!("encrypt finish 실패: {e}"))?;
    Ok(out)
}

/// age-decrypt ciphertext with an ssh-ed25519 private key (PEM text).
/// `priv_label` is just a human label for parse errors. Pure (no IO).
/// Returns the raw decrypted string — callers MUST trim and reject empty.
fn decrypt_token_with_privkey(ciphertext: &[u8], priv_text: &str, priv_label: &str) -> Result<String, String> {
    use age::Decryptor;
    use std::io::Read as _;
    let decryptor = match Decryptor::new(ciphertext).map_err(|e| e.to_string())? {
        Decryptor::Recipients(d) => d,
        Decryptor::Passphrase(_) => return Err("예상치 못한 passphrase age 파일".into()),
    };
    let identity = age::ssh::Identity::from_buffer(
        std::io::BufReader::new(priv_text.as_bytes()),
        Some(priv_label.to_string()),
    )
    .map_err(|e| format!("ssh 개인키 파싱 실패: {e}"))?;
    let identities: Vec<Box<dyn age::Identity>> = vec![Box::new(identity)];
    let mut reader = decryptor
        .decrypt(identities.iter().map(|i| i.as_ref()))
        .map_err(|e| format!("복호화 실패: {e}"))?;
    let mut plaintext = String::new();
    reader.read_to_string(&mut plaintext).map_err(|e| format!("복호화 read 실패: {e}"))?;
    Ok(plaintext)
}

/// Publish this host's ssh public key to the share so peers can encrypt PAT for us.
#[tauri::command]
pub fn git_publish_host_pubkey() -> Result<String, String> {
    let src = my_ssh_pub_path()?;
    let pub_text = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let cleaned = pub_text.trim().to_string();
    let dst = host_keys_dir().join(format!("{}.ssh.pub", my_host_sanitized()));
    std::fs::write(&dst, format!("{cleaned}\n")).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().into_owned())
}

/// Read the local PAT and write one age-encrypted blob per peer into the share.
/// Returns how many peers received it.
#[tauri::command]
pub fn git_share_pat_to_peers() -> Result<u32, String> {
    let token = get_token().ok_or("로컬 키체인에 PAT가 없습니다")?;
    let peers = list_peer_pubkeys()?;
    if peers.is_empty() { return Ok(0); }
    let mut count: u32 = 0;
    for (peer_host, pubkey_line) in peers {
        let ct = encrypt_token_to_pubkey(&token, &pubkey_line)
            .map_err(|e| format!("{peer_host}: {e}"))?;
        let dst = git_token_share_dir().join(format!("{peer_host}.age"));
        std::fs::write(&dst, &ct).map_err(|e| format!("{peer_host} write 실패: {e}"))?;
        count += 1;
    }
    Ok(count)
}

/// Look for <share>/git-token/<my-host>.age, decrypt with our ssh private key,
/// import into keychain. Returns true only when a NEW PAT was imported.
#[tauri::command]
pub fn git_pull_pat_from_share() -> Result<bool, String> {
    let src = git_token_share_dir().join(format!("{}.age", my_host_sanitized()));
    if !src.exists() { return Ok(false); }
    let ciphertext = std::fs::read(&src).map_err(|e| e.to_string())?;
    let priv_path = my_ssh_priv_path()?;
    let priv_text = std::fs::read_to_string(&priv_path).map_err(|e| e.to_string())?;
    let plaintext = decrypt_token_with_privkey(&ciphertext, &priv_text, &priv_path.to_string_lossy())?;
    let token = plaintext.trim();
    if token.is_empty() { return Err("복호화된 PAT가 비어있음".into()); }
    if let Some(existing) = get_token() {
        if existing == token { return Ok(false); }
    }
    keyring_entry()?.set_password(token).map_err(|e| e.to_string())?;
    Ok(true)
}

fn get_token() -> Option<String> {
    keyring_entry().ok().and_then(|e| e.get_password().ok())
}

#[tauri::command]
pub fn git_set_token(token: String) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("빈 토큰".into());
    }
    keyring_entry()?.set_password(t).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_has_token() -> bool {
    get_token().is_some()
}

#[tauri::command]
pub fn git_clear_token() -> Result<(), String> {
    let e = keyring_entry()?;
    match e.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(x) => Err(x.to_string()),
    }
}

#[cfg(test)]
mod pat_crypto_tests {
    use super::*;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn age_ssh_ed25519_roundtrip() {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir()
            .join(format!("mw-age-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.join("k");
        let out = Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "", "-C", "test", "-f"])
            .arg(&key)
            .output()
            .expect("ssh-keygen must be on PATH");
        assert!(out.status.success(), "ssh-keygen failed: {}", String::from_utf8_lossy(&out.stderr));
        let pub_line = std::fs::read_to_string(key.with_extension("pub")).unwrap().trim().to_string();
        let priv_text = std::fs::read_to_string(&key).unwrap();

        let token = "ghp_TESTtoken1234567890";
        let ct = encrypt_token_to_pubkey(token, &pub_line).expect("encrypt");
        assert!(!ct.is_empty());
        assert_ne!(&ct[..], token.as_bytes(), "ciphertext must differ from plaintext");
        let pt = decrypt_token_with_privkey(&ct, &priv_text, &key.to_string_lossy()).expect("decrypt");
        assert_eq!(pt.trim(), token);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

fn gh_get(token: &str, url: &str) -> Result<serde_json::Value, String> {
    ureq::get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("User-Agent", "mac-window-share")
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "토큰 인증 실패 (401) — 토큰/스코프 확인".to_string(),
            ureq::Error::Status(code, _) => format!("GitHub API {code}"),
            other => format!("네트워크 오류: {other}"),
        })?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TokenInfo {
    pub login: String,
    pub name: Option<String>,
    pub orgs: Vec<String>,
}

#[tauri::command]
pub fn git_test_token() -> Result<TokenInfo, String> {
    let token = get_token().ok_or("등록된 토큰이 없습니다")?;
    let user = gh_get(&token, "https://api.github.com/user")?;
    let login = user.get("login").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let name = user.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
    let orgs_v = gh_get(&token, "https://api.github.com/user/orgs")
        .unwrap_or(serde_json::Value::Array(vec![]));
    let orgs: Vec<String> = orgs_v
        .as_array()
        .map(|a| a.iter().filter_map(|o| o.get("login").and_then(|v| v.as_str()).map(|s| s.to_string())).collect())
        .unwrap_or_default();
    Ok(TokenInfo { login, name, orgs })
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE").ok().or_else(|| std::env::var("HOME").ok()).map(PathBuf::from)
}

#[tauri::command]
pub fn git_ssh_status() -> Result<serde_json::Value, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    for name in ["id_ed25519.pub", "mac_window_git_ed25519.pub", "id_rsa.pub"] {
        let p = ssh.join(name);
        if p.exists() {
            let pubkey = std::fs::read_to_string(&p).unwrap_or_default();
            return Ok(serde_json::json!({
                "has_key": true, "public_key": pubkey.trim(), "path": p.to_string_lossy(),
            }));
        }
    }
    Ok(serde_json::json!({ "has_key": false }))
}

#[tauri::command]
pub fn git_generate_ssh_key() -> Result<String, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    std::fs::create_dir_all(&ssh).map_err(|e| e.to_string())?;
    let key = ssh.join("mac_window_git_ed25519");
    let pubp = ssh.join("mac_window_git_ed25519.pub");
    if pubp.exists() {
        return std::fs::read_to_string(&pubp).map(|s| s.trim().to_string()).map_err(|e| e.to_string());
    }
    let mut cmd = Command::new("ssh-keygen");
    cmd.args(["-t", "ed25519", "-N", "", "-C", "mac-window-git", "-f"]).arg(&key);
    hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| format!("ssh-keygen 실행 실패: {e}"))?;
    if !out.status.success() {
        return Err(format!("ssh-keygen 오류: {}", String::from_utf8_lossy(&out.stderr)));
    }
    std::fs::read_to_string(&pubp).map(|s| s.trim().to_string()).map_err(|e| e.to_string())
}

// ─── GitHub remote state (Stage 3) ─────────────────────────────
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemoteBranch {
    pub name: String,
    pub sha: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemotePr {
    pub number: u64,
    pub title: String,
    pub head: String,
    pub base: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemoteRepoState {
    pub owner_repo: String,
    pub default_branch: String,
    pub default_sha: String,
    pub branches: Vec<RemoteBranch>,
    pub open_prs: Vec<RemotePr>,
    pub fetched_at: String,
    pub error: Option<String>,
}

fn fetch_one_remote(token: &str, owner_repo: &str) -> RemoteRepoState {
    let now = chrono::Local::now().to_rfc3339();
    let mut st = RemoteRepoState {
        owner_repo: owner_repo.to_string(),
        default_branch: String::new(),
        default_sha: String::new(),
        branches: Vec::new(),
        open_prs: Vec::new(),
        fetched_at: now,
        error: None,
    };
    // repo meta → default_branch
    let meta = match gh_get(token, &format!("https://api.github.com/repos/{owner_repo}")) {
        Ok(v) => v,
        Err(e) => { st.error = Some(e); return st; }
    };
    st.default_branch = meta.get("default_branch").and_then(|v| v.as_str()).unwrap_or("").to_string();
    // branches (≤100)
    if let Ok(v) = gh_get(token, &format!("https://api.github.com/repos/{owner_repo}/branches?per_page=100")) {
        if let Some(arr) = v.as_array() {
            for b in arr {
                let name = b.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let sha = b.get("commit").and_then(|c| c.get("sha")).and_then(|x| x.as_str()).unwrap_or("").to_string();
                if name == st.default_branch { st.default_sha = sha.clone(); }
                if !name.is_empty() { st.branches.push(RemoteBranch { name, sha }); }
            }
        }
    }
    // open PRs (≤50)
    if let Ok(v) = gh_get(token, &format!("https://api.github.com/repos/{owner_repo}/pulls?state=open&per_page=50")) {
        if let Some(arr) = v.as_array() {
            for p in arr {
                st.open_prs.push(RemotePr {
                    number: p.get("number").and_then(|x| x.as_u64()).unwrap_or(0),
                    title: p.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                    head: p.get("head").and_then(|h| h.get("ref")).and_then(|x| x.as_str()).unwrap_or("").to_string(),
                    base: p.get("base").and_then(|h| h.get("ref")).and_then(|x| x.as_str()).unwrap_or("").to_string(),
                });
            }
        }
    }
    st
}

#[tauri::command]
pub fn github_fetch_remote(owner_repos: Vec<String>) -> Result<Vec<RemoteRepoState>, String> {
    let token = get_token().ok_or("등록된 토큰이 없습니다")?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for or in owner_repos {
        if or.is_empty() || !seen.insert(or.clone()) { continue; }
        out.push(fetch_one_remote(&token, &or));
    }
    // cache to share for reuse (metadata only, no token)
    let cache = serde_json::json!({ "fetched_at": chrono::Local::now().to_rfc3339(), "repos": out });
    let _ = std::fs::write(git_share_dir().join("remote-cache.json"), serde_json::to_string_pretty(&cache).unwrap_or_default());
    Ok(out)
}

#[tauri::command]
pub fn read_remote_cache() -> Result<serde_json::Value, String> {
    let p = git_share_dir().join("remote-cache.json");
    if !p.exists() {
        return Ok(serde_json::json!({ "repos": [] }));
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

// Fetch up to 50 remote commits for a branch via the GitHub API.
fn fetch_remote_commits(token: &str, owner_repo: &str, branch: &str) -> Vec<CommitNode> {
    let url = format!("https://api.github.com/repos/{owner_repo}/commits?sha={branch}&per_page=50");
    let v = match gh_get(token, &url) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let arr = match v.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .map(|c| {
            let sha = c.get("sha").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let parents = c.get("parents").and_then(|p| p.as_array())
                .map(|a| a.iter().filter_map(|x| x.get("sha").and_then(|s| s.as_str()).map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let commit = c.get("commit");
            let msg = commit.and_then(|cm| cm.get("message")).and_then(|x| x.as_str())
                .unwrap_or("").lines().next().unwrap_or("").to_string();
            let author = commit.and_then(|cm| cm.get("author")).and_then(|a| a.get("name")).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let date = commit.and_then(|cm| cm.get("author")).and_then(|a| a.get("date")).and_then(|x| x.as_str()).unwrap_or("").to_string();
            CommitNode { sha, parents, msg, author, date }
        })
        .filter(|c| !c.sha.is_empty())
        .collect()
}

/// Merge Win-local + Mac-local + remote commit histories for one repo into
/// a per-branch graph: ordered commit nodes (source-tagged), pointers,
/// common ancestor, and ahead/behind vs remote. Returns JSON for the UI.
#[tauri::command]
pub fn build_repo_graph(owner_repo: String) -> Result<serde_json::Value, String> {
    use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

    // 1) gather local logs per host: host → {os, branch → [CommitNode]}
    let logs_doc = list_git_logs()?;
    // host meta + per-branch commits
    let mut hosts: Vec<(String, String)> = Vec::new(); // (host, os)
    // (host, branch) → Vec<CommitNode>
    let mut local: HashMap<(String, String), Vec<CommitNode>> = HashMap::new();
    let mut branches: BTreeSet<String> = BTreeSet::new();
    if let Some(obj) = logs_doc.as_object() {
        for (host, doc) in obj {
            let os = doc.get("os").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let repo_logs = doc.get("logs").and_then(|l| l.get(&owner_repo));
            if let Some(byb) = repo_logs.and_then(|r| r.as_object()) {
                hosts.push((host.clone(), os));
                for (branch, arr) in byb {
                    branches.insert(branch.clone());
                    let commits: Vec<CommitNode> = serde_json::from_value(arr.clone()).unwrap_or_default();
                    local.insert((host.clone(), branch.clone()), commits);
                }
            }
        }
    }
    if hosts.is_empty() {
        return Err("이 레포의 커밋 로그가 아직 없어요 (스캔 필요)".into());
    }

    // 2) remote commits per branch (live API; best-effort)
    let token = get_token();
    let mut remote: HashMap<String, Vec<CommitNode>> = HashMap::new();
    let mut default_branch = String::new();
    if let Some(tok) = &token {
        if let Ok(meta) = gh_get(tok, &format!("https://api.github.com/repos/{owner_repo}")) {
            default_branch = meta.get("default_branch").and_then(|v| v.as_str()).unwrap_or("").to_string();
        }
        if !default_branch.is_empty() { branches.insert(default_branch.clone()); }
        for b in branches.iter() {
            let rc = fetch_remote_commits(tok, &owner_repo, b);
            if !rc.is_empty() { remote.insert(b.clone(), rc); }
        }
    }

    // 3) build per-branch graph
    let mut per_branch = serde_json::Map::new();
    for branch in branches.iter() {
        // collect node set with source tags + the per-source sha lists (newest-first)
        let mut node: BTreeMap<String, CommitNode> = BTreeMap::new();
        let mut src_in: HashMap<String, HashSet<String>> = HashMap::new(); // source key → shas
        let mut order_hint: HashMap<String, usize> = HashMap::new(); // sha → min index across sources (newest)

        let mut add_source = |key: &str, commits: &[CommitNode], node: &mut BTreeMap<String, CommitNode>, src_in: &mut HashMap<String, HashSet<String>>, order_hint: &mut HashMap<String, usize>| {
            let set = src_in.entry(key.to_string()).or_default();
            for (i, c) in commits.iter().enumerate() {
                node.entry(c.sha.clone()).or_insert_with(|| c.clone());
                set.insert(c.sha.clone());
                let e = order_hint.entry(c.sha.clone()).or_insert(usize::MAX);
                if i < *e { *e = i; }
            }
        };

        let mut pointers = serde_json::Map::new();
        // remote
        if let Some(rc) = remote.get(branch) {
            add_source("remote", rc, &mut node, &mut src_in, &mut order_hint);
            if let Some(tip) = rc.first() { pointers.insert("remote".into(), serde_json::json!(tip.sha)); }
        }
        // each host
        for (host, _os) in &hosts {
            if let Some(commits) = local.get(&(host.clone(), branch.clone())) {
                add_source(host, commits, &mut node, &mut src_in, &mut order_hint);
                if let Some(tip) = commits.first() { pointers.insert(host.clone(), serde_json::json!(tip.sha)); }
            }
        }

        // ordered list: newest-first by date desc (fallback order_hint)
        let mut shas: Vec<String> = node.keys().cloned().collect();
        shas.sort_by(|a, b| {
            let da = node.get(a).map(|n| n.date.clone()).unwrap_or_default();
            let db = node.get(b).map(|n| n.date.clone()).unwrap_or_default();
            db.cmp(&da).then(order_hint.get(a).cmp(&order_hint.get(b)))
        });

        // common ancestor: newest sha present in ALL available sources
        let source_keys: Vec<String> = src_in.keys().cloned().collect();
        let common_ancestor = shas.iter().find(|s| source_keys.iter().all(|k| src_in.get(k).map(|set| set.contains(*s)).unwrap_or(false))).cloned();

        // ahead/behind vs remote per host (approx via set difference)
        let mut summary = serde_json::Map::new();
        let empty = HashSet::new();
        let rset = src_in.get("remote").unwrap_or(&empty);
        for (host, _os) in &hosts {
            if let Some(hset) = src_in.get(host) {
                let ahead = hset.iter().filter(|s| !rset.contains(*s)).count();
                let behind = if rset.is_empty() { 0 } else { rset.iter().filter(|s| !hset.contains(*s)).count() };
                summary.insert(host.clone(), serde_json::json!({ "ahead": ahead, "behind": behind, "has_remote": !rset.is_empty() }));
            }
        }

        // commit rows
        let commits_json: Vec<serde_json::Value> = shas.iter().map(|s| {
            let n = &node[s];
            let mut inmap = serde_json::Map::new();
            for k in &source_keys { inmap.insert(k.clone(), serde_json::json!(src_in.get(k).map(|set| set.contains(s)).unwrap_or(false))); }
            let tips: Vec<String> = pointers.iter().filter(|(_, v)| v.as_str() == Some(s.as_str())).map(|(k, _)| k.clone()).collect();
            serde_json::json!({
                "sha": s, "short": &s[..s.len().min(7)],
                "parents": n.parents, "msg": n.msg, "author": n.author, "date": n.date,
                "in": inmap, "tips": tips,
                "ancestor": Some(s) == common_ancestor.as_ref().map(|x| x),
            })
        }).collect();

        per_branch.insert(branch.clone(), serde_json::json!({
            "commits": commits_json,
            "pointers": pointers,
            "common_ancestor": common_ancestor,
            "summary": summary,
        }));
    }

    let hosts_json: Vec<serde_json::Value> = hosts.iter().map(|(h, o)| serde_json::json!({"host": h, "os": o})).collect();
    Ok(serde_json::json!({
        "owner_repo": owner_repo,
        "default_branch": default_branch,
        "branches": branches.iter().cloned().collect::<Vec<_>>(),
        "hosts": hosts_json,
        "has_token": token.is_some(),
        "per_branch": per_branch,
    }))
}

// ─── File watcher (replaces UI polling) ────────────────────────
fn classify_event_path(p: &Path) -> &'static str {
    let s = p.to_string_lossy();
    let has = |needle: &str| s.contains(needle);
    if has("\\10_Exchange\\") || has("/10_Exchange/") { return "transfers"; }
    if has("\\70_Clipboard\\") || has("/70_Clipboard/") { return "clipboard"; }
    if has("\\60_Notes\\") || has("/60_Notes/") { return "notes"; }
    if has("\\profiles\\") || has("/profiles/") { return "profiles"; }
    if has("\\90_Git\\") || has("/90_Git/") { return "git"; }
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
            share.join("00_System").join("90_Git"),
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

fn images_dir() -> PathBuf {
    let p = clipboard_dir().join("images");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

// ─── 80_Logs hub ───────────────────────────────────────────────
fn logs_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("80_Logs");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn log_file(category: &str) -> PathBuf {
    logs_dir().join(format!("{category}.jsonl"))
}

fn append_log(category: &str, mut entry: serde_json::Value) {
    use std::io::Write;
    if let Some(obj) = entry.as_object_mut() {
        obj.entry("ts").or_insert_with(|| serde_json::Value::String(chrono::Local::now().to_rfc3339()));
        let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
        obj.entry("host").or_insert(serde_json::Value::String(host));
        obj.entry("os").or_insert(serde_json::Value::String("windows".into()));
    }
    let line = serde_json::to_string(&entry).unwrap_or_default();
    let path = log_file(category);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
        let _ = f.write_all(b"\n");
    }
    let _ = rotate_jsonl(&path, 1000);
}

#[tauri::command]
pub fn list_log_entries(category: String, limit: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let allowed = ["send", "recv", "error", "worklog"];
    if !allowed.contains(&category.as_str()) {
        return Err(format!("unknown log category: {category}"));
    }
    let path = log_file(&category);
    if !path.exists() { return Ok(vec![]); }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut all: Vec<serde_json::Value> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    all.reverse(); // newest first
    if let Some(n) = limit { all.truncate(n); }
    Ok(all)
}

#[tauri::command]
pub fn append_worklog(summary: String, detail: Option<String>) -> Result<(), String> {
    append_log("worklog", serde_json::json!({
        "summary": summary,
        "detail": detail.unwrap_or_default(),
    }));
    Ok(())
}

fn compressed_images_dir() -> PathBuf {
    let p = logs_dir().join("compressed-images");
    let _ = std::fs::create_dir_all(&p);
    p
}

#[tauri::command]
pub fn list_compressed_images() -> Result<Vec<serde_json::Value>, String> {
    let dir = compressed_images_dir();
    if !dir.exists() { return Ok(vec![]); }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) != Some("jpg") { continue; }
        let meta = e.metadata().ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = meta
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339())
            .unwrap_or_default();
        out.push(serde_json::json!({
            "ref": p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
            "size_bytes": size,
            "ts": mtime,
        }));
    }
    out.sort_by(|a, b| {
        b.get("ts").and_then(|v| v.as_str()).unwrap_or("")
            .cmp(a.get("ts").and_then(|v| v.as_str()).unwrap_or(""))
    });
    Ok(out)
}

#[tauri::command]
pub fn compressed_image_path(image_ref: String) -> Result<String, String> {
    if image_ref.contains('/') || image_ref.contains('\\') || image_ref.contains("..") {
        return Err("invalid ref".into());
    }
    Ok(compressed_images_dir().join(image_ref).to_string_lossy().into_owned())
}

// ─── Verify result cache (for receive badges) ──────────────────
fn verify_cache_dir() -> PathBuf {
    let p = logs_dir().join("verify");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn write_verify_cache(r: &VerifyResult) {
    let path = verify_cache_dir().join(format!("{}.json", r.transfer_id));
    let v = serde_json::json!({
        "transfer_id": r.transfer_id,
        "ok": r.ok,
        "checked": r.checked,
        "mismatches": r.mismatches,
        "missing": r.missing,
        "ts": chrono::Local::now().to_rfc3339(),
    });
    let _ = std::fs::write(path, serde_json::to_string(&v).unwrap_or_default());
}

fn read_verify_status(transfer_id: &str) -> Option<String> {
    let path = verify_cache_dir().join(format!("{transfer_id}.json"));
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let ok = v.get("ok").and_then(|x| x.as_bool())?;
    Some(if ok { "ok".to_string() } else { "mismatch".to_string() })
}

/// Auto-verify any received (mac→windows) transfer that has no cached
/// result yet. Writes the cache + a recv/error log entry. Returns count.
#[tauri::command]
pub fn auto_verify_pending() -> Result<u32, String> {
    let dir = manifests_dir(Direction::MacToWindows);
    let mut done = 0u32;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            let tid = match p.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            if verify_cache_dir().join(format!("{tid}.json")).exists() { continue; }
            match run_verify(&tid) {
                Ok(r) => {
                    if r.ok {
                        append_log("recv", serde_json::json!({
                            "event": "verify_ok", "transfer_id": r.transfer_id,
                            "checked": r.checked, "direction": r.direction,
                        }));
                    } else {
                        append_log("error", serde_json::json!({
                            "event": "verify_fail", "transfer_id": r.transfer_id,
                            "mismatches": r.mismatches, "missing": r.missing, "direction": r.direction,
                        }));
                    }
                    done += 1;
                }
                Err(err) => {
                    append_log("error", serde_json::json!({
                        "event": "verify_error", "transfer_id": tid, "error": err,
                    }));
                }
            }
        }
    }
    Ok(done)
}

fn policy_clipboard_cfg() -> (u32, u64, u64) {
    // (max_dimension, retention_days, total_cap_mb) with defaults
    let policy = load_policy().unwrap_or_else(|_| serde_json::json!({}));
    let c = policy.get("clipboard").cloned().unwrap_or_default();
    let max_dim = c.get("image_max_dimension").and_then(|v| v.as_u64()).unwrap_or(2560) as u32;
    let retention = c.get("image_retention_days").and_then(|v| v.as_u64()).unwrap_or(30);
    let cap_mb = c.get("image_total_cap_mb").and_then(|v| v.as_u64()).unwrap_or(300);
    (max_dim, retention, cap_mb)
}

fn policy_image_action() -> (String, u8, u32) {
    // (action, jpeg_quality, compress_max_dimension) with defaults
    let policy = load_policy().unwrap_or_else(|_| serde_json::json!({}));
    let c = policy.get("clipboard").cloned().unwrap_or_default();
    let action = c.get("image_retention_action").and_then(|v| v.as_str()).unwrap_or("compress").to_string();
    let q = c.get("compress_quality").and_then(|v| v.as_u64()).unwrap_or(60).clamp(1, 100) as u8;
    let dim = c.get("compress_max_dimension").and_then(|v| v.as_u64()).unwrap_or(1280) as u32;
    (action, q, dim)
}

/// On retention expiry: re-encode the PNG as a downscaled JPEG into
/// 80_Logs/compressed-images/<stem>.jpg, then delete the original PNG.
fn archive_old_image(png_path: &Path) {
    use image::{codecs::jpeg::JpegEncoder, imageops, DynamicImage};
    let (_, quality, dim) = policy_image_action();
    let img = match image::open(png_path) {
        Ok(i) => i,
        Err(_) => { let _ = std::fs::remove_file(png_path); return; }
    };
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let longest = w.max(h);
    let scaled = if longest > dim {
        let scale = dim as f64 / longest as f64;
        let nw = ((w as f64) * scale).round().max(1.0) as u32;
        let nh = ((h as f64) * scale).round().max(1.0) as u32;
        DynamicImage::ImageRgba8(imageops::resize(&rgba, nw, nh, imageops::FilterType::Lanczos3))
    } else {
        DynamicImage::ImageRgba8(rgba)
    };
    // JPEG has no alpha — flatten to RGB.
    let rgb = DynamicImage::ImageRgb8(scaled.to_rgb8());
    let stem = png_path.file_stem().and_then(|s| s.to_str()).unwrap_or("img");
    let out = compressed_images_dir().join(format!("{stem}.jpg"));
    let mut buf = std::io::Cursor::new(Vec::new());
    if JpegEncoder::new_with_quality(&mut buf, quality).encode_image(&rgb).is_ok() {
        let _ = std::fs::write(&out, buf.into_inner());
    }
    let _ = std::fs::remove_file(png_path);
}

fn save_clipboard_image(rgba: &[u8], w: u32, h: u32) -> std::io::Result<()> {
    use image::{codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder}, imageops, ExtendedColorType, ImageEncoder, RgbaImage};

    if w == 0 || h == 0 { return Ok(()); }
    let base = RgbaImage::from_raw(w, h, rgba.to_vec())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "rgba size mismatch"))?;

    let (max_dim, _, _) = policy_clipboard_cfg();
    let longest = w.max(h);
    let scaled = if longest > max_dim {
        let scale = max_dim as f64 / longest as f64;
        let nw = ((w as f64) * scale).round().max(1.0) as u32;
        let nh = ((h as f64) * scale).round().max(1.0) as u32;
        imageops::resize(&base, nw, nh, imageops::FilterType::Lanczos3)
    } else {
        base
    };

    let mut buf = Vec::new();
    PngEncoder::new_with_quality(&mut buf, CompressionType::Best, PngFilter::Adaptive)
        .write_image(scaled.as_raw(), scaled.width(), scaled.height(), ExtendedColorType::Rgba8)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    let sha = sha256_hex(&buf);
    let fname = format!("{sha}.png");
    let file = images_dir().join(&fname);
    if !file.exists() {
        std::fs::write(&file, &buf)?;
    }
    append_own_clipboard_image_entry(&fname, scaled.width(), scaled.height(), buf.len() as u64)?;
    Ok(())
}

fn append_own_clipboard_image_entry(image_ref: &str, w: u32, h: u32, bytes: u64) -> std::io::Result<()> {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    // v2 image schema (matches Mac): size_bytes + content label + len:0.
    let entry = serde_json::json!({
        "ts": chrono::Local::now().to_rfc3339(),
        "host": host,
        "os": "windows",
        "kind": "image",
        "image_ref": image_ref,
        "width": w,
        "height": h,
        "size_bytes": bytes,
        "content": format!("📷 image ({w}×{h}, {} KB)", bytes / 1024),
        "len": 0,
    });
    let line = serde_json::to_string(&entry).unwrap_or_default();
    use std::io::Write;
    let path = own_history_path();
    if let Some(p) = path.parent() { std::fs::create_dir_all(p)?; }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
    f.write_all(line.as_bytes())?;
    f.write_all(b"\n")?;
    rotate_jsonl(&path, 200)?;
    Ok(())
}

fn sweep_clipboard_images() {
    let dir = images_dir();
    let (_, retention_days, cap_mb) = policy_clipboard_cfg();
    let now = std::time::SystemTime::now();
    let retention = std::time::Duration::from_secs(retention_days * 86_400);

    let entries: Vec<_> = match std::fs::read_dir(&dir) {
        Ok(rd) => rd.flatten().collect(),
        Err(_) => return,
    };

    // 1) Old files past retention: compress-archive into 80_Logs, or delete.
    let (action, _, _) = policy_image_action();
    for e in &entries {
        if let Ok(meta) = e.metadata() {
            if let Ok(modified) = meta.modified() {
                if let Ok(age) = now.duration_since(modified) {
                    if age > retention {
                        if action == "delete" {
                            let _ = std::fs::remove_file(e.path());
                        } else {
                            archive_old_image(&e.path());
                        }
                    }
                }
            }
        }
    }

    // 2) Enforce total cap (oldest first)
    let cap_bytes = cap_mb * 1024 * 1024;
    let mut survivors: Vec<(std::path::PathBuf, std::time::SystemTime, u64)> = Vec::new();
    let mut total: u64 = 0;
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        if let Ok(meta) = e.metadata() {
            let mt = meta.modified().unwrap_or(now);
            let sz = meta.len();
            survivors.push((e.path(), mt, sz));
            total += sz;
        }
    }
    if total > cap_bytes {
        survivors.sort_by_key(|(_, mt, _)| *mt); // oldest first
        for (path, _, sz) in survivors {
            if total <= cap_bytes { break; }
            if std::fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(sz);
            }
        }
    }
}

pub fn start_clipboard_poller(app: tauri::AppHandle) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    std::thread::spawn(move || {
        let mut last_text: Option<String> = None;
        let mut last_image: Option<String> = None;
        let mut last_sweep = std::time::Instant::now();

        sweep_clipboard_images();
        std::thread::sleep(std::time::Duration::from_millis(500));

        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));

            // Text branch
            if let Ok(text) = app.clipboard().read_text() {
                if !text.is_empty() && last_text.as_ref() != Some(&text) {
                    let _ = append_own_clipboard_entry(&text);
                    last_text = Some(text);
                }
            }

            // Image branch
            if let Ok(img) = app.clipboard().read_image() {
                let rgba = img.rgba();
                let (w, h) = (img.width(), img.height());
                if !rgba.is_empty() && w > 0 && h > 0 {
                    let raw_hash = sha256_hex(rgba);
                    if last_image.as_ref() != Some(&raw_hash) {
                        if let Err(e) = save_clipboard_image(rgba, w, h) {
                            eprintln!("clipboard image save failed: {e}");
                        }
                        last_image = Some(raw_hash);
                    }
                }
            }

            // Periodic sweep (every 6h)
            if last_sweep.elapsed() > std::time::Duration::from_secs(6 * 3600) {
                sweep_clipboard_images();
                last_sweep = std::time::Instant::now();
            }
        }
    });
}

#[tauri::command]
pub fn clipboard_image_path(image_ref: String) -> String {
    images_dir().join(image_ref).to_string_lossy().into_owned()
}

#[tauri::command]
pub fn copy_image_to_os_clipboard(app: tauri::AppHandle, image_ref: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let path = images_dir().join(&image_ref);
    if !path.exists() {
        return Err("이미지 파일이 만료/삭제됨".to_string());
    }
    let dyn_img = image::open(&path).map_err(|e| e.to_string())?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let img = tauri::image::Image::new_owned(rgba.into_raw(), w, h);
    app.clipboard().write_image(&img).map_err(|e| e.to_string())
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

#[cfg(test)]
mod gitop_tests {
    use super::*;
    use std::process::Command;

    fn temp_repo() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("mw-gitop-{}-{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            Command::new("git").arg("-C").arg(&dir).args(args).output().unwrap();
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t.t"]);
        run(&["config", "user.name", "t"]);
        run(&["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "init"]);
        dir
    }

    #[test]
    fn run_git_op_ok_on_valid_repo() {
        let dir = temp_repo();
        let r = run_git_op(&dir, &["rev-parse", "--is-inside-work-tree"]);
        assert!(r.ok);
        assert_eq!(r.stdout, "true");
        assert_eq!(r.exit_code, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_git_op_fail_captures_stderr() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static M: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "mw-gitop-nope-{}-{}",
            std::process::id(),
            M.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap(); // exists but is NOT a git repo
        let r = run_git_op(&dir, &["status"]);
        assert!(!r.ok);
        assert!(!r.stderr.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stash_roundtrip() {
        let dir = temp_repo();
        std::fs::write(dir.join("a.txt"), "changed").unwrap();
        assert!(!run_git_op(&dir, &["status", "--porcelain"]).stdout.is_empty(), "expected dirty");
        let s = run_git_op(&dir, &["stash", "push", "-u", "-m", "test"]);
        assert!(s.ok, "stash push failed: {}", s.stderr);
        assert!(run_git_op(&dir, &["status", "--porcelain"]).stdout.is_empty(), "expected clean after stash");
        let p = run_git_op(&dir, &["stash", "pop"]);
        assert!(p.ok, "stash pop failed: {}", p.stderr);
        assert!(!run_git_op(&dir, &["status", "--porcelain"]).stdout.is_empty(), "expected dirty after pop");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
