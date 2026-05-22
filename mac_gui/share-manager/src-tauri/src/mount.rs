// mount.rs — port of ShareMount.swift.
//
// Detects whether the share is mounted, and if not, shells out to the
// local `mw` CLI (idempotent — safe to invoke even when already mounted).
//
// Candidate paths, in priority order:
//   1. /Volumes/Mac-Window_Share          (Finder/NetAuth default)
//   2. ~/mnt/Mac-Window_Share             (mw fallback)
//   3. parse `/sbin/mount` output for any SMB mount of Mac-Window_Share

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

pub fn mw_cli_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("MacWindowShare")
        .join("mw")
}

pub fn current_mount_url() -> Option<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates: [PathBuf; 2] = [
        PathBuf::from("/Volumes/Mac-Window_Share"),
        PathBuf::from(format!("{home}/mnt/Mac-Window_Share")),
    ];
    for c in candidates.iter() {
        if is_share_mount_point(c) {
            return Some(c.clone());
        }
    }
    parse_mount_output()
}

pub fn ensure_mounted(timeout: Duration) -> Option<PathBuf> {
    if let Some(p) = current_mount_url() {
        return Some(p);
    }
    let mw = mw_cli_path();
    if !mw.is_file() { return None; }

    let mut cmd = Command::new(&mw);
    cmd.arg("mount");
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return None,
    };
    let start = Instant::now();
    let mut child = child;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(_) => break,
        }
    }
    for _ in 0..10 {
        if let Some(p) = current_mount_url() { return Some(p); }
        std::thread::sleep(Duration::from_millis(300));
    }
    current_mount_url()
}

fn is_share_mount_point(p: &Path) -> bool {
    if !p.is_dir() { return false; }
    p.join("00_System").exists() || p.join("10_Exchange").exists()
}

fn parse_mount_output() -> Option<PathBuf> {
    let out = Command::new("/sbin/mount").output().ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines().find_map(parse_mount_line)
}

/// Parse a single `/sbin/mount` output line and extract our share's mount
/// point. Returns Some(path) only when the line references Mac-Window_Share.
///
/// Expected format:
///   "//user@host/Mac-Window_Share on /Volumes/Mac-Window_Share (smbfs, ...)"
pub fn parse_mount_line(line: &str) -> Option<PathBuf> {
    if !line.contains("/Mac-Window_Share") { return None; }
    let on = line.find(" on ")?;
    let rest = &line[on + 4..];
    let paren = rest.find('(')?;
    let path = rest[..paren].trim();
    if path.is_empty() { return None; }
    Some(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_typical_smb_line() {
        let line = "//chan@DESKTOP-Q0S7LSQ/Mac-Window_Share on /Volumes/Mac-Window_Share (smbfs, nodev, nosuid)";
        assert_eq!(parse_mount_line(line), Some(PathBuf::from("/Volumes/Mac-Window_Share")));
    }

    #[test]
    fn parses_custom_mount_point() {
        let line = "//u@h/Mac-Window_Share on /Users/chan/mnt/Mac-Window_Share (smbfs)";
        assert_eq!(parse_mount_line(line), Some(PathBuf::from("/Users/chan/mnt/Mac-Window_Share")));
    }

    #[test]
    fn returns_none_for_unrelated_mounts() {
        assert_eq!(parse_mount_line("/dev/disk1s1 on / (apfs, local)"), None);
        assert_eq!(parse_mount_line(""), None);
        assert_eq!(parse_mount_line("garbage"), None);
    }
}
