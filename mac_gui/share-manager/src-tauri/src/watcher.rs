// watcher.rs — share-watcher with topic classification + SMB fallback polling.
//
// Mirror of windows_gui/share-manager/src-tauri/src/commands.rs::start_file_watcher
// with one Mac-specific twist (parity brief §14.6): FSEvents over SMB is
// unreliable. If `notify` fails to install a watch on any path, we drop
// into a 30s polling loop that mtime-diffs the four watched roots and
// emits the same `share-changed` events.

use notify::{recommended_watcher, EventKind, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};

pub fn watch_paths() -> Vec<PathBuf> {
    let share = crate::share::share_root();
    vec![
        share.join("10_Exchange"),
        share.join("00_System").join("70_Clipboard"),
        share.join("00_System").join("60_Notes"),
        share.join("00_System").join("10_Config").join("profiles"),
    ]
}

pub fn classify_event_path(p: &Path) -> &'static str {
    let s = p.to_string_lossy();
    if s.contains("/10_Exchange/")  { return "transfers"; }
    if s.contains("/70_Clipboard/") { return "clipboard"; }
    if s.contains("/60_Notes/")     { return "notes"; }
    if s.contains("/profiles/")     { return "profiles"; }
    ""
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let paths = watch_paths();
        for p in &paths {
            let _ = std::fs::create_dir_all(p);
        }

        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = match recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("watcher init failed: {e} — falling back to polling");
                run_polling_fallback(app);
                return;
            }
        };

        // If any watch fails (typical on SMB), bail entirely and poll.
        let mut all_ok = true;
        for p in &paths {
            if let Err(e) = watcher.watch(p, RecursiveMode::Recursive) {
                eprintln!("watch {} failed: {e}", p.display());
                all_ok = false;
                break;
            }
        }
        if !all_ok {
            drop(watcher);
            run_polling_fallback(app);
            return;
        }

        let mut last_emit: HashMap<&'static str, Instant> = HashMap::new();
        let debounce = Duration::from_millis(400);

        for res in rx {
            let event = match res { Ok(e) => e, Err(_) => continue };
            if !matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                continue;
            }
            let mut topics_fired: HashSet<&'static str> = HashSet::new();
            for p in &event.paths {
                let topic = classify_event_path(p);
                if topic.is_empty() || topics_fired.contains(topic) { continue; }
                topics_fired.insert(topic);
                let now = Instant::now();
                if let Some(prev) = last_emit.get(topic) {
                    if now.duration_since(*prev) < debounce { continue; }
                }
                last_emit.insert(topic, now);
                let _ = app.emit("share-changed", serde_json::json!({
                    "topic": topic,
                    "path": p.to_string_lossy(),
                }));
            }
        }
        let _ = watcher; // keep alive for the lifetime of the channel
    });
}

fn run_polling_fallback(app: AppHandle) {
    std::thread::spawn(move || {
        let mut prev: HashMap<&'static str, SystemTime> = HashMap::new();
        let topics: [(&'static str, fn() -> PathBuf); 4] = [
            ("transfers", || crate::share::share_root().join("10_Exchange")),
            ("clipboard", || crate::share::share_root().join("00_System").join("70_Clipboard")),
            ("notes",     || crate::share::share_root().join("00_System").join("60_Notes")),
            ("profiles",  || crate::share::share_root().join("00_System").join("10_Config").join("profiles")),
        ];
        loop {
            for (topic, path_fn) in topics.iter() {
                let p = path_fn();
                let mtime = newest_mtime_under(&p).unwrap_or(SystemTime::UNIX_EPOCH);
                let changed = match prev.get(topic) {
                    Some(prev_t) => *prev_t != mtime,
                    None => true,
                };
                if changed {
                    prev.insert(topic, mtime);
                    let _ = app.emit("share-changed", serde_json::json!({
                        "topic": *topic,
                        "path": p.to_string_lossy(),
                        "via": "polling",
                    }));
                }
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}

fn newest_mtime_under(root: &Path) -> Option<SystemTime> {
    if !root.exists() { return None; }
    let mut newest: Option<SystemTime> = None;
    for entry in walkdir::WalkDir::new(root).max_depth(3).into_iter().filter_map(|e| e.ok()) {
        if let Ok(m) = entry.metadata() {
            if let Ok(t) = m.modified() {
                newest = Some(match newest { Some(p) if p >= t => p, _ => t });
            }
        }
    }
    newest
}
