// git.rs — T1.1 skeleton for the v0.3 git dashboard.
//
// 17 Tauri commands stubbed with the same signatures as Windows side
// (`windows_gui/share-manager/src-tauri/src/commands.rs`, per
// `WINDOWS_PARITY_BRIEF.md §18.2`). Bodies are minimal:
//
//   - Discovery / cache / publish      → return Ok(empty Vec or sentinel JSON)
//   - github_fetch_remote / cache reads → return Ok(empty Vec)
//   - build_repo_graph                  → return Ok({}) with the v18.1 schema
//                                          shape so the frontend can render
//                                          a "(empty)" state without crashes
//   - file_diff / config_read / list_branches → return Ok("") / Ok(vec![])
//   - Token CRUD (keyring `apple-native`) → real implementations are short,
//                                          land them here too since they
//                                          have no remote dependencies
//   - SSH probe                         → real readonly fs check, no harm
//   - SSH generate                      → Err("Wave B") for now
//
// Real network / git invocations land in Wave B (T1.2 — actually scan and
// publish git status from the Mac side). The point of Wave A is to make
// the invoke_handler register cleanly so the L1/L2/L3 React components
// (Wave C) can wire to typed commands before the bodies exist.

use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "com.shareguard.share-manager.git-token";

// ─── Public DTOs (frontend visible) ────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitTokenStatus {
    pub has_token: bool,
    pub host: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitSshStatus {
    /// Path to the private key we probed (`~/.ssh/id_ed25519` on macOS).
    pub key_path: String,
    pub exists: bool,
    /// Whether the matching `.pub` is also present.
    pub pub_exists: bool,
    /// Best-effort: did `ssh-add -l` list the key? Wave B fills this.
    pub agent_loaded: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct RepoGraph {
    pub schema_version: u32,
    pub roots: Vec<serde_json::Value>,
    pub repos: Vec<serde_json::Value>,
    pub hosts: Vec<serde_json::Value>,
    pub branches: Vec<serde_json::Value>,
}

// ─── 1. Discovery / scan / publish ─────────────────────────────────

/// Scan the user's local filesystem for git repos under known roots
/// (~/Developer, ~/Documents, ~/Projects, etc.). Returns a list of
/// discovered repo paths. Wave B fills in actual filesystem walk.
#[tauri::command]
pub fn scan_git_repos() -> Result<Vec<String>, String> {
    Ok(vec![])
}

/// scan_git_repos + publish_git_status in one shot — used by the
/// dashboard "지금 스캔" button. Returns the count of repos scanned.
#[tauri::command]
pub fn scan_and_publish_git() -> Result<u32, String> {
    Ok(0)
}

/// Walk a single repo and write its status (branches, HEAD, dirty
/// files, ahead/behind counters) into
/// <share>/00_System/30_Git/<hostname>.git-status.json.
#[tauri::command]
pub fn publish_git_status(_repo_path: String) -> Result<(), String> {
    Ok(())
}

/// Read every host's published `<hostname>.git-status.json` from the
/// share and return them as a list.
#[tauri::command]
pub fn list_git_status() -> Result<Vec<serde_json::Value>, String> {
    Ok(vec![])
}

/// Read every host's published `<hostname>.git-log.json` from the share.
#[tauri::command]
pub fn list_git_logs() -> Result<Vec<serde_json::Value>, String> {
    Ok(vec![])
}

// ─── 2. Remote (GitHub) ────────────────────────────────────────────

/// Hit api.github.com/repos/<owner>/<repo>/branches+commits with the
/// stored PAT, write the result into the share's remote cache. Wave B
/// does the actual HTTPS calls.
#[tauri::command]
pub fn github_fetch_remote(_owner: String, _repo: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({"ok": false, "wave": "B"}))
}

/// Read whatever github_fetch_remote last wrote into the share's
/// remote cache. Read-only, no network.
#[tauri::command]
pub fn read_remote_cache(_owner: String, _repo: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({}))
}

// ─── 3. Graph + diff ───────────────────────────────────────────────

/// Aggregate every host's published status + the remote cache into the
/// RepoGraph schema (§18.1). Frontend's L1 dashboard renders directly
/// from this.
#[tauri::command]
pub fn build_repo_graph() -> Result<RepoGraph, String> {
    Ok(RepoGraph {
        schema_version: 1,
        ..Default::default()
    })
}

/// Return the diff of a single file at `repo_path` vs the index (or vs
/// `rev` when supplied). Wave B shells out to `git diff --unified=3`.
#[tauri::command]
pub fn git_file_diff(
    _repo_path: String,
    _file_path: String,
    _rev: Option<String>,
) -> Result<String, String> {
    Ok(String::new())
}

// ─── 4. Config / branches ──────────────────────────────────────────

/// Cat the raw `.git/config` for the given repo so the inspector's
/// "Git Config" tab can render it (mono, light bg, ADR-0001).
#[tauri::command]
pub fn git_config_read(_repo_path: String) -> Result<String, String> {
    Ok(String::new())
}

/// List local + remote branches. Returns `[{name, head_sha, upstream}]`.
#[tauri::command]
pub fn git_list_branches(_repo_path: String) -> Result<Vec<serde_json::Value>, String> {
    Ok(vec![])
}

// ─── 5. Token CRUD via macOS Keychain (apple-native) ───────────────

/// Store `token` in Keychain under our service id and account=`host`
/// (typically "github.com"). User sees a Keychain Access dialog the
/// first time and can opt to "Always Allow" for this bundle id.
#[tauri::command]
pub fn git_set_token(host: String, token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &host).map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())
}

/// Is there a token for this host? Doesn't reveal the token itself,
/// just a presence check. Used by Settings → Git → "GitHub 토큰" badge.
#[tauri::command]
pub fn git_has_token(host: String) -> Result<GitTokenStatus, String> {
    let entry = match keyring::Entry::new(KEYRING_SERVICE, &host) {
        Ok(e) => e,
        Err(e) => return Err(e.to_string()),
    };
    let has = entry.get_password().is_ok();
    Ok(GitTokenStatus {
        has_token: has,
        host: Some(host),
    })
}

#[tauri::command]
pub fn git_clear_token(host: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &host).map_err(|e| e.to_string())?;
    // delete_credential returns Err on "no such entry" — treat as Ok.
    let _ = entry.delete_credential();
    Ok(())
}

/// Try the stored token against api.github.com/user. Wave B does the
/// HTTPS roundtrip; for now report "stub" so the frontend can render
/// a meaningful placeholder.
#[tauri::command]
pub fn git_test_token(_host: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "ok": false,
        "stub": true,
        "wave": "B",
    }))
}

// ─── 6. SSH ────────────────────────────────────────────────────────

#[tauri::command]
pub fn git_ssh_status() -> Result<GitSshStatus, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let key = std::path::PathBuf::from(&home).join(".ssh").join("id_ed25519");
    let pub_key = key.with_extension("pub");
    Ok(GitSshStatus {
        key_path: key.to_string_lossy().into_owned(),
        exists: key.exists(),
        pub_exists: pub_key.exists(),
        agent_loaded: false, // ssh-add probe is Wave B
    })
}

/// Generate a new ed25519 SSH key at `~/.ssh/id_ed25519` with the given
/// comment (typically the user's GitHub email). Currently Wave B —
/// returns an error so the UI surfaces "not yet implemented" rather
/// than silently doing nothing.
#[tauri::command]
pub fn git_generate_ssh_key(_comment: String) -> Result<GitSshStatus, String> {
    Err("ssh-keygen integration lands in Wave B (T1.2)".into())
}
