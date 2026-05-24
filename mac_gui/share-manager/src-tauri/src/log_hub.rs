// log_hub.rs — T4 Log Hub backend (mirror of windows_gui/.../commands.rs
// §"80_Logs hub"). Persists structured JSONL log streams under
// `<share>/00_System/80_Logs/<category>.jsonl` and exposes a single
// `list_log_entries(category, limit)` Tauri command that the LogsView
// renders.
//
// Categories shared with Windows side: `send`, `recv`, `error`, `worklog`.
// The 5th sidebar item (`compressed`) is rendered from
// `commands::list_compressed_images` instead of this stream — see
// LogsView.
//
// Mac uses the same JSONL schema Windows writes so that LogsView can
// render entries from either host's stream without per-OS branching.
// Auto-injected fields per line: `ts` (RFC3339 local), `host` (Mac's
// LocalHostName), `os` ("macos").

use std::io::Write;
use std::path::PathBuf;

const ALLOWED: &[&str] = &["send", "recv", "error", "worklog"];
const ROTATE_KEEP: usize = 1000;

pub(crate) fn logs_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("80_Logs");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn log_file(category: &str) -> PathBuf {
    logs_dir().join(format!("{category}.jsonl"))
}

fn mac_hostname() -> String {
    if let Ok(out) = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }
    std::env::var("HOSTNAME").unwrap_or_else(|_| "mac".into())
}

/// Append one structured event to `<category>.jsonl`. The `ts`/`host`/`os`
/// fields are injected if the caller didn't supply them, so most callers
/// only need to pass the event-specific payload.
///
/// Side-effects beyond the append:
///   - creates the file (and parent dir) on first write
///   - trims the file to the most-recent `ROTATE_KEEP` lines when it grows
///     past that boundary (cheap newest-N tail via collect-then-rewrite —
///     fine at our message rates)
pub(crate) fn append_log(category: &str, mut entry: serde_json::Value) {
    if let Some(obj) = entry.as_object_mut() {
        obj.entry("ts")
            .or_insert_with(|| serde_json::Value::String(chrono::Local::now().to_rfc3339()));
        obj.entry("host")
            .or_insert_with(|| serde_json::Value::String(mac_hostname()));
        obj.entry("os")
            .or_insert_with(|| serde_json::Value::String("macos".into()));
    }
    let line = match serde_json::to_string(&entry) {
        Ok(s) => s,
        Err(_) => return,
    };
    let path = log_file(category);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
        let _ = f.write_all(b"\n");
    }
    rotate(&path, ROTATE_KEEP);
}

fn rotate(path: &std::path::Path, keep: usize) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= keep {
        return;
    }
    let tail = &lines[lines.len() - keep..];
    let new_content = tail.join("\n") + "\n";
    let _ = std::fs::write(path, new_content);
}

/// Read the JSONL stream for `category`, newest-first, capped at `limit`.
/// Returns the parsed `serde_json::Value` per line so the frontend can
/// branch on `event` / `summary` / etc. without a typed DTO.
#[tauri::command]
pub fn list_log_entries(
    category: String,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    if !ALLOWED.contains(&category.as_str()) {
        return Err(format!("unknown log category: {category}"));
    }
    let path = log_file(&category);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut all: Vec<serde_json::Value> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    all.reverse();
    if let Some(n) = limit {
        all.truncate(n);
    }
    Ok(all)
}

/// Append a worklog entry. Distinct from `commands::append_worklog`
/// (which writes a Markdown daily file under `mockups/quality/WORKLOG/`)
/// — this is the JSONL stream the Log Hub renders. Wave A's Markdown
/// channel is kept as a human-readable journal; Wave B's JSONL channel
/// is the machine-rendered timeline.
#[tauri::command]
pub fn append_log_worklog(summary: String, detail: Option<String>) -> Result<(), String> {
    append_log(
        "worklog",
        serde_json::json!({
            "summary": summary,
            "detail": detail.unwrap_or_default(),
        }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scoped MW_SHARE_ROOT override that restores the prior value on drop.
    /// Acquire `crate::test_util::ENV_LOCK` BEFORE constructing this so
    /// parallel tests don't trample each other's env state.
    struct ShareFixture {
        _td: tempfile::TempDir,
        prev: Option<String>,
    }
    impl ShareFixture {
        fn new() -> Self {
            let td = tempfile::tempdir().unwrap();
            let prev = std::env::var("MW_SHARE_ROOT").ok();
            std::env::set_var("MW_SHARE_ROOT", td.path());
            ShareFixture { _td: td, prev }
        }
    }
    impl Drop for ShareFixture {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var("MW_SHARE_ROOT", v),
                None => std::env::remove_var("MW_SHARE_ROOT"),
            }
        }
    }

    #[test]
    fn rejects_unknown_category() {
        let _g = crate::test_util::ENV_LOCK.lock().unwrap();
        let _f = ShareFixture::new();
        let r = list_log_entries("ghost".into(), None);
        assert!(r.is_err());
    }

    #[test]
    fn empty_category_returns_empty_vec() {
        let _g = crate::test_util::ENV_LOCK.lock().unwrap();
        let _f = ShareFixture::new();
        let v = list_log_entries("send".into(), None).unwrap();
        assert!(v.is_empty());
    }

    #[test]
    fn append_then_list_newest_first() {
        let _g = crate::test_util::ENV_LOCK.lock().unwrap();
        let _f = ShareFixture::new();
        append_log("send", serde_json::json!({"event": "send_ok", "n": 1}));
        append_log("send", serde_json::json!({"event": "send_ok", "n": 2}));
        append_log("send", serde_json::json!({"event": "send_ok", "n": 3}));
        let v = list_log_entries("send".into(), None).unwrap();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].get("n").and_then(|x| x.as_u64()), Some(3));
        assert_eq!(v[2].get("n").and_then(|x| x.as_u64()), Some(1));
        assert!(v[0].get("ts").is_some());
        assert!(v[0].get("host").is_some());
        assert_eq!(v[0].get("os").and_then(|x| x.as_str()), Some("macos"));
    }

    #[test]
    fn limit_caps_response() {
        let _g = crate::test_util::ENV_LOCK.lock().unwrap();
        let _f = ShareFixture::new();
        for i in 0..10 {
            append_log("recv", serde_json::json!({"event": "verify_ok", "n": i}));
        }
        let v = list_log_entries("recv".into(), Some(3)).unwrap();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].get("n").and_then(|x| x.as_u64()), Some(9));
    }

    #[test]
    fn rotation_trims_to_keep_lines() {
        let _g = crate::test_util::ENV_LOCK.lock().unwrap();
        let _f = ShareFixture::new();
        for i in 0..(ROTATE_KEEP + 50) {
            append_log("error", serde_json::json!({"event": "send_fail", "n": i}));
        }
        let v = list_log_entries("error".into(), None).unwrap();
        assert_eq!(
            v.len(),
            ROTATE_KEEP,
            "should have been trimmed to ROTATE_KEEP"
        );
        // newest first → first entry's `n` should be the last we appended
        assert_eq!(
            v[0].get("n").and_then(|x| x.as_u64()),
            Some((ROTATE_KEEP + 50 - 1) as u64)
        );
    }

    #[test]
    fn caller_supplied_fields_not_overwritten() {
        let _g = crate::test_util::ENV_LOCK.lock().unwrap();
        let _f = ShareFixture::new();
        append_log(
            "send",
            serde_json::json!({
                "ts": "1999-01-01T00:00:00Z",
                "host": "explicit-host",
                "os": "linux",
                "event": "test",
            }),
        );
        let v = list_log_entries("send".into(), None).unwrap();
        assert_eq!(v[0].get("ts").and_then(|x| x.as_str()), Some("1999-01-01T00:00:00Z"));
        assert_eq!(v[0].get("host").and_then(|x| x.as_str()), Some("explicit-host"));
        assert_eq!(v[0].get("os").and_then(|x| x.as_str()), Some("linux"));
    }

    #[test]
    fn worklog_command_writes_jsonl() {
        let _g = crate::test_util::ENV_LOCK.lock().unwrap();
        let _f = ShareFixture::new();
        append_log_worklog("test summary".into(), Some("test detail".into())).unwrap();
        let v = list_log_entries("worklog".into(), None).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(
            v[0].get("summary").and_then(|x| x.as_str()),
            Some("test summary")
        );
        assert_eq!(
            v[0].get("detail").and_then(|x| x.as_str()),
            Some("test detail")
        );
    }
}
