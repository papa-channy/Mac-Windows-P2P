# Mac → Windows Parity 핸드오프 (Git HIGH backport)

> `PARITY_MATRIX.md` §3-B 의 HIGH 항목을 Windows 에 미러링하는 지시문.
> 이 커밋을 pull 한 뒤 이 문서 + 커밋 메시지만으로 작업 가능.
> wire format(git-status/log/remote-cache)은 이미 byte-identical 이므로,
> 여기서는 **명령 표면(Tauri command) + UI wiring** 만 추가하면 된다.
>
> Windows = 단일 `src-tauri/src/commands.rs` + `src/app.js`.

---

## 작업 목록 (우선순위)

| # | 항목 | Mac 식별자 | 난이도 | 비고 |
|---|---|---|---|---|
| **G1** | interactive git ops (fetch/pull/push/stash/stash_pop) | F-7 | 하 | git CLI wrapper — 거의 복붙 |
| **G2** | PAT cross-host sync (age + ssh) | F-3 / B-10 | 상 | age + keyring crate, 프로토콜 문서 있음 |
| **G3** | single-instance plugin | M-7-a | 하 | 플러그인 등록 1줄 + 핸들러 |

G1 → G3 → G2 순서 권장 (쉬운 것 먼저, G2 는 crate 의존성 추가 필요).

---

## G1. Interactive git ops (필수, 난이도 하)

Mac `git.rs:561-672` 를 그대로 포팅. **git CLI 를 `-C <repo>` 로 호출하는 얇은
wrapper** 라 OS 차이 거의 없음 (Windows 에 git 설치 가정 — 이미 scan 이 git
호출하므로 충족).

### G1.1 `commands.rs` 에 추가

```rust
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct GitOpResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn run_git_op(repo: &std::path::Path, args: &[&str]) -> GitOpResult {
    let out = std::process::Command::new("git").arg("-C").arg(repo).args(args).output();
    match out {
        Ok(o) => GitOpResult {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
            exit_code: o.status.code(),
        },
        Err(e) => GitOpResult {
            ok: false, stdout: String::new(),
            stderr: format!("git exec failed: {e}"), exit_code: None,
        },
    }
}

// 로그는 Windows 의 기존 append_log(category, json) 사용 (Mac log_op 동일 구조)
fn log_git_op(op: &str, repo: &std::path::Path, r: &GitOpResult) {
    let category = if r.ok { "send" } else { "error" };
    append_log(category, serde_json::json!({
        "event": if r.ok { format!("git_{op}_ok") } else { format!("git_{op}_fail") },
        "op": op, "repo": repo.to_string_lossy(),
        "stderr": r.stderr.lines().take(3).collect::<Vec<_>>().join("\n"),
        "exit": r.exit_code,
    }));
}

#[tauri::command]
pub fn git_op_fetch(repo_path: String) -> Result<GitOpResult, String> {
    let repo = std::path::Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["fetch", "--all", "--prune"]);
    log_git_op("fetch", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_pull(repo_path: String) -> Result<GitOpResult, String> {
    let repo = std::path::Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    // --ff-only: diverge 시 머지 시작 않고 명확한 에러 (toast 로 surface)
    let r = run_git_op(repo, &["pull", "--ff-only"]);
    log_git_op("pull", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_push(repo_path: String) -> Result<GitOpResult, String> {
    let repo = std::path::Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["push"]);
    log_git_op("push", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_stash(repo_path: String, message: Option<String>) -> Result<GitOpResult, String> {
    let repo = std::path::Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let msg = message.unwrap_or_else(|| "share-manager auto stash".to_string());
    let r = run_git_op(repo, &["stash", "push", "-u", "-m", &msg]);
    log_git_op("stash", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_stash_pop(repo_path: String) -> Result<GitOpResult, String> {
    let repo = std::path::Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["stash", "pop"]);
    log_git_op("stash_pop", repo, &r);
    Ok(r)
}
```

> **Windows 주의**: `git_list_branches` 는 Windows 에 이미 있는지 확인.
> 없으면 Mac `git.rs:660-672` 포팅 (`git branch --format=%(refname:short)`).

### G1.2 Tauri 등록 (`lib.rs` invoke_handler)
```rust
commands::git_op_fetch,
commands::git_op_pull,
commands::git_op_push,
commands::git_op_stash,
commands::git_op_stash_pop,
```

### G1.3 UI wiring (`app.js`)
Mac 은 L2 detail 상단에 `GitOpsBar` (Fetch/Pull/Push/Stash/Stash Pop 버튼 +
inline 결과 strip). Windows L2(`renderGitL2Lanes`)에 동등한 버튼 행 추가:
- 각 버튼 → `invoke('git_op_<x>', { repoPath: <mac/win 로컬 repo path> })`
- 결과 `GitOpResult` → toast(ok ? stdout 요약 : stderr) + inline strip
  (`[방금] up to date` 형태, toast TTL 후에도 살아남게 — Mac T52 와 동일)
- repoPath 는 해당 호스트의 `repo.path` (Windows 자기 자신의 로컬 경로)

### G1.4 완료 기준
- [ ] 깨끗한 repo 에서 Fetch → "up to date" 결과 strip
- [ ] dirty repo 에서 Stash → Stash Pop 왕복
- [ ] push 거절(non-ff) 시 stderr 가 toast 로 표시 (hang 없이)

---

## G2. PAT cross-host sync (필수, 난이도 상)

직결망에서 한 호스트가 GitHub PAT 를 등록하면 **age 암호화로 다른 호스트에
안전하게 전달**하는 기능. Mac 만 구현돼 있어, Windows 에서 PAT 를 넣어도 Mac 에
공유되지 않는다 (반대도).

### 프로토콜 (이미 문서화됨)
- `mac_gui/share-manager/mockups/quality/PAT_SHARE_PROTOCOL.md` — wire 규약
- Mac 구현: `git.rs:734-920`
  - `git_publish_host_pubkey` — 내 ssh ed25519 공개키를
    `<share>/00_System/10_Config/host-keys/<host>.ssh.pub` 에 발행
  - `git_share_pat_to_peers` — 각 peer 의 공개키로 PAT 를 **age 암호화**해
    `<share>/00_System/10_Config/git-token/<peer>.age` 작성
  - `git_pull_pat_from_share` — 내 `<host>.age` 를 내 ssh 개인키로 복호화 →
    keyring 저장
  - helpers: `share_config_dir` / `host_keys_dir` / `git_token_share_dir` /
    `my_host_sanitized` / `my_ssh_pub_path` / `my_ssh_priv_path`

### Windows 적용
1. **crate 추가** (`Cargo.toml`): `age = { version = "0.10", features = ["ssh"] }`
   (keyring 은 이미 PAT 저장에 사용 중인지 확인 — Windows Credential Manager)
2. **ssh 키 경로**: Windows 는 `%USERPROFILE%\.ssh\id_ed25519(.pub)`.
   Mac `my_ssh_pub_path`/`my_ssh_priv_path` 를 Windows 경로로 치환.
3. **호스트명 sanitize**: `%COMPUTERNAME%` → `my_host_sanitized` 동등.
4. Mac `git.rs:734-920` 의 4 함수 + helper 를 `commands.rs` 로 포팅 (age 호출
   부분은 OS 무관 — 동일 crate).
5. **Tauri 등록**: `git_publish_host_pubkey` / `git_share_pat_to_peers` /
   `git_pull_pat_from_share`.
6. **앱 부트 시 자동 pull**: Mac `gitStore.tsx` 가 토큰 없을 때
   `pullPatFromShare` 자동 호출 (F-3-g). Windows `app.js` git 초기화에서
   동등 호출 추가 (토큰 없으면 `git_pull_pat_from_share` 시도).
7. **watcher git-token topic** (M-2-b): Windows watcher 가
   `<share>/00_System/10_Config/git-token/` 변경을 감시해 `git-token` 토픽을
   발행하도록 추가 (Mac `watcher.rs:27-35` 의 `git-token` 분류 대응). 그래야
   상대가 내 PAT 를 공유한 순간 자동 pull 트리거.

### 완료 기준
- [ ] host A 에서 PAT 등록 + "공개키 게시" + "PAT 공유" → 셰어에 `<B>.age` 생성
- [ ] host B 앱이 자동으로 복호화 → `git_has_token` true → GitHub fetch 동작
- [ ] B 의 ssh 개인키 없으면 복호화 실패(안전)

---

## G3. single-instance plugin (난이도 하)

Windows 에서 `mw.exe` 두 번째 실행 시 새 프로세스가 뜨거나 상태가 꼬일 수
있음 (Mac 은 `tauri_plugin_single_instance` 로 기존 창에 argv 전달).

### Windows 적용 (`lib.rs`)
```rust
.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
    // 두 번째 실행 → 기존 창 show + focus, argv 는 send 흐름에 전달
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    // (Windows send-to-mac argv 흐름이 있으면 여기서 dispatch)
}))
```
- `Cargo.toml`: `tauri-plugin-single-instance = "2"`
- **플러그인 등록은 builder 의 가장 첫 plugin 이어야 함** (Mac `lib.rs:33` 주석 참조)

### 완료 기준
- [ ] 앱 실행 중 다시 실행 → 새 창 안 뜨고 기존 창 포커스

---

## 식별자 ↔ Windows 위치 + 검증

| Mac 식별자 | Mac 위치 | Windows 적용 |
|---|---|---|
| F-7-a..h (git_op + run_git_op + log_op) | `git.rs:561-672` | `commands.rs` (G1) |
| F-3-a/c/d + helpers (PAT sync) | `git.rs:734-920` | `commands.rs` (G2) |
| F-3-g (auto pull) | `lib/gitStore.tsx` | `app.js` (G2.6) |
| M-2-b (git-token watch) | `watcher.rs:27-35` | `commands.rs` watcher (G2.7) |
| M-7-a (single-instance) | `lib.rs:33` | `lib.rs` (G3) |

검증: `cargo test` + 각 항목 완료 기준 체크리스트. 끝나면 `PARITY_MATRIX.md`
§3-B 의 해당 행을 ✅ 로 옮기고 Mac `IMPL_STATUS.md` cross-OS 동기화.

---

## TL;DR
- **G1** git_op 5개 = Mac `git.rs:561-672` 거의 복붙 + Tauri 등록 + L2 버튼 행
- **G2** PAT sync = age crate + Mac `git.rs:734-920` 포팅(ssh 경로만 Windows) +
  자동 pull + git-token watch. 프로토콜은 `PAT_SHARE_PROTOCOL.md`
- **G3** single-instance = 플러그인 1개 등록 (builder 첫 plugin)
