// clipboard.rs — clipboard polling + JSONL history at 70_Clipboard.
//
// v2 contract (extends WINDOWS_PARITY_BRIEF §13):
//   - text  entries: { kind: "text",  content, len, ... } (v1 unchanged)
//   - image entries: { kind: "image", image_ref: "<sha>.png", width,
//                       height, size_bytes, content: "📷 ...", len: 0, ... }
//
// Images are stored as PNG under `<share>/00_System/70_Clipboard/images/`,
// deduplicated by SHA-256. A 30-day TTL cleanup runs on poller startup +
// hourly thereafter to cap disk usage.

use sha2::{Digest, Sha256};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

const IMAGE_TTL_DAYS: u64 = 30;
const CLEANUP_INTERVAL: Duration = Duration::from_secs(3600); // 1 hour
const MAX_HISTORY_LINES: usize = 200;
const MAX_TEXT_CHARS: usize = 32_000;
const POLL_INTERVAL: Duration = Duration::from_millis(1500);

// ─── Paths — share (when mounted) AND local cache (always available) ─
//
// Path functions are PURE — they return paths without touching the
// filesystem. The earlier "create_dir_all on every call" pattern
// caused test failures (auto-creating the share dir flipped
// is_share_mounted() to true even when the test was simulating
// an unmounted share). Callers do mkdir at write time only.

fn clipboard_dir() -> PathBuf {
    crate::share::share_root().join("00_System").join("70_Clipboard")
}

fn images_dir() -> PathBuf {
    clipboard_dir().join("images")
}

/// Local cache under ~/Library/Application Support so the own-host
/// clipboard history is never lost when the share is unmounted.
fn local_cache_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("MacWindowShare")
        .join("cache")
        .join("clipboard")
}

fn local_images_dir() -> PathBuf {
    local_cache_dir().join("images")
}

fn local_history_path() -> PathBuf {
    let safe = host_id_safe(&hostname());
    let safe = if safe.is_empty() { "mac".to_string() } else { safe };
    local_cache_dir().join(format!("{safe}.history.jsonl"))
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

/// Absolute filesystem path to a stored image by its reference (e.g.
/// `"abcd123…ef.png"`). Checks the local cache first (faster + always
/// available), then falls back to the share. Returns Err if neither has it.
pub fn image_path_for_ref(image_ref: &str) -> Result<PathBuf, String> {
    if image_ref.contains('/') || image_ref.contains('\\') || image_ref.contains("..") {
        return Err(format!("invalid image_ref: {image_ref}"));
    }
    let local = local_images_dir().join(image_ref);
    if local.exists() { return Ok(local); }
    let share = images_dir().join(image_ref);
    if share.exists() { return Ok(share); }
    Err(format!("image not found: {image_ref}"))
}

// ─── JSONL append helpers ──────────────────────────────────────────

fn append_jsonl_line(path: &Path, entry: &serde_json::Value) -> std::io::Result<()> {
    if let Some(p) = path.parent() {
        create_dir_all(p)?;
    }
    let line = serde_json::to_string(entry).unwrap_or_default();
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(line.as_bytes())?;
    f.write_all(b"\n")?;
    rotate_jsonl(path, MAX_HISTORY_LINES)?;
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

// ─── Text entry ────────────────────────────────────────────────────

pub fn append_entry(text: &str) -> std::io::Result<()> {
    let host = hostname();
    let stored: String = if text.chars().count() > MAX_TEXT_CHARS {
        let mut s: String = text.chars().take(MAX_TEXT_CHARS).collect();
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

    // ALWAYS append to the local cache first — never lose data when the
    // share is unmounted. local_history_path() lives under
    // ~/Library/Application Support and is the source of truth for
    // our host's clipboard stream.
    append_jsonl_line(&local_history_path(), &entry)?;

    // Best-effort: also push to the share so other hosts see it
    // immediately. Failure here just means we'll catch up on next sync.
    if crate::mount::is_share_mounted() {
        let _ = append_jsonl_line(&own_history_path(), &entry);
    }
    Ok(())
}

// ─── Image entry ───────────────────────────────────────────────────

/// Persist an image (RGBA pixels) under `images/<sha>.png` and append a
/// matching JSONL entry. Returns the entry's `image_ref` (the basename).
///
/// Local cache is authoritative: PNG + JSONL always land there first.
/// The share copy is best-effort — if the share is unmounted now, the
/// next mount transition picks up the missing entries via sync_to_share.
pub fn append_image_entry(width: u32, height: u32, rgba: &[u8]) -> std::io::Result<String> {
    let png_bytes = encode_png(width, height, rgba).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;

    // Dedup: SHA-256 of the PNG bytes. Same screenshot copied twice ⇒ one file.
    let sha = hex::encode(Sha256::digest(&png_bytes));
    let image_ref = format!("{sha}.png");

    // (1) local cache — always
    let local_abs = local_images_dir().join(&image_ref);
    if !local_abs.exists() {
        if let Some(parent) = local_abs.parent() { create_dir_all(parent)?; }
        std::fs::write(&local_abs, &png_bytes)?;
    }

    // (2) share — best-effort
    if crate::mount::is_share_mounted() {
        let share_abs = images_dir().join(&image_ref);
        if !share_abs.exists() {
            if let Some(parent) = share_abs.parent() { let _ = create_dir_all(parent); }
            let _ = std::fs::write(&share_abs, &png_bytes);
        }
    }

    let entry = serde_json::json!({
        "ts": chrono::Local::now().to_rfc3339(),
        "host": hostname(),
        "os": "macos",
        "kind": "image",
        "image_ref": image_ref.clone(),
        "width": width,
        "height": height,
        "size_bytes": png_bytes.len(),
        "content": format!("📷 image ({width}×{height}, {} KB)", png_bytes.len() / 1024),
        "len": 0,
    });

    // Always-write to local, best-effort to share
    append_jsonl_line(&local_history_path(), &entry)?;
    if crate::mount::is_share_mounted() {
        let _ = append_jsonl_line(&own_history_path(), &entry);
    }
    Ok(image_ref)
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    use image::{ImageBuffer, Rgba};
    let buf: ImageBuffer<Rgba<u8>, _> =
        ImageBuffer::from_raw(width, height, rgba.to_vec())
            .ok_or_else(|| "ImageBuffer::from_raw failed".to_string())?;
    let mut out = std::io::Cursor::new(Vec::new());
    buf.write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode: {e}"))?;
    Ok(out.into_inner())
}

fn decode_png(png_bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let img = image::load_from_memory_with_format(png_bytes, image::ImageFormat::Png)
        .map_err(|e| format!("PNG decode: {e}"))?;
    let rgba = img.to_rgba8();
    Ok((rgba.width(), rgba.height(), rgba.into_raw()))
}

// ─── TTL cleanup ───────────────────────────────────────────────────

/// Delete image files whose mtime is older than `ttl_days` from now.
/// Returns the count deleted (best-effort; errors logged, not returned).
pub fn cleanup_old_images(ttl_days: u64) -> usize {
    let dir = images_dir();
    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(ttl_days * 86_400));
    let cutoff = match cutoff { Some(c) => c, None => return 0 };
    let mut deleted = 0usize;
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("png") { continue; }
        let mtime = entry.metadata().and_then(|m| m.modified()).ok();
        if let Some(mtime) = mtime {
            if mtime < cutoff {
                if std::fs::remove_file(&p).is_ok() {
                    deleted += 1;
                }
            }
        }
    }
    if deleted > 0 {
        eprintln!("[clipboard] cleaned up {deleted} expired image(s) (>{ttl_days}d)");
    }
    deleted
}

// ─── Poller (both text + image) ────────────────────────────────────

pub fn start_poller(app: AppHandle) {
    std::thread::spawn(move || {
        cleanup_old_images(IMAGE_TTL_DAYS);
        let mut last_cleanup = Instant::now();

        // Push any offline backlog that accumulated since the last run
        // (e.g. share was unmounted last session, we kept appending
        // locally, now it's back).
        let mut last_mount = crate::mount::is_share_mounted();
        if last_mount {
            let _ = sync_to_share();
        }

        let mut last_text: Option<String> = None;
        let mut last_image_hash: Option<String> = None;

        std::thread::sleep(Duration::from_millis(500));
        loop {
            std::thread::sleep(POLL_INTERVAL);

            // Mount transition: unmount→mount triggers a one-shot sync
            // of whatever the local cache accumulated while offline.
            let now_mount = crate::mount::is_share_mounted();
            if now_mount && !last_mount {
                let _ = sync_to_share();
            }
            last_mount = now_mount;

            if last_cleanup.elapsed() >= CLEANUP_INTERVAL {
                cleanup_old_images(IMAGE_TTL_DAYS);
                last_cleanup = Instant::now();
            }

            // 1. Try text — read_text errors on non-text clipboards on macOS
            //    so we fall through to image on Err.
            let text_now = app.clipboard().read_text().ok().filter(|s| !s.is_empty());
            if let Some(text) = text_now {
                let changed = last_text.as_ref().map(|p| p != &text).unwrap_or(true);
                if changed {
                    let _ = append_entry(&text);
                    last_text = Some(text);
                    last_image_hash = None;
                }
                continue;
            }

            // 2. Image
            if let Ok(img) = app.clipboard().read_image() {
                let rgba = img.rgba();
                let w = img.width();
                let h = img.height();
                if rgba.is_empty() || w == 0 || h == 0 { continue; }

                // Hash the raw RGBA (cheap) for change detection.
                let h_hash = hex::encode(Sha256::digest(rgba));
                let changed = last_image_hash.as_ref().map(|p| p != &h_hash).unwrap_or(true);
                if changed {
                    if let Err(e) = append_image_entry(w, h, rgba) {
                        eprintln!("[clipboard] append_image_entry failed: {e}");
                    }
                    last_image_hash = Some(h_hash);
                    last_text = None;
                }
            }
        }
    });
}

// ─── Listing / writing-back ────────────────────────────────────────

pub fn list_entries(limit: usize) -> Result<Vec<serde_json::Value>, String> {
    use std::collections::HashSet;
    let mut all: Vec<serde_json::Value> = Vec::new();
    // (ts, host) is unique per entry (NSPasteboard polling can only
    // produce one entry per tick, and our timestamp has subsecond
    // precision). Dedup using that pair so a row that exists in both
    // local cache and share doesn't appear twice.
    let mut seen: HashSet<String> = HashSet::new();

    let collect_from = |path: &PathBuf, all: &mut Vec<serde_json::Value>, seen: &mut HashSet<String>| {
        if !path.exists() { return; }
        let Ok(rd) = std::fs::read_dir(path) else { return; };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) != Some("jsonl") { continue; }
            if let Ok(content) = std::fs::read_to_string(&p) {
                for line in content.lines() {
                    if line.trim().is_empty() { continue; }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                        let key = entry_key(&v);
                        if seen.insert(key) { all.push(v); }
                    }
                }
            }
        }
    };

    // Share first when mounted (likely has multi-host coverage). If
    // share is mounted but a row is missing there yet present in the
    // local cache (offline backlog), the local cache pass picks it up.
    if crate::mount::is_share_mounted() {
        collect_from(&clipboard_dir(), &mut all, &mut seen);
    }
    // Local cache: always read, regardless of mount state. This is what
    // makes the timeline survive an unmount.
    // local_history_path() is a FILE, not a dir; read it directly.
    if let Ok(content) = std::fs::read_to_string(local_history_path()) {
        for line in content.lines() {
            if line.trim().is_empty() { continue; }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                let key = entry_key(&v);
                if seen.insert(key) { all.push(v); }
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

fn entry_key(v: &serde_json::Value) -> String {
    let ts = v.get("ts").and_then(|x| x.as_str()).unwrap_or("");
    let host = v.get("host").and_then(|x| x.as_str()).unwrap_or("");
    format!("{ts}|{host}")
}

/// Push the local cache → share for our own host's jsonl + images that
/// haven't been written there yet. Called on mount transitions (and on
/// poller startup if the share is already mounted). Returns the number
/// of newly-pushed JSONL lines.
pub fn sync_to_share() -> std::io::Result<usize> {
    if !crate::mount::is_share_mounted() { return Ok(0); }

    // JSONL backlog: local file is always a superset of share file
    // (only this host writes to its own .jsonl, never trimmed below the
    // share copy's tail because rotation lops the head). Just compare
    // line counts and append the missing suffix.
    let local_path = local_history_path();
    let share_path = own_history_path();
    let local_text = std::fs::read_to_string(&local_path).unwrap_or_default();
    let share_text = std::fs::read_to_string(&share_path).unwrap_or_default();
    let local_lines: Vec<&str> = local_text.lines().filter(|l| !l.trim().is_empty()).collect();
    let share_lines: Vec<&str> = share_text.lines().filter(|l| !l.trim().is_empty()).collect();

    let mut pushed = 0usize;
    if local_lines.len() > share_lines.len() {
        if let Some(parent) = share_path.parent() { let _ = create_dir_all(parent); }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&share_path) {
            for line in &local_lines[share_lines.len()..] {
                if writeln!(f, "{line}").is_ok() { pushed += 1; }
            }
        }
        let _ = rotate_jsonl(&share_path, MAX_HISTORY_LINES);
    }

    // Images: any local PNG whose sha isn't on the share yet gets copied
    // over. Cheap — both filesystems on local disk OR SMB; small files.
    let local_img = local_images_dir();
    let share_img = images_dir();
    if local_img.exists() {
        if let Ok(rd) = std::fs::read_dir(&local_img) {
            for ent in rd.flatten() {
                if ent.path().extension().and_then(|s| s.to_str()) != Some("png") { continue; }
                let target = share_img.join(ent.file_name());
                if !target.exists() {
                    let _ = std::fs::copy(ent.path(), &target);
                }
            }
        }
    }

    if pushed > 0 {
        eprintln!("[clipboard] synced {pushed} offline entries to share");
    }
    Ok(pushed)
}

pub fn clear_own_history() -> Result<(), String> {
    let p = own_history_path();
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Write a stored image (by `image_ref`) back to the OS clipboard.
pub fn copy_image_to_os_clipboard(app: &AppHandle, image_ref: &str) -> Result<(), String> {
    let p = image_path_for_ref(image_ref)?;
    let png_bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    let (w, h, rgba) = decode_png(&png_bytes)?;
    let img = tauri::image::Image::new_owned(rgba, w, h);
    app.clipboard().write_image(&img).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::ENV_LOCK;

    /// Sets HOME + MW_SHARE_ROOT to fresh tempdirs and restores both on
    /// drop. Without HOME override the tests would read/write the real
    /// user's local cache (which both pollutes it and lets stale state
    /// fail subsequent runs of list_entries dedup).
    struct EnvGuard {
        _share: tempfile::TempDir,
        _home: tempfile::TempDir,
        prev_share: Option<String>,
        prev_home: Option<String>,
    }
    impl EnvGuard {
        fn new() -> Self {
            let share = tempfile::tempdir().unwrap();
            let home = tempfile::tempdir().unwrap();
            // Make is_share_mounted() see the tempdir as a real share.
            std::fs::create_dir_all(share.path().join("00_System")).unwrap();
            let prev_share = std::env::var("MW_SHARE_ROOT").ok();
            let prev_home = std::env::var("HOME").ok();
            std::env::set_var("MW_SHARE_ROOT", share.path());
            std::env::set_var("HOME", home.path());
            Self { _share: share, _home: home, prev_share, prev_home }
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev_share {
                Some(v) => std::env::set_var("MW_SHARE_ROOT", v),
                None => std::env::remove_var("MW_SHARE_ROOT"),
            }
            match &self.prev_home {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    #[test]
    fn append_then_list_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        let _env = EnvGuard::new();

        append_entry("hello world").unwrap();
        // A small pause so the second entry gets a distinct timestamp;
        // otherwise list_entries dedup (keyed on ts|host) collapses them.
        std::thread::sleep(std::time::Duration::from_millis(2));
        append_entry("두번째 항목").unwrap();

        let entries = list_entries(10).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].get("content").and_then(|v| v.as_str()), Some("두번째 항목"));
        assert_eq!(entries[0].get("os").and_then(|v| v.as_str()), Some("macos"));
        assert_eq!(entries[0].get("kind").and_then(|v| v.as_str()), Some("text"));
        assert_eq!(entries[0].get("len").and_then(|v| v.as_u64()), Some(6));

        // clear_own_history removes the SHARE-side file only; the local
        // cache survives, so the next list_entries still sees both rows.
        clear_own_history().unwrap();
        assert_eq!(list_entries(10).unwrap().len(), 2);
    }

    #[test]
    fn image_entry_roundtrip_with_dedup_and_decode() {
        let _g = ENV_LOCK.lock().unwrap();
        let _env = EnvGuard::new();

        let w: u32 = 4;
        let h: u32 = 4;
        let rgba: Vec<u8> = (0..(w * h)).flat_map(|_| [200u8, 50, 50, 255]).collect();

        let ref1 = append_image_entry(w, h, &rgba).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let ref2 = append_image_entry(w, h, &rgba).unwrap();
        assert_eq!(ref1, ref2);
        let entries = list_entries(10).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].get("kind").and_then(|v| v.as_str()), Some("image"));
        assert_eq!(entries[0].get("width").and_then(|v| v.as_u64()), Some(4));
        assert!(entries[0].get("size_bytes").and_then(|v| v.as_u64()).unwrap() > 0);

        let p = image_path_for_ref(&ref1).unwrap();
        let png = std::fs::read(&p).unwrap();
        let (dw, dh, drgba) = decode_png(&png).unwrap();
        assert_eq!((dw, dh), (w, h));
        assert_eq!(drgba, rgba);
    }

    #[test]
    fn rejects_unsafe_image_ref() {
        let _g = ENV_LOCK.lock().unwrap();
        let _env = EnvGuard::new();

        assert!(image_path_for_ref("../etc/passwd").is_err());
        assert!(image_path_for_ref("foo/bar.png").is_err());
        assert!(image_path_for_ref("missing.png").is_err());
    }

    #[test]
    fn offline_write_then_sync_to_share() {
        let _g = ENV_LOCK.lock().unwrap();
        let _env = EnvGuard::new();

        // Simulate share unmounted by pointing MW_SHARE_ROOT at a path
        // that doesn't have 00_System.
        let share_unmounted = tempfile::tempdir().unwrap();
        let prev = std::env::var("MW_SHARE_ROOT").unwrap();
        std::env::set_var("MW_SHARE_ROOT", share_unmounted.path());

        append_entry("offline-1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        append_entry("offline-2").unwrap();

        // Local cache has the entries; share file should NOT exist yet.
        assert!(local_history_path().exists());
        assert!(!own_history_path().exists());

        // Now "remount" — restore the env from EnvGuard.
        std::env::set_var("MW_SHARE_ROOT", &prev);
        let pushed = sync_to_share().unwrap();
        assert_eq!(pushed, 2, "sync should push both offline entries");
        let share_lines: usize = std::fs::read_to_string(own_history_path())
            .unwrap()
            .lines()
            .filter(|l| !l.trim().is_empty())
            .count();
        assert_eq!(share_lines, 2);
    }
}
