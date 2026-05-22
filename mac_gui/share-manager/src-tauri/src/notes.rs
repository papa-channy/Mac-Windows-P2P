// notes.rs — shared note storage at 00_System/60_Notes/<note-id>.json.
//
// Storage contract:
//   - Share is the single source of truth for writes (save / delete).
//     Save while unmounted is rejected — two hosts editing the same
//     note while offline would otherwise produce conflicting last-
//     writes-wins outcomes once both reconnect.
//   - Reads fall back to a read-only local mirror under
//     ~/Library/Application Support/MacWindowShare/cache/notes/.
//     Every successful read from the share also refreshes the mirror,
//     so an offline session sees the most recent snapshot.

use std::path::PathBuf;

pub fn notes_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("60_Notes");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn local_mirror_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    let p = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("MacWindowShare")
        .join("cache")
        .join("notes");
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

/// Read all notes from `dir`, return as list-shape (body stripped → snippet).
/// As a side effect, copy each raw JSON into `mirror_dir` so a later
/// offline session has access to the same data.
fn list_from(dir: &std::path::Path, mirror_dir: Option<&std::path::Path>)
    -> Result<Vec<serde_json::Value>, String>
{
    let mut out: Vec<serde_json::Value> = Vec::new();
    if !dir.exists() { return Ok(out); }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        let raw = match std::fs::read_to_string(&p) { Ok(r) => r, Err(_) => continue };

        // Mirror to local cache (best-effort) if a mirror dir is configured.
        if let (Some(mirror), Some(name)) = (mirror_dir, p.file_name()) {
            let _ = std::fs::write(mirror.join(name), &raw);
        }

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
    out.sort_by(|a, b| {
        let am = a.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
        let bm = b.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
        bm.cmp(am)
    });
    Ok(out)
}

pub fn list() -> Result<Vec<serde_json::Value>, String> {
    if crate::mount::is_share_mounted() {
        // Read from share + refresh mirror.
        let mirror = local_mirror_dir();
        list_from(&notes_dir(), Some(&mirror))
    } else {
        // Offline: fall back to mirror.
        list_from(&local_mirror_dir(), None)
    }
}

pub fn get(id: &str) -> Result<serde_json::Value, String> {
    let safe = sanitize_id(id);
    let mirror = local_mirror_dir();
    let mirror_path = mirror.join(format!("{safe}.json"));

    if crate::mount::is_share_mounted() {
        let p = notes_dir().join(format!("{safe}.json"));
        let raw = std::fs::read_to_string(&p).map_err(|e| format!("못 찾음: {e}"))?;
        // Refresh mirror copy.
        let _ = std::fs::write(&mirror_path, &raw);
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }

    // Offline read.
    if mirror_path.exists() {
        let raw = std::fs::read_to_string(&mirror_path).map_err(|e| e.to_string())?;
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }
    Err(format!("not in cache: {id} (셰어 연결 후 다시 시도)"))
}

pub fn save(id: Option<String>, title: String, body: String) -> Result<serde_json::Value, String> {
    if !crate::mount::is_share_mounted() {
        return Err("셰어 미마운트 — 노트는 셰어 연결 후에만 저장 가능합니다.".into());
    }

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
    std::fs::write(&p, &pretty).map_err(|e| e.to_string())?;
    // Mirror locally so the new note is also visible offline.
    let _ = std::fs::write(local_mirror_dir().join(format!("{id}.json")), &pretty);
    Ok(note)
}

pub fn delete(id: &str) -> Result<(), String> {
    if !crate::mount::is_share_mounted() {
        return Err("셰어 미마운트 — 노트 삭제는 셰어 연결 후에만 가능합니다.".into());
    }
    let safe = sanitize_id(id);
    let p = notes_dir().join(format!("{safe}.json"));
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    // Mirror removal — best-effort.
    let _ = std::fs::remove_file(local_mirror_dir().join(format!("{safe}.json")));
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
        // share_root mocked via env; make sure 00_System exists so
        // is_share_mounted() returns true.
        std::env::set_var("MW_SHARE_ROOT", tmp.path());
        std::fs::create_dir_all(tmp.path().join("00_System")).unwrap();

        // Mirror dir for this test — override HOME so we don't pollute
        // the real ~/Library/Application Support.
        let home_tmp = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_tmp.path());

        let saved = save(None, "회의록".into(), "본문 내용".into()).unwrap();
        let id = saved.get("id").and_then(|v| v.as_str()).unwrap().to_string();
        assert!(id.starts_with("note-"));

        let listed = list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].get("title").and_then(|v| v.as_str()), Some("회의록"));

        let fetched = get(&id).unwrap();
        assert_eq!(fetched.get("body").and_then(|v| v.as_str()), Some("본문 내용"));

        delete(&id).unwrap();
        assert_eq!(list().unwrap().len(), 0);

        if let Some(h) = prev_home { std::env::set_var("HOME", h); }
        else { std::env::remove_var("HOME"); }
        std::env::remove_var("MW_SHARE_ROOT");
    }

    #[test]
    fn save_rejected_when_share_not_mounted() {
        let _g = ENV_LOCK.lock().unwrap();
        // Point share_root at a path that DOESN'T contain 00_System →
        // is_share_mounted() == false.
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        let home_tmp = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_tmp.path());

        let err = save(None, "title".into(), "body".into()).unwrap_err();
        assert!(err.contains("셰어"));

        if let Some(h) = prev_home { std::env::set_var("HOME", h); }
        else { std::env::remove_var("HOME"); }
        std::env::remove_var("MW_SHARE_ROOT");
    }

    #[test]
    fn get_falls_back_to_local_mirror_when_unmounted() {
        let _g = ENV_LOCK.lock().unwrap();
        let home_tmp = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_tmp.path());

        // Hand-write a mirror file
        let mirror = local_mirror_dir();
        let fake = serde_json::json!({
            "schema_version": 1,
            "id": "note-abc123",
            "title": "cached",
            "body": "from offline cache",
            "created_at": "2026-05-23T00:00:00+09:00",
            "updated_at": "2026-05-23T00:00:00+09:00",
            "updated_by": {"host": "mac", "os": "macos"}
        });
        std::fs::write(
            mirror.join("note-abc123.json"),
            serde_json::to_string_pretty(&fake).unwrap(),
        ).unwrap();

        // Point share at a missing dir so is_share_mounted() = false.
        std::env::set_var("MW_SHARE_ROOT", "/this/does/not/exist");
        let got = get("note-abc123").unwrap();
        assert_eq!(got.get("body").and_then(|v| v.as_str()), Some("from offline cache"));

        if let Some(h) = prev_home { std::env::set_var("HOME", h); }
        else { std::env::remove_var("HOME"); }
        std::env::remove_var("MW_SHARE_ROOT");
    }
}
