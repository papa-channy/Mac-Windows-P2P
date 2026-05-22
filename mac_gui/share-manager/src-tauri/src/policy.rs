// policy.rs — read/write the share-side policy.json and publish this
// host's profile JSON. Mirrors the Windows side; only os/host plumbing
// changes.

use std::path::PathBuf;

pub fn policy_path() -> PathBuf {
    crate::share::share_root()
        .join("00_System")
        .join("10_Config")
        .join("global")
        .join("policy.json")
}

pub fn profiles_dir() -> PathBuf {
    crate::share::share_root()
        .join("00_System")
        .join("10_Config")
        .join("profiles")
}

pub fn load() -> Result<serde_json::Value, String> {
    let p = policy_path();
    if !p.exists() {
        return Err(format!("policy.json 없음: {}", p.display()));
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("policy.json 파싱 실패: {e}"))
}

pub fn save(policy: serde_json::Value) -> Result<(), String> {
    let p = policy_path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(&policy).map_err(|e| e.to_string())?;
    std::fs::write(&p, pretty).map_err(|e| e.to_string())
}

pub fn publish_profile() -> Result<String, String> {
    let host = hostname();
    let user = std::env::var("USER").unwrap_or_else(|_| "(unknown)".to_string());
    let now = chrono::Local::now().to_rfc3339();
    let safe_host = host.replace(
        |c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "_",
    );

    let dir = profiles_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{safe_host}.profile.json"));

    let os_version = sw_vers().unwrap_or_else(|| std::env::consts::OS.to_string());

    let profile = serde_json::json!({
        "schema_version": 1,
        "host": host,
        "host_id": safe_host,
        "os": "macos",
        "os_version": os_version,
        "arch": std::env::consts::ARCH,
        "user": user,
        "published_at": now,
        "tools": {
            "share_manager": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": [
            "swiftui-dialogs",
            "policy-aware-send",
            "language-detection",
            "fsevents-with-polling-fallback"
        ]
    });

    let pretty = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(&file, pretty).map_err(|e| e.to_string())?;
    Ok(file.to_string_lossy().into_owned())
}

pub fn list_profiles() -> Result<Vec<serde_json::Value>, String> {
    let dir = profiles_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

pub fn detect_project_language(path: String) -> Result<serde_json::Value, String> {
    let policy = load().unwrap_or_else(|_| serde_json::json!({}));
    let markers = policy
        .get("language_detection")
        .and_then(|d| d.get("markers"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let git_dirs: Vec<String> = policy
        .get("language_detection")
        .and_then(|d| d.get("git_marker_dirs"))
        .and_then(|d| d.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_else(|| vec![".git".into(), ".hg".into(), ".svn".into()]);

    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("경로 없음: {path}"));
    }

    let mut detected: Vec<String> = Vec::new();
    let mut matched_markers: Vec<serde_json::Value> = Vec::new();
    let mut has_git = false;

    for entry in walkdir::WalkDir::new(&root).max_depth(2).into_iter().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().is_dir() && git_dirs.contains(&name) {
            has_git = true;
            continue;
        }
        if !entry.file_type().is_file() { continue; }
        if let serde_json::Value::Object(map) = &markers {
            for (lang, pats) in map {
                if let serde_json::Value::Array(arr) = pats {
                    for pat in arr {
                        let pat_s = match pat.as_str() { Some(s) => s, None => continue };
                        if file_matches_marker(&name, pat_s) {
                            if !detected.contains(lang) { detected.push(lang.clone()); }
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
    if pattern.starts_with("*.") {
        let suffix = &pattern[1..];
        return name.to_ascii_lowercase().ends_with(&suffix.to_ascii_lowercase());
    }
    name == pattern
}

fn hostname() -> String {
    if let Ok(out) = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
    {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() { return s; }
    }
    std::env::var("HOSTNAME").unwrap_or_else(|_| "mac-unknown".to_string())
}

fn sw_vers() -> Option<String> {
    let out = std::process::Command::new("sw_vers")
        .args(["-productVersion"])
        .output()
        .ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(format!("macOS {s}")) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::ENV_LOCK;
    use serde_json::json;

    #[test]
    fn save_then_load_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        save(json!({"schema_version": 1, "network_mode": "open"})).unwrap();
        let p = load().unwrap();
        assert_eq!(p.get("network_mode").and_then(|v| v.as_str()), Some("open"));
        assert_eq!(p.get("schema_version").and_then(|v| v.as_u64()), Some(1));

        std::env::remove_var("MW_SHARE_ROOT");
    }

    #[test]
    fn load_returns_err_when_missing() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        let err = load().unwrap_err();
        assert!(err.contains("없음"));

        std::env::remove_var("MW_SHARE_ROOT");
    }
}

pub fn list_language_presets() -> Result<Vec<serde_json::Value>, String> {
    let dir = crate::share::share_root()
        .join("00_System")
        .join("10_Config")
        .join("ignore_rules")
        .join("_language_presets");
    if !dir.exists() { return Ok(vec![]); }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("shareignore") { continue; }
        let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let body = std::fs::read_to_string(&p).unwrap_or_default();
        out.push(serde_json::json!({
            "language": name,
            "patterns": body.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')).collect::<Vec<_>>(),
        }));
    }
    Ok(out)
}
