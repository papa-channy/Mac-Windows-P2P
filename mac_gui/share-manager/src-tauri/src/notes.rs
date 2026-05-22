// notes.rs — shared note storage at 00_System/60_Notes/<note-id>.json.
//
// Mirrors windows_gui/share-manager/src-tauri/src/commands.rs notes section
// (last-write-wins, schema_version=1). Listing strips `body` and replaces
// it with a 160-char `snippet` to keep the IPC payload small.

use std::path::PathBuf;

pub fn notes_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("60_Notes");
    let _ = std::fs::create_dir_all(&p);
    p
}

pub fn host_info() -> serde_json::Value {
    let host = if let Ok(out) = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
    {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        std::env::var("HOSTNAME").unwrap_or_else(|_| "mac".into())
    };
    serde_json::json!({ "host": host, "os": "macos" })
}

pub fn sanitize_id(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

pub fn list() -> Result<Vec<serde_json::Value>, String> {
    let dir = notes_dir();
    let mut out: Vec<serde_json::Value> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
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

pub fn get(id: &str) -> Result<serde_json::Value, String> {
    let p = notes_dir().join(format!("{}.json", sanitize_id(id)));
    let raw = std::fs::read_to_string(&p).map_err(|e| format!("못 찾음: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save(id: Option<String>, title: String, body: String) -> Result<serde_json::Value, String> {
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
        "updated_by": host_info(),
    });
    let pretty = serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?;
    std::fs::write(&p, pretty).map_err(|e| e.to_string())?;
    Ok(note)
}

pub fn delete(id: &str) -> Result<(), String> {
    let p = notes_dir().join(format!("{}.json", sanitize_id(id)));
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
    fn save_list_get_delete_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        let saved = save(None, "회의록".into(), "본문 내용".into()).unwrap();
        let id = saved.get("id").and_then(|v| v.as_str()).unwrap().to_string();
        assert!(id.starts_with("note-"));

        let listed = list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].get("title").and_then(|v| v.as_str()), Some("회의록"));
        // List view strips body and substitutes snippet
        assert!(listed[0].get("body").is_none());
        assert_eq!(listed[0].get("snippet").and_then(|v| v.as_str()), Some("본문 내용"));

        let fetched = get(&id).unwrap();
        assert_eq!(fetched.get("body").and_then(|v| v.as_str()), Some("본문 내용"));

        delete(&id).unwrap();
        assert_eq!(list().unwrap().len(), 0);

        std::env::remove_var("MW_SHARE_ROOT");
    }
}
