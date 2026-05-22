// desktop_alias.rs — manages a `~/Desktop/share-manager.app` symlink that
// points at the canonical `/Applications/share-manager.app` install.
//
// Why a symlink and not a copy: the Tauri updater replaces the .app in place
// at its install location. A symlink resolves dynamically on each open, so
// it transparently picks up the new version. A copy on the Desktop would
// become stale on every update.
//
// First-launch behavior:
//   - If the running binary is inside /Applications/share-manager.app, and
//     the desktop link is missing or broken, create it.
//   - Never silently overwrite an existing non-symlink file (the user may
//     have placed a real .app there intentionally).

use std::path::PathBuf;
use tauri::AppHandle;

pub fn applications_path() -> PathBuf {
    PathBuf::from("/Applications/share-manager.app")
}

pub fn desktop_alias_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join("Desktop").join("share-manager.app")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AliasStatus {
    /// Symlink exists and points at /Applications/share-manager.app.
    Healthy,
    /// Symlink exists but points elsewhere.
    Misdirected(PathBuf),
    /// File exists at the desktop path but it's NOT a symlink (real .app).
    BlockedByFile,
    /// Nothing at the desktop path.
    Absent,
}

pub fn current_status() -> AliasStatus {
    let p = desktop_alias_path();
    if !p.exists() && std::fs::symlink_metadata(&p).is_err() {
        return AliasStatus::Absent;
    }
    let meta = match std::fs::symlink_metadata(&p) {
        Ok(m) => m,
        Err(_) => return AliasStatus::Absent,
    };
    if !meta.file_type().is_symlink() {
        return AliasStatus::BlockedByFile;
    }
    match std::fs::read_link(&p) {
        Ok(target) if target == applications_path() => AliasStatus::Healthy,
        Ok(other) => AliasStatus::Misdirected(other),
        Err(_) => AliasStatus::Absent,
    }
}

pub fn install() -> Result<(), String> {
    let target = applications_path();
    if !target.exists() {
        return Err(format!(
            "{} 가 없어요. share-manager.app 을 먼저 /Applications 으로 옮긴 뒤 다시 시도하세요.",
            target.display()
        ));
    }
    let link = desktop_alias_path();
    match current_status() {
        AliasStatus::Healthy => return Ok(()),
        AliasStatus::Misdirected(_) => {
            // Stale symlink — safe to replace.
            std::fs::remove_file(&link).map_err(|e| e.to_string())?;
        }
        AliasStatus::BlockedByFile => {
            return Err(format!(
                "{} 에 심볼릭 링크가 아닌 실제 파일이 있어요. 수동으로 옮기거나 삭제한 뒤 다시 시도하세요.",
                link.display()
            ));
        }
        AliasStatus::Absent => {}
    }
    std::os::unix::fs::symlink(&target, &link).map_err(|e| e.to_string())
}

pub fn remove() -> Result<(), String> {
    let link = desktop_alias_path();
    match current_status() {
        AliasStatus::Healthy | AliasStatus::Misdirected(_) => {
            std::fs::remove_file(&link).map_err(|e| e.to_string())
        }
        AliasStatus::BlockedByFile => {
            Err("심볼릭 링크가 아닌 실제 파일이라 안전상 자동 삭제하지 않아요.".into())
        }
        AliasStatus::Absent => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::ENV_LOCK;

    /// RAII guard that restores $HOME on drop. Critical: leaving HOME unset
    /// would cause subsequent tests (which write to $HOME/Library/...) to
    /// fall back to a CWD-relative `Library/` directory and pollute the
    /// crate root.
    struct HomeGuard(Option<String>);
    impl HomeGuard {
        fn set(p: &std::path::Path) -> Self {
            let prev = std::env::var("HOME").ok();
            std::env::set_var("HOME", p);
            Self(prev)
        }
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    #[test]
    fn current_status_absent_when_link_missing() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let _home = HomeGuard::set(tmp.path());

        assert_eq!(current_status(), AliasStatus::Absent);
        std::fs::create_dir_all(tmp.path().join("Desktop")).unwrap();
        assert_eq!(current_status(), AliasStatus::Absent);
    }

    #[test]
    fn current_status_blocked_by_real_file() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let _home = HomeGuard::set(tmp.path());

        let desk = tmp.path().join("Desktop");
        std::fs::create_dir_all(&desk).unwrap();
        std::fs::create_dir_all(desk.join("share-manager.app")).unwrap();
        assert_eq!(current_status(), AliasStatus::BlockedByFile);
    }
}

/// Called from `setup()`. Idempotent and never errors — failures (e.g. dev
/// build running from cargo target dir) are logged via eprintln but don't
/// block startup.
pub fn ensure_on_first_launch(_app: &AppHandle) -> Result<(), ()> {
    // Only install if WE'RE the /Applications copy. This skips dev runs
    // (`cargo tauri dev`) and runs from random Downloads directories.
    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };
    if !current_exe.starts_with("/Applications/share-manager.app/") {
        return Ok(());
    }
    if matches!(current_status(), AliasStatus::Healthy) {
        return Ok(());
    }
    if let Err(e) = install() {
        eprintln!("desktop alias install skipped: {e}");
    }
    Ok(())
}
