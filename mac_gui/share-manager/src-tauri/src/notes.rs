// notes.rs — shared note storage at 00_System/60_Notes/<note-id>.json.
//
// Storage contract:
//   - When mounted, the share is the live source of truth: save/delete
//     write through to the share AND refresh the local mirror.
//   - When UNMOUNTED, save/delete still succeed offline. The edit lands
//     in the local mirror (so it's visible immediately) and a marker is
//     queued under cache/notes-pending/. On the next mount transition
//     `flush_pending()` replays the queue to the share.
//   - Conflict policy is last-write-wins by `updated_at`: if the other
//     host edited the same note while we were offline and its share copy
//     is newer than our queued edit, flush keeps the share version and
//     drops ours (and refreshes the mirror to match).
//   - Reads fall back to the read-only mirror when unmounted. Every
//     successful read from the share also refreshes the mirror, so an
//     offline session sees the most recent snapshot of any note it has
//     opened at least once while connected.

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

/// Offline write queue. `<id>.json` = a pending save (full note body);
/// `<id>.delete` = a pending delete marker. Replayed by `flush_pending`
/// on the next mount transition.
fn pending_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    let p = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("MacWindowShare")
        .join("cache")
        .join("notes-pending");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn read_created_at(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("created_at").and_then(|x| x.as_str().map(String::from)))
}

fn note_updated_at(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("updated_at").and_then(|x| x.as_str().map(String::from)))
}

/// `a` strictly newer than `b`? Parses RFC3339 (timezone-aware) so two
/// hosts in different timezones compare correctly; falls back to string
/// order if either fails to parse.
fn is_newer(a: &str, b: &str) -> bool {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(ta), Ok(tb)) => ta > tb,
        _ => a > b,
    }
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
    let now = chrono::Local::now().to_rfc3339();
    let id = match id {
        Some(s) if !s.is_empty() => sanitize_id(&s),
        _ => format!("note-{}", uuid::Uuid::new_v4().simple()),
    };
    let mounted = crate::mount::is_share_mounted();

    // Preserve created_at from whichever copy already exists (share when
    // mounted, else the offline mirror).
    let existing = if mounted {
        notes_dir().join(format!("{id}.json"))
    } else {
        local_mirror_dir().join(format!("{id}.json"))
    };
    let created_at = read_created_at(&existing).unwrap_or_else(|| now.clone());

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

    // Mirror always — it's the offline source of truth and makes the
    // note visible immediately regardless of mount state.
    let _ = std::fs::write(local_mirror_dir().join(format!("{id}.json")), &pretty);

    if mounted {
        // Write through to the share, and clear any stale pending markers.
        std::fs::write(notes_dir().join(format!("{id}.json")), &pretty)
            .map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(pending_dir().join(format!("{id}.json")));
        let _ = std::fs::remove_file(pending_dir().join(format!("{id}.delete")));
    } else {
        // Offline — queue the save; a prior delete marker is superseded.
        let _ = std::fs::write(pending_dir().join(format!("{id}.json")), &pretty);
        let _ = std::fs::remove_file(pending_dir().join(format!("{id}.delete")));
    }
    Ok(note)
}

pub fn delete(id: &str) -> Result<(), String> {
    let safe = sanitize_id(id);
    let mounted = crate::mount::is_share_mounted();

    // Mirror removal always.
    let _ = std::fs::remove_file(local_mirror_dir().join(format!("{safe}.json")));

    if mounted {
        let p = notes_dir().join(format!("{safe}.json"));
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::remove_file(pending_dir().join(format!("{safe}.json")));
        let _ = std::fs::remove_file(pending_dir().join(format!("{safe}.delete")));
    } else {
        // Offline — cancel any queued save, queue the delete instead.
        let _ = std::fs::remove_file(pending_dir().join(format!("{safe}.json")));
        let _ = std::fs::write(pending_dir().join(format!("{safe}.delete")), b"");
    }
    Ok(())
}

/// Replay the offline write queue to the share. Called on a mount
/// transition (and at poller startup if already mounted). Returns the
/// number of pending operations applied. No-op when unmounted.
///
/// Conflict policy (last-write-wins): for a pending save, if the share
/// copy is newer than our queued edit (the other host edited it while we
/// were offline) we keep the share version and refresh our mirror — our
/// offline edit is dropped. Otherwise we write our edit through.
pub fn flush_pending() -> usize {
    if !crate::mount::is_share_mounted() {
        return 0;
    }
    let pdir = pending_dir();
    let Ok(rd) = std::fs::read_dir(&pdir) else {
        return 0;
    };
    let mirror = local_mirror_dir();
    let share = notes_dir();
    let mut applied = 0usize;

    for ent in rd.flatten() {
        let p = ent.path();
        let name = match p.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if let Some(id) = name.strip_suffix(".delete") {
            let sp = share.join(format!("{id}.json"));
            if sp.exists() {
                let _ = std::fs::remove_file(&sp);
            }
            let _ = std::fs::remove_file(mirror.join(format!("{id}.json")));
            let _ = std::fs::remove_file(&p);
            applied += 1;
        } else if let Some(id) = name.strip_suffix(".json") {
            let Ok(raw) = std::fs::read_to_string(&p) else {
                continue;
            };
            let pending_updated = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| v.get("updated_at").and_then(|x| x.as_str().map(String::from)))
                .unwrap_or_default();
            let sp = share.join(format!("{id}.json"));
            let share_updated = note_updated_at(&sp).unwrap_or_default();

            if !share_updated.is_empty() && is_newer(&share_updated, &pending_updated) {
                // Other host's edit is newer — keep it, sync mirror to it.
                if let Ok(sr) = std::fs::read_to_string(&sp) {
                    let _ = std::fs::write(mirror.join(format!("{id}.json")), sr);
                }
            } else {
                // Our edit wins (or share has no copy) — write it through.
                let _ = std::fs::write(&sp, &raw);
                let _ = std::fs::write(mirror.join(format!("{id}.json")), &raw);
            }
            let _ = std::fs::remove_file(&p);
            applied += 1;
        }
    }
    applied
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
    fn save_offline_queues_to_pending_and_mirror() {
        let _g = ENV_LOCK.lock().unwrap();
        // share_root at a path WITHOUT 00_System → is_share_mounted() false.
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        let home_tmp = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_tmp.path());

        // Offline save now SUCCEEDS — lands in mirror + pending queue.
        let saved = save(None, "offline title".into(), "offline body".into()).unwrap();
        let id = saved.get("id").and_then(|v| v.as_str()).unwrap().to_string();

        assert!(local_mirror_dir().join(format!("{id}.json")).exists(), "mirror written");
        assert!(pending_dir().join(format!("{id}.json")).exists(), "queued pending");

        // Offline list reads from the mirror.
        let listed = list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].get("title").and_then(|v| v.as_str()), Some("offline title"));

        if let Some(h) = prev_home { std::env::set_var("HOME", h); }
        else { std::env::remove_var("HOME"); }
        std::env::remove_var("MW_SHARE_ROOT");
    }

    #[test]
    fn flush_pending_replays_offline_saves_to_share() {
        let _g = ENV_LOCK.lock().unwrap();
        let home_tmp = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_tmp.path());

        // (1) Offline (no 00_System) — queue a save.
        let off = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", off.path());
        let saved = save(None, "t".into(), "queued body".into()).unwrap();
        let id = saved.get("id").and_then(|v| v.as_str()).unwrap().to_string();
        assert!(pending_dir().join(format!("{id}.json")).exists());

        // (2) Reconnect — share now has 00_System → mounted.
        let on = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(on.path().join("00_System")).unwrap();
        std::env::set_var("MW_SHARE_ROOT", on.path());

        let applied = flush_pending();
        assert_eq!(applied, 1, "one pending op applied");
        // Pending cleared, share has the note.
        assert!(!pending_dir().join(format!("{id}.json")).exists(), "pending cleared");
        assert!(notes_dir().join(format!("{id}.json")).exists(), "share has note");
        let body = get(&id).unwrap();
        assert_eq!(body.get("body").and_then(|v| v.as_str()), Some("queued body"));

        if let Some(h) = prev_home { std::env::set_var("HOME", h); }
        else { std::env::remove_var("HOME"); }
        std::env::remove_var("MW_SHARE_ROOT");
    }

    #[test]
    fn flush_pending_keeps_newer_share_copy() {
        let _g = ENV_LOCK.lock().unwrap();
        let home_tmp = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_tmp.path());

        let on = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(on.path().join("00_System")).unwrap();
        std::env::set_var("MW_SHARE_ROOT", on.path());

        // Share already has a NEWER copy (other host edited concurrently).
        let newer = serde_json::json!({
            "schema_version": 1, "id": "note-x",
            "title": "remote", "body": "remote newer body",
            "created_at": "2026-06-01T00:00:00+09:00",
            "updated_at": "2026-06-01T12:00:00+09:00",
            "updated_by": {"host": "win", "os": "windows"}
        });
        std::fs::write(
            notes_dir().join("note-x.json"),
            serde_json::to_string_pretty(&newer).unwrap(),
        ).unwrap();

        // Our queued (older) offline edit.
        let older = serde_json::json!({
            "schema_version": 1, "id": "note-x",
            "title": "mine", "body": "my older body",
            "created_at": "2026-06-01T00:00:00+09:00",
            "updated_at": "2026-06-01T09:00:00+09:00",
            "updated_by": {"host": "mac", "os": "macos"}
        });
        std::fs::write(
            pending_dir().join("note-x.json"),
            serde_json::to_string_pretty(&older).unwrap(),
        ).unwrap();

        flush_pending();
        // Share keeps the newer remote body; ours is dropped.
        let got = get("note-x").unwrap();
        assert_eq!(got.get("body").and_then(|v| v.as_str()), Some("remote newer body"));

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
