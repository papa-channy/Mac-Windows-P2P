// clipboard.rs — clipboard polling + JSONL history at 70_Clipboard.
//
// Mac side records its NSPasteboard text into <host>.history.jsonl. We
// reach NSPasteboard through tauri-plugin-clipboard-manager (which uses
// the `arboard` crate on macOS — fine for our text-only v1).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

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

fn hostname() -> String {
    if let Ok(out) = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() { return s; }
        }
    }
    if let Ok(out) = std::process::Command::new("hostname").output() {
        if out.status.success() {
            return String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    "mac".to_string()
}

pub fn own_history_path() -> PathBuf {
    let safe = host_id_safe(&hostname());
    let safe = if safe.is_empty() { "mac".to_string() } else { safe };
    clipboard_dir().join(format!("{safe}.history.jsonl"))
}

pub fn append_entry(text: &str) -> std::io::Result<()> {
    let host = hostname();
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
        "os": "macos",
        "content": stored,
        "kind": "text",
        "len": text.chars().count(),
    });
    let line = serde_json::to_string(&entry).unwrap_or_default();

    let path = own_history_path();
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut f = OpenOptions::new()
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
    if lines.len() <= max_lines { return Ok(()); }
    let start = lines.len() - max_lines;
    lines = lines[start..].to_vec();
    std::fs::write(path, lines.join("\n") + "\n")
}

pub fn start_poller(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<String> = None;
        std::thread::sleep(Duration::from_millis(500));
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let text = match app.clipboard().read_text() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if text.is_empty() { continue; }
            if let Some(prev) = &last {
                if *prev == text { continue; }
            }
            let _ = append_entry(&text);
            last = Some(text);
        }
    });
}

pub fn list_entries(limit: usize) -> Result<Vec<serde_json::Value>, String> {
    let dir = clipboard_dir();
    if !dir.exists() { return Ok(vec![]); }
    let mut all: Vec<serde_json::Value> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("jsonl") { continue; }
        if let Ok(content) = std::fs::read_to_string(&p) {
            for line in content.lines() {
                if line.trim().is_empty() { continue; }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    all.push(v);
                }
            }
        }
    }
    all.sort_by(|a, b| {
        let ta = a.get("ts").and_then(|v| v.as_str()).unwrap_or("");
        let tb = b.get("ts").and_then(|v| v.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    all.truncate(limit);
    Ok(all)
}

pub fn clear_own_history() -> Result<(), String> {
    let p = own_history_path();
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::ENV_LOCK;

    #[test]
    fn append_then_list_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        append_entry("hello world").unwrap();
        append_entry("두번째 항목").unwrap();

        let entries = list_entries(10).unwrap();
        assert_eq!(entries.len(), 2);
        // newest first
        assert_eq!(entries[0].get("content").and_then(|v| v.as_str()), Some("두번째 항목"));
        assert_eq!(entries[0].get("os").and_then(|v| v.as_str()), Some("macos"));
        assert_eq!(entries[0].get("kind").and_then(|v| v.as_str()), Some("text"));
        assert_eq!(entries[0].get("len").and_then(|v| v.as_u64()), Some(6));

        // clear_own_history removes only this host's file
        clear_own_history().unwrap();
        assert_eq!(list_entries(10).unwrap().len(), 0);

        std::env::remove_var("MW_SHARE_ROOT");
    }
}
