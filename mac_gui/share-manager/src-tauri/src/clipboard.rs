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

// ─── Paths ─────────────────────────────────────────────────────────

fn clipboard_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("70_Clipboard");
    let _ = create_dir_all(&p);
    p
}

fn images_dir() -> PathBuf {
    let p = clipboard_dir().join("images");
    let _ = create_dir_all(&p);
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

/// Absolute filesystem path to a stored image by its reference (e.g.
/// `"abcd123…ef.png"`). Returns Err if the file doesn't exist.
pub fn image_path_for_ref(image_ref: &str) -> Result<PathBuf, String> {
    // Reject any traversal — image_ref must be plain `<hex>.png`.
    if image_ref.contains('/') || image_ref.contains('\\') || image_ref.contains("..") {
        return Err(format!("invalid image_ref: {image_ref}"));
    }
    let p = images_dir().join(image_ref);
    if !p.exists() {
        return Err(format!("image not found: {}", p.display()));
    }
    Ok(p)
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
    append_jsonl_line(&own_history_path(), &entry)
}

// ─── Image entry ───────────────────────────────────────────────────

/// Persist an image (RGBA pixels) under `images/<sha>.png` and append a
/// matching JSONL entry. Returns the entry's `image_ref` (the basename).
pub fn append_image_entry(width: u32, height: u32, rgba: &[u8]) -> std::io::Result<String> {
    // Encode to PNG. The `image` crate handles this losslessly so screenshot
    // text remains crisp; we trade size for fidelity and rely on TTL cleanup.
    let png_bytes = encode_png(width, height, rgba).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;

    // Dedup: SHA-256 of the PNG bytes. Same screenshot copied twice ⇒ one file.
    let sha = hex::encode(Sha256::digest(&png_bytes));
    let image_ref = format!("{sha}.png");
    let abs = images_dir().join(&image_ref);
    if !abs.exists() {
        if let Some(parent) = abs.parent() {
            create_dir_all(parent)?;
        }
        std::fs::write(&abs, &png_bytes)?;
    }

    let entry = serde_json::json!({
        "ts": chrono::Local::now().to_rfc3339(),
        "host": hostname(),
        "os": "macos",
        "kind": "image",
        "image_ref": image_ref,
        "width": width,
        "height": height,
        "size_bytes": png_bytes.len(),
        // `content` kept for backward compatibility with consumers that
        // only know the v1 schema — they'll show this string verbatim.
        "content": format!("📷 image ({width}×{height}, {} KB)", png_bytes.len() / 1024),
        "len": 0,
    });
    append_jsonl_line(&own_history_path(), &entry)?;
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
        // Initial cleanup on startup
        cleanup_old_images(IMAGE_TTL_DAYS);
        let mut last_cleanup = Instant::now();

        let mut last_text: Option<String> = None;
        let mut last_image_hash: Option<String> = None;

        std::thread::sleep(Duration::from_millis(500));
        loop {
            std::thread::sleep(POLL_INTERVAL);

            // Periodic cleanup
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

    #[test]
    fn append_then_list_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        append_entry("hello world").unwrap();
        append_entry("두번째 항목").unwrap();

        let entries = list_entries(10).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].get("content").and_then(|v| v.as_str()), Some("두번째 항목"));
        assert_eq!(entries[0].get("os").and_then(|v| v.as_str()), Some("macos"));
        assert_eq!(entries[0].get("kind").and_then(|v| v.as_str()), Some("text"));
        assert_eq!(entries[0].get("len").and_then(|v| v.as_u64()), Some(6));

        clear_own_history().unwrap();
        assert_eq!(list_entries(10).unwrap().len(), 0);

        std::env::remove_var("MW_SHARE_ROOT");
    }

    #[test]
    fn image_entry_roundtrip_with_dedup_and_decode() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        // 4x4 solid red RGBA buffer = 64 bytes
        let w: u32 = 4;
        let h: u32 = 4;
        let rgba: Vec<u8> = (0..(w * h)).flat_map(|_| [200u8, 50, 50, 255]).collect();

        let ref1 = append_image_entry(w, h, &rgba).unwrap();
        let ref2 = append_image_entry(w, h, &rgba).unwrap();
        // Same bytes → same hash → same file (dedup), but JSONL has 2 entries
        assert_eq!(ref1, ref2);
        let entries = list_entries(10).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].get("kind").and_then(|v| v.as_str()), Some("image"));
        assert_eq!(entries[0].get("width").and_then(|v| v.as_u64()), Some(4));
        assert!(entries[0].get("size_bytes").and_then(|v| v.as_u64()).unwrap() > 0);

        // Round-trip the stored PNG and confirm we get back the same RGBA.
        let p = image_path_for_ref(&ref1).unwrap();
        let png = std::fs::read(&p).unwrap();
        let (dw, dh, drgba) = decode_png(&png).unwrap();
        assert_eq!((dw, dh), (w, h));
        assert_eq!(drgba, rgba);

        std::env::remove_var("MW_SHARE_ROOT");
    }

    #[test]
    fn rejects_unsafe_image_ref() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("MW_SHARE_ROOT", tmp.path());

        assert!(image_path_for_ref("../etc/passwd").is_err());
        assert!(image_path_for_ref("foo/bar.png").is_err());
        assert!(image_path_for_ref("missing.png").is_err());

        std::env::remove_var("MW_SHARE_ROOT");
    }
}
