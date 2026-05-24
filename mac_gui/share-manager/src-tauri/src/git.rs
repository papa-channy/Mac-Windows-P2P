// git.rs — T1.2 real git dashboard implementation.
//
// Mirror of windows_gui/share-manager/src-tauri/src/commands.rs §"Git
// status dashboard" + §"Git credentials" + §"GitHub remote state". The
// stub bodies that Wave A landed (placeholder Ok(empty)) are now backed
// by real `git -C` calls, GitHub API calls (ureq), and macOS Keychain
// CRUD via the `keyring` crate's `apple-native` feature.
//
// Schemas are documented in WINDOWS_PARITY_BRIEF §18.1-18.4 and must
// stay byte-identical across both clients so the dashboard can render
// either host's snapshot without per-OS branching.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Brief §18.3: PAT lives in a single keychain entry shared across both
/// clients. The frontend's `api.git.setToken(token)` takes no host —
/// only one GitHub PAT is ever held at a time.
const KEYRING_SERVICE: &str = "mac-window-git";
const KEYRING_USER: &str = "github-pat";

// ─── DTOs (frontend visible) ───────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitCommitInfo {
    pub sha: String,
    pub msg: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RepoStatus {
    pub owner_repo: Option<String>,
    pub path: String,
    pub branch: String,
    pub head: String,
    pub upstream: Option<String>,
    pub dirty: u32,
    pub dirty_files: Vec<String>,
    pub unpushed: u32,
    pub ahead: u32,
    pub behind: u32,
    pub stash: u32,
    pub last_commit: Option<GitCommitInfo>,
    pub remote_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HostGitSnapshot {
    pub schema_version: u32,
    pub host: String,
    pub os: String,
    pub scanned_at: String,
    pub repos: Vec<RepoStatus>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CommitNode {
    pub sha: String,
    pub parents: Vec<String>,
    pub msg: String,
    pub author: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitTokenStatus {
    pub has_token: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TokenInfo {
    pub login: String,
    pub name: Option<String>,
    pub orgs: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitSshStatus {
    pub has_key: bool,
    pub public_key: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemoteBranch {
    pub name: String,
    pub sha: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemotePr {
    pub number: u64,
    pub title: String,
    pub head: String,
    pub base: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemoteRepoState {
    pub owner_repo: String,
    pub default_branch: String,
    pub default_sha: String,
    pub branches: Vec<RemoteBranch>,
    pub open_prs: Vec<RemotePr>,
    pub fetched_at: String,
    pub error: Option<String>,
}

// ─── Path helpers ──────────────────────────────────────────────────

fn git_share_dir() -> PathBuf {
    let p = crate::share::share_root()
        .join("00_System")
        .join("90_Git");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn host_id_safe(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn mac_hostname() -> String {
    if let Ok(out) = Command::new("scutil").args(["--get", "LocalHostName"]).output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }
    std::env::var("HOSTNAME").unwrap_or_else(|_| "mac".into())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// macOS default scan roots — checked in order, skipped silently if the
/// path doesn't exist on the user's machine. The brief leaves the exact
/// list to per-OS judgment; these cover the common `~/Developer`,
/// `~/Projects`, `~/src` shapes plus a couple of macOS-isms.
fn default_scan_roots() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(home) = home_dir() else {
        return out;
    };
    for sub in [
        "Developer",
        "Projects",
        "Documents/Projects",
        "Documents/dev",
        "src",
        "code",
        "Workspace",
    ] {
        let p = home.join(sub);
        if p.exists() {
            out.push(p);
        }
    }
    out
}

fn default_exclude_dirs() -> std::collections::HashSet<String> {
    [
        "node_modules",
        "target",
        ".venv",
        "venv",
        "__pycache__",
        "build",
        "dist",
        ".next",
        ".turbo",
        ".gradle",
        ".cargo",
        "Library",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

// ─── git CLI shelling ──────────────────────────────────────────────

fn run_git(repo: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn normalize_owner_repo(url: &str) -> Option<String> {
    let u = url.trim();
    let i = u.find("github.com")?;
    let rest = &u[i + "github.com".len()..];
    let rest = rest.trim_start_matches([':', '/']);
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

fn repo_status_at(repo: &Path) -> RepoStatus {
    let branch =
        run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "?".into());
    let head = run_git(repo, &["rev-parse", "HEAD"]).unwrap_or_default();
    let upstream = run_git(
        repo,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    );
    let porcelain = run_git(repo, &["status", "--porcelain"]).unwrap_or_default();
    let dirty_files: Vec<String> = porcelain
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let dirty = dirty_files.len() as u32;

    let (mut ahead, mut behind) = (0u32, 0u32);
    if upstream.is_some() {
        if let Some(lr) = run_git(repo, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
            let nums: Vec<&str> = lr.split_whitespace().collect();
            if nums.len() == 2 {
                behind = nums[0].parse().unwrap_or(0);
                ahead = nums[1].parse().unwrap_or(0);
            }
        }
    }
    let stash = run_git(repo, &["stash", "list"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);
    let last_commit = run_git(repo, &["log", "-1", "--format=%H%x1f%s%x1f%cI"]).and_then(|s| {
        let parts: Vec<&str> = s.split('\u{1f}').collect();
        if parts.len() == 3 {
            Some(GitCommitInfo {
                sha: parts[0].into(),
                msg: parts[1].into(),
                date: parts[2].into(),
            })
        } else {
            None
        }
    });
    let remote_url = run_git(repo, &["remote", "get-url", "origin"]);
    let owner_repo = remote_url.as_deref().and_then(normalize_owner_repo);

    RepoStatus {
        owner_repo,
        path: repo.to_string_lossy().into_owned(),
        branch,
        head,
        upstream,
        dirty,
        dirty_files,
        unpushed: ahead,
        ahead,
        behind,
        stash,
        last_commit,
        remote_url,
    }
}

fn scan_root_for_repos(
    root: &Path,
    exclude: &std::collections::HashSet<String>,
    found: &mut Vec<PathBuf>,
) {
    let walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if !e.file_type().is_dir() {
                return true;
            }
            let n = e.file_name().to_string_lossy().to_lowercase();
            !(n == ".git" || exclude.contains(&n))
        });
    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_dir() {
            continue;
        }
        let p = entry.path();
        if found.iter().any(|r| p.starts_with(r)) {
            continue;
        }
        if p.join(".git").exists() {
            found.push(p.to_path_buf());
        }
    }
}

// ─── Discovery / scan / publish (Tauri commands) ───────────────────

#[tauri::command]
pub fn scan_git_repos() -> Result<Vec<String>, String> {
    let exclude = default_exclude_dirs();
    let mut found: Vec<PathBuf> = Vec::new();
    for root in default_scan_roots() {
        scan_root_for_repos(&root, &exclude, &mut found);
    }
    found.sort();
    Ok(found.iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub fn publish_git_status(repo_path: String) -> Result<(), String> {
    let p = PathBuf::from(&repo_path);
    if !p.join(".git").exists() {
        return Err(format!("not a git repo: {repo_path}"));
    }
    let status = repo_status_at(&p);
    publish_status_snapshot(vec![status])
}

fn publish_status_snapshot(repos: Vec<RepoStatus>) -> Result<(), String> {
    let host = mac_hostname();
    let safe = host_id_safe(&host);
    let snapshot = HostGitSnapshot {
        schema_version: 1,
        host: host.clone(),
        os: "macos".into(),
        scanned_at: chrono::Local::now().to_rfc3339(),
        repos,
    };
    let path = git_share_dir().join(format!("{safe}.git-status.json"));
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn repo_commit_log(repo: &Path, branch: &str, n: usize) -> Vec<CommitNode> {
    let fmt = "--format=%H%x1f%P%x1f%s%x1f%an%x1f%cI";
    let count = format!("-{n}");
    let raw = match run_git(repo, &["log", &count, fmt, branch]) {
        Some(s) => s,
        None => return Vec::new(),
    };
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| {
            let p: Vec<&str> = l.split('\u{1f}').collect();
            if p.len() != 5 {
                return None;
            }
            let parents = p[1]
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            Some(CommitNode {
                sha: p[0].to_string(),
                parents,
                msg: p[2].to_string(),
                author: p[3].to_string(),
                date: p[4].to_string(),
            })
        })
        .collect()
}

fn graph_branches(repo: &Path, status: &RepoStatus) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if status.branch != "?" && !status.branch.is_empty() {
        out.push(status.branch.clone());
    }
    if let Some(def) = run_git(repo, &["rev-parse", "--abbrev-ref", "origin/HEAD"]) {
        let def = def.trim_start_matches("origin/").to_string();
        if !def.is_empty() && !out.contains(&def) {
            out.push(def);
        }
    }
    out
}

#[tauri::command]
pub fn scan_and_publish_git() -> Result<u32, String> {
    let exclude = default_exclude_dirs();
    let mut found: Vec<PathBuf> = Vec::new();
    for root in default_scan_roots() {
        scan_root_for_repos(&root, &exclude, &mut found);
    }
    found.sort();

    let mut statuses: Vec<RepoStatus> = Vec::new();
    let mut logs: std::collections::BTreeMap<
        String,
        std::collections::BTreeMap<String, Vec<CommitNode>>,
    > = std::collections::BTreeMap::new();

    for p in &found {
        let st = repo_status_at(p);
        let key = st
            .owner_repo
            .clone()
            .unwrap_or_else(|| st.path.clone());
        let mut by_branch = std::collections::BTreeMap::new();
        for b in graph_branches(p, &st) {
            let log = repo_commit_log(p, &b, 50);
            if !log.is_empty() {
                by_branch.insert(b, log);
            }
        }
        if !by_branch.is_empty() {
            logs.insert(key, by_branch);
        }
        statuses.push(st);
    }

    publish_status_snapshot(statuses)?;
    let host = mac_hostname();
    let safe = host_id_safe(&host);
    let logdoc = serde_json::json!({
        "schema_version": 1,
        "host": host,
        "os": "macos",
        "scanned_at": chrono::Local::now().to_rfc3339(),
        "logs": logs,
    });
    std::fs::write(
        git_share_dir().join(format!("{safe}.git-log.json")),
        serde_json::to_string(&logdoc).unwrap_or_default(),
    )
    .map_err(|e| e.to_string())?;

    Ok(found.len() as u32)
}

#[tauri::command]
pub fn list_git_status() -> Result<Vec<HostGitSnapshot>, String> {
    let dir = git_share_dir();
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for e in rd.flatten() {
        let p = e.path();
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !name.ends_with(".git-status.json") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(snap) = serde_json::from_str::<HostGitSnapshot>(&raw) {
                out.push(snap);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_git_logs() -> Result<serde_json::Value, String> {
    let dir = git_share_dir();
    let mut hosts = serde_json::Map::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(serde_json::Value::Object(hosts)),
    };
    for e in rd.flatten() {
        let p = e.path();
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !name.ends_with(".git-log.json") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                let host = v.get("host").and_then(|x| x.as_str()).unwrap_or(name).to_string();
                hosts.insert(host, v);
            }
        }
    }
    Ok(serde_json::Value::Object(hosts))
}

// ─── Diff / config / branches ──────────────────────────────────────

#[tauri::command]
pub fn git_file_diff(
    repo_path: String,
    file_path: String,
    rev: Option<String>,
) -> Result<String, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() {
        return Err("레포 경로가 유효하지 않음".into());
    }
    let mode = rev.as_deref().unwrap_or("working");
    let args: Vec<&str> = match mode {
        "staged" => vec!["diff", "--cached", "--", &file_path],
        "remote" => vec!["diff", "@{u}..HEAD", "--", &file_path],
        _ => vec!["diff", "HEAD", "--", &file_path],
    };
    Ok(run_git(repo, &args).unwrap_or_default())
}

#[tauri::command]
pub fn git_config_read(repo_path: String) -> Result<String, String> {
    let p = Path::new(&repo_path).join(".git").join("config");
    if !p.exists() {
        return Err("config 파일 없음".into());
    }
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_list_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repo = Path::new(&repo_path);
    let out = run_git(repo, &["branch", "--format=%(refname:short)"]).unwrap_or_default();
    let mut v: Vec<String> = out
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if v.is_empty() {
        v.push("main".to_string());
    }
    Ok(v)
}

// ─── Credentials — single PAT in macOS Keychain ────────────────────

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn get_token() -> Option<String> {
    keyring_entry().ok().and_then(|e| e.get_password().ok())
}

#[tauri::command]
pub fn git_set_token(token: String) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("빈 토큰".into());
    }
    keyring_entry()?.set_password(t).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_has_token() -> Result<GitTokenStatus, String> {
    Ok(GitTokenStatus {
        has_token: get_token().is_some(),
    })
}

#[tauri::command]
pub fn git_clear_token() -> Result<(), String> {
    let e = keyring_entry()?;
    match e.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(x) => Err(x.to_string()),
    }
}

fn gh_get(token: &str, url: &str) -> Result<serde_json::Value, String> {
    ureq::get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("User-Agent", "mac-window-share")
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "토큰 인증 실패 (401) — 토큰/스코프 확인".to_string(),
            ureq::Error::Status(code, _) => format!("GitHub API {code}"),
            other => format!("네트워크 오류: {other}"),
        })?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_test_token() -> Result<TokenInfo, String> {
    let token = get_token().ok_or("등록된 토큰이 없습니다")?;
    let user = gh_get(&token, "https://api.github.com/user")?;
    let login = user
        .get("login")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let name = user
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let orgs_v = gh_get(&token, "https://api.github.com/user/orgs")
        .unwrap_or(serde_json::Value::Array(vec![]));
    let orgs: Vec<String> = orgs_v
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|o| o.get("login").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    Ok(TokenInfo { login, name, orgs })
}

// ─── SSH ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn git_ssh_status() -> Result<GitSshStatus, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    for name in ["id_ed25519.pub", "mac_window_git_ed25519.pub", "id_rsa.pub"] {
        let p = ssh.join(name);
        if p.exists() {
            let pubkey = std::fs::read_to_string(&p).unwrap_or_default();
            return Ok(GitSshStatus {
                has_key: true,
                public_key: Some(pubkey.trim().to_string()),
                path: Some(p.to_string_lossy().into_owned()),
            });
        }
    }
    Ok(GitSshStatus {
        has_key: false,
        public_key: None,
        path: None,
    })
}

#[tauri::command]
pub fn git_generate_ssh_key() -> Result<GitSshStatus, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    std::fs::create_dir_all(&ssh).map_err(|e| e.to_string())?;
    let key = ssh.join("mac_window_git_ed25519");
    let pubp = ssh.join("mac_window_git_ed25519.pub");
    if !pubp.exists() {
        let out = Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "", "-C", "mac-window-git", "-f"])
            .arg(&key)
            .output()
            .map_err(|e| format!("ssh-keygen 실행 실패: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "ssh-keygen 오류: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }
    git_ssh_status()
}

// ─── Remote (GitHub API) ───────────────────────────────────────────

fn fetch_one_remote(token: &str, owner_repo: &str) -> RemoteRepoState {
    let now = chrono::Local::now().to_rfc3339();
    let mut st = RemoteRepoState {
        owner_repo: owner_repo.to_string(),
        default_branch: String::new(),
        default_sha: String::new(),
        branches: Vec::new(),
        open_prs: Vec::new(),
        fetched_at: now,
        error: None,
    };
    let meta = match gh_get(token, &format!("https://api.github.com/repos/{owner_repo}")) {
        Ok(v) => v,
        Err(e) => {
            st.error = Some(e);
            return st;
        }
    };
    st.default_branch = meta
        .get("default_branch")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if let Ok(v) = gh_get(
        token,
        &format!("https://api.github.com/repos/{owner_repo}/branches?per_page=100"),
    ) {
        if let Some(arr) = v.as_array() {
            for b in arr {
                let name = b
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let sha = b
                    .get("commit")
                    .and_then(|c| c.get("sha"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                if name == st.default_branch {
                    st.default_sha = sha.clone();
                }
                if !name.is_empty() {
                    st.branches.push(RemoteBranch { name, sha });
                }
            }
        }
    }
    if let Ok(v) = gh_get(
        token,
        &format!("https://api.github.com/repos/{owner_repo}/pulls?state=open&per_page=50"),
    ) {
        if let Some(arr) = v.as_array() {
            for p in arr {
                st.open_prs.push(RemotePr {
                    number: p.get("number").and_then(|x| x.as_u64()).unwrap_or(0),
                    title: p
                        .get("title")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    head: p
                        .get("head")
                        .and_then(|h| h.get("ref"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    base: p
                        .get("base")
                        .and_then(|h| h.get("ref"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                });
            }
        }
    }
    st
}

#[tauri::command]
pub fn github_fetch_remote(owner_repos: Vec<String>) -> Result<Vec<RemoteRepoState>, String> {
    let token = get_token().ok_or("등록된 토큰이 없습니다")?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for or in owner_repos {
        if or.is_empty() || !seen.insert(or.clone()) {
            continue;
        }
        out.push(fetch_one_remote(&token, &or));
    }
    let cache = serde_json::json!({
        "fetched_at": chrono::Local::now().to_rfc3339(),
        "repos": out,
    });
    let _ = std::fs::write(
        git_share_dir().join("remote-cache.json"),
        serde_json::to_string_pretty(&cache).unwrap_or_default(),
    );
    Ok(out)
}

#[tauri::command]
pub fn read_remote_cache() -> Result<serde_json::Value, String> {
    let p = git_share_dir().join("remote-cache.json");
    if !p.exists() {
        return Ok(serde_json::json!({ "repos": [] }));
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

// ─── Build RepoGraph (the heart of the dashboard) ──────────────────

fn fetch_remote_commits(token: &str, owner_repo: &str, branch: &str) -> Vec<CommitNode> {
    let url = format!(
        "https://api.github.com/repos/{owner_repo}/commits?sha={branch}&per_page=50"
    );
    let v = match gh_get(token, &url) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let arr = match v.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .map(|c| {
            let sha = c
                .get("sha")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let parents = c
                .get("parents")
                .and_then(|p| p.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| {
                            x.get("sha").and_then(|s| s.as_str()).map(|s| s.to_string())
                        })
                        .collect()
                })
                .unwrap_or_default();
            let commit = c.get("commit");
            let msg = commit
                .and_then(|cm| cm.get("message"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("")
                .to_string();
            let author = commit
                .and_then(|cm| cm.get("author"))
                .and_then(|a| a.get("name"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let date = commit
                .and_then(|cm| cm.get("author"))
                .and_then(|a| a.get("date"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            CommitNode {
                sha,
                parents,
                msg,
                author,
                date,
            }
        })
        .filter(|c| !c.sha.is_empty())
        .collect()
}

#[tauri::command]
pub fn build_repo_graph(owner_repo: String) -> Result<serde_json::Value, String> {
    use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

    let logs_doc = list_git_logs()?;
    let mut hosts: Vec<(String, String)> = Vec::new();
    let mut local: HashMap<(String, String), Vec<CommitNode>> = HashMap::new();
    let mut branches: BTreeSet<String> = BTreeSet::new();
    if let Some(obj) = logs_doc.as_object() {
        for (host, doc) in obj {
            let os = doc
                .get("os")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let repo_logs = doc.get("logs").and_then(|l| l.get(&owner_repo));
            if let Some(byb) = repo_logs.and_then(|r| r.as_object()) {
                hosts.push((host.clone(), os));
                for (branch, arr) in byb {
                    branches.insert(branch.clone());
                    let commits: Vec<CommitNode> =
                        serde_json::from_value(arr.clone()).unwrap_or_default();
                    local.insert((host.clone(), branch.clone()), commits);
                }
            }
        }
    }
    if hosts.is_empty() {
        return Err("이 레포의 커밋 로그가 아직 없어요 (스캔 필요)".into());
    }

    let token = get_token();
    let mut remote: HashMap<String, Vec<CommitNode>> = HashMap::new();
    let mut default_branch = String::new();
    if let Some(tok) = &token {
        if let Ok(meta) = gh_get(tok, &format!("https://api.github.com/repos/{owner_repo}")) {
            default_branch = meta
                .get("default_branch")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }
        if !default_branch.is_empty() {
            branches.insert(default_branch.clone());
        }
        for b in branches.iter() {
            let rc = fetch_remote_commits(tok, &owner_repo, b);
            if !rc.is_empty() {
                remote.insert(b.clone(), rc);
            }
        }
    }

    let mut per_branch = serde_json::Map::new();
    for branch in branches.iter() {
        let mut node: BTreeMap<String, CommitNode> = BTreeMap::new();
        let mut src_in: HashMap<String, HashSet<String>> = HashMap::new();
        let mut order_hint: HashMap<String, usize> = HashMap::new();

        let mut add_source = |key: &str,
                              commits: &[CommitNode],
                              node: &mut BTreeMap<String, CommitNode>,
                              src_in: &mut HashMap<String, HashSet<String>>,
                              order_hint: &mut HashMap<String, usize>| {
            let set = src_in.entry(key.to_string()).or_default();
            for (i, c) in commits.iter().enumerate() {
                node.entry(c.sha.clone()).or_insert_with(|| c.clone());
                set.insert(c.sha.clone());
                let e = order_hint.entry(c.sha.clone()).or_insert(usize::MAX);
                if i < *e {
                    *e = i;
                }
            }
        };

        let mut pointers = serde_json::Map::new();
        if let Some(rc) = remote.get(branch) {
            add_source("remote", rc, &mut node, &mut src_in, &mut order_hint);
            if let Some(tip) = rc.first() {
                pointers.insert("remote".into(), serde_json::json!(tip.sha));
            }
        }
        for (host, _os) in &hosts {
            if let Some(commits) = local.get(&(host.clone(), branch.clone())) {
                add_source(host, commits, &mut node, &mut src_in, &mut order_hint);
                if let Some(tip) = commits.first() {
                    pointers.insert(host.clone(), serde_json::json!(tip.sha));
                }
            }
        }

        let mut shas: Vec<String> = node.keys().cloned().collect();
        shas.sort_by(|a, b| {
            let da = node.get(a).map(|n| n.date.clone()).unwrap_or_default();
            let db = node.get(b).map(|n| n.date.clone()).unwrap_or_default();
            db.cmp(&da).then(order_hint.get(a).cmp(&order_hint.get(b)))
        });

        let source_keys: Vec<String> = src_in.keys().cloned().collect();
        let common_ancestor = shas
            .iter()
            .find(|s| {
                source_keys
                    .iter()
                    .all(|k| src_in.get(k).map(|set| set.contains(*s)).unwrap_or(false))
            })
            .cloned();

        let mut summary = serde_json::Map::new();
        let empty = HashSet::new();
        let rset = src_in.get("remote").unwrap_or(&empty);
        for (host, _os) in &hosts {
            if let Some(hset) = src_in.get(host) {
                let ahead = hset.iter().filter(|s| !rset.contains(*s)).count();
                let behind = if rset.is_empty() {
                    0
                } else {
                    rset.iter().filter(|s| !hset.contains(*s)).count()
                };
                summary.insert(
                    host.clone(),
                    serde_json::json!({
                        "ahead": ahead,
                        "behind": behind,
                        "has_remote": !rset.is_empty(),
                    }),
                );
            }
        }

        let commits_json: Vec<serde_json::Value> = shas
            .iter()
            .map(|s| {
                let n = &node[s];
                let mut inmap = serde_json::Map::new();
                for k in &source_keys {
                    inmap.insert(
                        k.clone(),
                        serde_json::json!(src_in.get(k).map(|set| set.contains(s)).unwrap_or(false)),
                    );
                }
                let tips: Vec<String> = pointers
                    .iter()
                    .filter(|(_, v)| v.as_str() == Some(s.as_str()))
                    .map(|(k, _)| k.clone())
                    .collect();
                serde_json::json!({
                    "sha": s,
                    "short": &s[..s.len().min(7)],
                    "parents": n.parents,
                    "msg": n.msg,
                    "author": n.author,
                    "date": n.date,
                    "in": inmap,
                    "tips": tips,
                    "ancestor": Some(s) == common_ancestor.as_ref(),
                })
            })
            .collect();

        per_branch.insert(
            branch.clone(),
            serde_json::json!({
                "commits": commits_json,
                "pointers": pointers,
                "common_ancestor": common_ancestor,
                "summary": summary,
            }),
        );
    }

    let hosts_json: Vec<serde_json::Value> = hosts
        .iter()
        .map(|(h, o)| serde_json::json!({"host": h, "os": o}))
        .collect();
    Ok(serde_json::json!({
        "owner_repo": owner_repo,
        "default_branch": default_branch,
        "branches": branches.iter().cloned().collect::<Vec<_>>(),
        "hosts": hosts_json,
        "has_token": token.is_some(),
        "per_branch": per_branch,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_https_https_origin_url() {
        assert_eq!(
            normalize_owner_repo("https://github.com/papa-channy/Mac-Windows-P2P.git"),
            Some("papa-channy/Mac-Windows-P2P".to_string())
        );
    }

    #[test]
    fn normalizes_ssh_origin_url() {
        assert_eq!(
            normalize_owner_repo("git@github.com:papa-channy/Mac-Windows-P2P.git"),
            Some("papa-channy/Mac-Windows-P2P".to_string())
        );
    }

    #[test]
    fn refuses_non_github_origin() {
        assert!(normalize_owner_repo("https://gitlab.com/foo/bar.git").is_none());
    }

    #[test]
    fn host_id_sanitizes_special_chars() {
        assert_eq!(host_id_safe("chans-MacBook.local"), "chans-MacBook_local");
        assert_eq!(host_id_safe("My Mac (work)"), "My_Mac__work_");
    }

    #[test]
    fn normalizes_url_with_trailing_path_segments() {
        assert_eq!(
            normalize_owner_repo("https://github.com/foo/bar/tree/main"),
            Some("foo/bar".to_string())
        );
    }

    #[test]
    fn normalizes_url_with_subdomain_strips_correctly() {
        // www. prefix is part of the host, not part of the segment — we
        // only key off "github.com" appearing in the URL so the colon /
        // slash trimming after that prefix takes over.
        assert_eq!(
            normalize_owner_repo("https://www.github.com/foo/bar.git"),
            Some("foo/bar".to_string())
        );
    }

    #[test]
    fn default_exclude_dirs_contains_common_build_outputs() {
        let excl = default_exclude_dirs();
        for needle in ["node_modules", "target", "venv", ".next", "build", "dist"] {
            assert!(excl.contains(needle), "missing exclude: {needle}");
        }
    }

    #[test]
    fn host_id_safe_empty_input() {
        assert_eq!(host_id_safe(""), "");
    }
}
