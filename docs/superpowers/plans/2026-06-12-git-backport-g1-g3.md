# Git Backport G1 (interactive ops) + G3 (single-instance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interactive git operations (fetch/pull/push/stash/stash-pop) to the Windows app with a button row in the git L2 detail view, and add the single-instance plugin so a second launch focuses the existing window — mirroring Mac (`MAC_PARITY_HANDOFF_GIT.md` G1 + G3).

**Architecture:** A new richer git runner `run_git_op` (captures stdout/stderr/exit, unlike the existing `run_git` which returns `Option<String>`) backs five thin `#[tauri::command]` wrappers, logged via the existing `append_log`. The frontend adds an ops button row in `renderGitL2Lanes`' footer, calling the commands on the local Windows repo path and showing an inline result strip. G3 registers `tauri-plugin-single-instance` as the first plugin with a focus-existing-window callback.

**Tech Stack:** Rust (Tauri v2, `std::process::Command`), Pester-free Rust `#[cfg(test)]` tests, vanilla JS frontend. `git` is assumed on PATH (the existing scan already shells out to git).

**Scope note:** G2 (PAT cross-host sync via `age`+ssh) is intentionally NOT in this plan — it's large and needs its own plan after studying Mac `git.rs:734-920` + `PAT_SHARE_PROTOCOL.md`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `windows_gui/share-manager/src-tauri/src/commands.rs` | `GitOpResult` struct, `run_git_op`, `log_git_op`, 5 `git_op_*` commands, `#[cfg(test)]` tests | modify (append) |
| `windows_gui/share-manager/src-tauri/src/lib.rs` | register 5 commands; register single-instance plugin first | modify |
| `windows_gui/share-manager/src-tauri/Cargo.toml` | add `tauri-plugin-single-instance` | modify |
| `windows_gui/share-manager/src/app.js` | git-op button row + wiring in `renderGitL2Lanes` | modify (~line 1914 + ~1940) |
| `windows_gui/share-manager/src/style.css` | `.git-l2-ops` / `.git-l2-opresult` styles | modify (append) |
| `PARITY_MATRIX.md` | mark G1/G3 resolved | modify |

All paths relative to repo root `D:\dev\Mac-Windows-P2P`. Rust commands run from `windows_gui/share-manager` (where `src-tauri/Cargo.toml` is reachable via `cargo`). Existing facts confirmed in the codebase: `run_git` + `hide_console` + `append_log` (categories `send`/`error` allowed) exist in `commands.rs`; `Path` and `Command` are already imported there; the main window label is `"main"`; the invoke_handler list and plugin chain live in `lib.rs`; `toast(msg, kind)` and `const { invoke }` exist in `app.js`; the L2 footer is at `app.js:1908-1919` and `gitRepoPathForHost(ownerRepo, os)` exists at `app.js:2136`.

---

### Task 1: G1 git runner + logging + tests (TDD)

**Files:**
- Modify: `windows_gui/share-manager/src-tauri/src/commands.rs` (append the helpers + a `#[cfg(test)]` module at end of file)

- [ ] **Step 1: Write the failing test module**

Append to the END of `windows_gui/share-manager/src-tauri/src/commands.rs`:

```rust
#[cfg(test)]
mod gitop_tests {
    use super::*;
    use std::process::Command;

    fn temp_repo() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("mw-gitop-{}-{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            Command::new("git").arg("-C").arg(&dir).args(args).output().unwrap();
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t.t"]);
        run(&["config", "user.name", "t"]);
        run(&["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "init"]);
        dir
    }

    #[test]
    fn run_git_op_ok_on_valid_repo() {
        let dir = temp_repo();
        let r = run_git_op(&dir, &["rev-parse", "--is-inside-work-tree"]);
        assert!(r.ok);
        assert_eq!(r.stdout, "true");
        assert_eq!(r.exit_code, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_git_op_fail_captures_stderr() {
        let dir = std::env::temp_dir().join(format!("mw-gitop-nope-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap(); // exists but is NOT a git repo
        let r = run_git_op(&dir, &["status"]);
        assert!(!r.ok);
        assert!(!r.stderr.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stash_roundtrip() {
        let dir = temp_repo();
        std::fs::write(dir.join("a.txt"), "changed").unwrap();
        assert!(!run_git_op(&dir, &["status", "--porcelain"]).stdout.is_empty(), "expected dirty");
        let s = run_git_op(&dir, &["stash", "push", "-u", "-m", "test"]);
        assert!(s.ok, "stash push failed: {}", s.stderr);
        assert!(run_git_op(&dir, &["status", "--porcelain"]).stdout.is_empty(), "expected clean after stash");
        let p = run_git_op(&dir, &["stash", "pop"]);
        assert!(p.ok, "stash pop failed: {}", p.stderr);
        assert!(!run_git_op(&dir, &["status", "--porcelain"]).stdout.is_empty(), "expected dirty after pop");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail to COMPILE**

Run (from `windows_gui/share-manager`):
```
cargo test --manifest-path src-tauri/Cargo.toml gitop_tests 2>&1 | tail -20
```
Expected: compile error — `cannot find function run_git_op in this scope` (and `GitOpResult` unused). This confirms the test targets code that doesn't exist yet.

- [ ] **Step 3: Add the runner + logging helpers**

In `windows_gui/share-manager/src-tauri/src/commands.rs`, find the existing `run_git` function:
```rust
fn run_git(repo: &Path, args: &[&str]) -> Option<String> {
```
Insert the following block IMMEDIATELY ABOVE that `fn run_git` line:

```rust
/// Richer git runner than `run_git`: captures stdout+stderr+exit code for
/// interactive ops surfaced to the user. Mirrors Mac `git.rs` run_git_op (F-7).
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct GitOpResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn run_git_op(repo: &Path, args: &[&str]) -> GitOpResult {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    hide_console(&mut cmd);
    match cmd.output() {
        Ok(o) => GitOpResult {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).trim().to_string(),
            exit_code: o.status.code(),
        },
        Err(e) => GitOpResult {
            ok: false,
            stdout: String::new(),
            stderr: format!("git exec failed: {e}"),
            exit_code: None,
        },
    }
}

/// Append a git-op outcome to the local jsonl log (reuses existing `append_log`;
/// "send" on success / "error" on failure — both are allowed categories).
fn log_git_op(op: &str, repo: &Path, r: &GitOpResult) {
    let category = if r.ok { "send" } else { "error" };
    append_log(
        category,
        serde_json::json!({
            "event": if r.ok { format!("git_{op}_ok") } else { format!("git_{op}_fail") },
            "op": op,
            "repo": repo.to_string_lossy(),
            "stderr": r.stderr.lines().take(3).collect::<Vec<_>>().join("\n"),
            "exit": r.exit_code,
        }),
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `windows_gui/share-manager`):
```
cargo test --manifest-path src-tauri/Cargo.toml gitop_tests 2>&1 | tail -20
```
Expected: `test result: ok. 3 passed; 0 failed` (the three `gitop_tests::*`).

- [ ] **Step 5: Commit**

```
git add windows_gui/share-manager/src-tauri/src/commands.rs
git commit -m "windows git: run_git_op runner + log_git_op + cargo tests (G1 core)"
```
End the commit message with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: G1 commands + Tauri registration

**Files:**
- Modify: `windows_gui/share-manager/src-tauri/src/commands.rs` (add 5 commands)
- Modify: `windows_gui/share-manager/src-tauri/src/lib.rs` (register them)

- [ ] **Step 1: Add the five `#[tauri::command]` wrappers**

In `commands.rs`, insert these immediately AFTER the `log_git_op` function you added in Task 1:

```rust
#[tauri::command]
pub fn git_op_fetch(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["fetch", "--all", "--prune"]);
    log_git_op("fetch", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_pull(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    // --ff-only: never start a merge on divergence; surface a clear error instead.
    let r = run_git_op(repo, &["pull", "--ff-only"]);
    log_git_op("pull", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_push(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["push"]);
    log_git_op("push", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_stash(repo_path: String, message: Option<String>) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let msg = message.unwrap_or_else(|| "share-manager auto stash".to_string());
    let r = run_git_op(repo, &["stash", "push", "-u", "-m", &msg]);
    log_git_op("stash", repo, &r);
    Ok(r)
}

#[tauri::command]
pub fn git_op_stash_pop(repo_path: String) -> Result<GitOpResult, String> {
    let repo = Path::new(&repo_path);
    if !repo.join(".git").exists() { return Err("레포 경로가 유효하지 않음".into()); }
    let r = run_git_op(repo, &["stash", "pop"]);
    log_git_op("stash_pop", repo, &r);
    Ok(r)
}
```

- [ ] **Step 2: Register the commands in the invoke handler**

In `windows_gui/share-manager/src-tauri/src/lib.rs`, find this exact line in the `tauri::generate_handler![ ... ]` list:
```rust
            commands::git_list_branches,
```
Insert these five lines immediately AFTER it:
```rust
            commands::git_op_fetch,
            commands::git_op_pull,
            commands::git_op_push,
            commands::git_op_stash,
            commands::git_op_stash_pop,
```

- [ ] **Step 2b: Run the test to verify it fails first if you skipped registration**

(No separate failing test — the verification is the compile. Proceed.)

- [ ] **Step 3: Build to verify it compiles and all tests still pass**

Run (from `windows_gui/share-manager`):
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -15
```
Expected: `Finished` with no errors (warnings about pre-existing dead code are fine).

Then:
```
cargo test --manifest-path src-tauri/Cargo.toml gitop_tests 2>&1 | tail -8
```
Expected: `test result: ok. 3 passed`.

- [ ] **Step 4: Commit**

```
git add windows_gui/share-manager/src-tauri/src/commands.rs windows_gui/share-manager/src-tauri/src/lib.rs
git commit -m "windows git: git_op_* commands (fetch/pull/push/stash/stash_pop) + register (G1)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 3: G1 frontend — ops button row in L2

**Files:**
- Modify: `windows_gui/share-manager/src/app.js` (`renderGitL2Lanes`, ~line 1914 + ~1940)
- Modify: `windows_gui/share-manager/src/style.css` (append)

- [ ] **Step 1: Add the ops button row to the L2 footer**

In `windows_gui/share-manager/src/app.js`, find this exact block (inside `renderGitL2Lanes`):
```js
      <div class="git-l2-footer-actions">
        <button class="git-l2-btn" id="git-l2-all-commits" type="button">전체 커밋 보기</button>
        <button class="git-l2-btn" id="git-l2-dag-toggle" type="button">DAG 보기</button>
        <button class="git-l2-btn primary" id="git-l2-sync" type="button">Sync 실행</button>
      </div>
```
Replace it with (adds a second row of git-op buttons + a result strip):
```js
      <div class="git-l2-footer-actions">
        <button class="git-l2-btn" id="git-l2-all-commits" type="button">전체 커밋 보기</button>
        <button class="git-l2-btn" id="git-l2-dag-toggle" type="button">DAG 보기</button>
        <button class="git-l2-btn primary" id="git-l2-sync" type="button">Sync 실행</button>
      </div>
      <div class="git-l2-ops" id="git-l2-ops">
        <button class="git-l2-btn" data-op="fetch" type="button">Fetch</button>
        <button class="git-l2-btn" data-op="pull" type="button">Pull</button>
        <button class="git-l2-btn" data-op="push" type="button">Push</button>
        <button class="git-l2-btn" data-op="stash" type="button">Stash</button>
        <button class="git-l2-btn" data-op="stash_pop" type="button">Stash Pop</button>
        <span class="git-l2-opresult" id="git-l2-opresult"></span>
      </div>
```

- [ ] **Step 2: Wire the ops buttons**

In the same function, find this exact block (the existing sync handler, near the end of `renderGitL2Lanes`):
```js
  if (syncBtn) syncBtn.addEventListener('click', () => {
    toast('Sync 자동 실행은 Stage 4 (직결 트리거)에서 추가됩니다 — 우선 터미널에서 push/pull 권장', 'info');
  });
}
```
Replace it with:
```js
  if (syncBtn) syncBtn.addEventListener('click', () => {
    toast('Sync 자동 실행은 Stage 4 (직결 트리거)에서 추가됩니다 — 우선 아래 Fetch/Pull/Push 사용', 'info');
  });

  // G1: interactive git ops on the local (Windows) repo for this owner/repo.
  const winRepoPath = (winHost && winHost.repo && winHost.repo.path)
    ? winHost.repo.path
    : gitRepoPathForHost(ownerRepo, 'windows');
  const opResult = $gitDetailBody.querySelector('#git-l2-opresult');
  const opCmd = {
    fetch: 'git_op_fetch', pull: 'git_op_pull', push: 'git_op_push',
    stash: 'git_op_stash', stash_pop: 'git_op_stash_pop',
  };
  $gitDetailBody.querySelectorAll('.git-l2-ops [data-op]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!winRepoPath) { toast('Windows 로컬 레포 경로를 찾을 수 없어요', 'error'); return; }
      const op = btn.dataset.op;
      btn.disabled = true;
      try {
        const r = await invoke(opCmd[op], { repoPath: winRepoPath });
        const raw = r.ok ? (r.stdout || '완료') : (r.stderr || '실패');
        const summary = raw.split('\n')[0].slice(0, 120);
        if (opResult) opResult.textContent = `[방금] ${op}: ${summary}`;
        toast(`${op} ${r.ok ? '성공' : '실패'}: ${summary}`, r.ok ? 'success' : 'error');
      } catch (e) {
        if (opResult) opResult.textContent = `[방금] ${op}: ${e}`;
        toast(`${op} 오류: ${e}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}
```

- [ ] **Step 3: Append the CSS**

Append to the END of `windows_gui/share-manager/src/style.css`:
```css
/* ─── Git L2 interactive ops row (G1) ─────────────────────────── */
.git-l2-ops {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.git-l2-opresult {
  margin-left: 6px;
  font-size: 11px;
  color: var(--text-sec);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
.git-l2-ops .git-l2-btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 4: Verify JS parses**

Run (from `windows_gui/share-manager`):
```
node --check src/app.js && echo "JS OK"
```
Expected: `JS OK`.

- [ ] **Step 5: Commit**

```
git add windows_gui/share-manager/src/app.js windows_gui/share-manager/src/style.css
git commit -m "windows git: L2 interactive ops button row (Fetch/Pull/Push/Stash) + result strip (G1)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 4: G3 single-instance plugin

**Files:**
- Modify: `windows_gui/share-manager/src-tauri/Cargo.toml`
- Modify: `windows_gui/share-manager/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the dependency**

In `windows_gui/share-manager/src-tauri/Cargo.toml`, find this line in `[dependencies]`:
```toml
tauri-plugin-clipboard-manager = "2"
```
Insert immediately AFTER it:
```toml
tauri-plugin-single-instance = "2"
```

- [ ] **Step 2: Register the plugin FIRST (before all other plugins)**

> NOTE: the lib.rs plugin chain now starts with the autostart plugin (added by the
> clipboard tray/autostart change). single-instance must come BEFORE autostart so it
> is the very first plugin. `use tauri::Manager;` is already imported at the top of
> `run()` (by the tray change), so the closure needs no local `use`.

In `windows_gui/share-manager/src-tauri/src/lib.rs`, find this exact block:
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
```
Replace it with (single-instance inserted as the first plugin, before autostart):
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch → focus the existing (possibly tray-hidden) window
            // instead of spawning another instance.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
```

- [ ] **Step 3: Build to verify it compiles**

Run (from `windows_gui/share-manager`):
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -15
```
Expected: `Finished` (the new crate downloads + compiles; no errors). If the crate version `"2"` fails to resolve, run `cargo update -p tauri-plugin-single-instance` and retry; report the resolved version.

- [ ] **Step 4: Commit**

```
git add windows_gui/share-manager/src-tauri/Cargo.toml windows_gui/share-manager/src-tauri/src/lib.rs windows_gui/share-manager/src-tauri/Cargo.lock
git commit -m "windows: single-instance plugin — second launch focuses existing window (G3)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 5: Manual smoke + parity closeout

**Files:**
- Modify: `PARITY_MATRIX.md`

- [ ] **Step 1: Full release build**

Run (from `windows_gui/share-manager`) — this is the real app build used for deployment:
```
cargo tauri build 2>&1 | tail -8
```
Expected: `Finished N bundles` with the `share-manager.exe` + msi/nsis paths. (If `cargo tauri` is unavailable, `cargo build --release --manifest-path src-tauri/Cargo.toml` produces the exe.)

- [ ] **Step 2: Manual verification (record results in the commit/PR notes)**

Launch `windows_gui/share-manager/src-tauri/target/release/share-manager.exe`, then:
- **G3:** launch the exe a SECOND time → no new window appears; the existing window comes to front. PASS/FAIL.
- **G1:** open a repo's git L2 detail → the Fetch/Pull/Push/Stash/Stash Pop row appears under the footer actions. Click **Fetch** on a clean repo → toast + `[방금] fetch: ...` strip (success). Click **Stash** then **Stash Pop** on a dirty repo → both succeed. Trigger a **Push** that will be rejected (e.g. behind remote) → error toast with stderr, app does not hang. PASS/FAIL.

This step has no automated assertion; it is a human/agent gate. If any check fails, STOP and fix before Step 3.

- [ ] **Step 3: Update the parity matrix**

In `PARITY_MATRIX.md` §3-B ("Mac 앞섬 → Windows backport 필요") table, for the row:
```
| interactive git ops (fetch/pull/push/stash/stash_pop) | F-7 | **HIGH** | Windows commands.rs 에 5개 명령 없음 |
```
change the last cell to:
```
| interactive git ops (fetch/pull/push/stash/stash_pop) | F-7 | ✅ **완료** | git_op_* 5개 + L2 ops 버튼 행 (G1) |
```
And for the row:
```
| single-instance plugin | M-7-a | MED | Windows 두번째 실행 처리 부재 |
```
change to:
```
| single-instance plugin | M-7-a | ✅ **완료** | tauri-plugin-single-instance 첫 plugin 등록 (G3) |
```
Also in §4 "**Windows ← Mac (HIGH)**" backlog, update items 1 and 3:
```
1. ~~`git_op_*` 5개 (interactive git) — F-7 · G1~~ ✅ 완료
```
```
3. ~~single-instance plugin — M-7-a · G3~~ ✅ 완료
```
(Leave item 2, PAT sync · G2, as-is — that's the next plan.)

- [ ] **Step 4: Commit**

```
git add PARITY_MATRIX.md
git commit -m "parity: G1 interactive git ops + G3 single-instance done on Windows"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-Review

- **Spec coverage:** G1 runner+logging → Task 1; G1 commands+registration → Task 2; G1 UI → Task 3; G3 plugin → Task 4; build/manual/closeout → Task 5. The handoff's G1.1/G1.2/G1.3 and G3 sections are all covered. `git_list_branches` already exists (handoff's "확인" note), so it is not re-added.
- **Type consistency:** `GitOpResult { ok, stdout, stderr, exit_code }` defined in Task 1; the 5 commands return `Result<GitOpResult, String>` (Task 2); the frontend reads `r.ok`/`r.stdout`/`r.stderr` (Task 3). Command names `git_op_fetch/pull/push/stash/stash_pop` match between commands.rs, lib.rs, and the JS `opCmd` map. Tauri converts `repo_path` → `repoPath` (confirmed by existing `github_fetch_remote`'s `ownerRepos`).
- **Pattern fidelity:** `run_git_op` uses `hide_console` like the existing `run_git` (avoids a console flash on Windows). `log_git_op` uses `append_log` with allowed categories `send`/`error`. Single-instance is registered as the FIRST plugin per the handoff + Tauri requirement; window label `"main"` confirmed.
- **No placeholders:** every step has full code + exact commands + expected output.

## Done when
- [ ] `cargo test ... gitop_tests` → 3 passed
- [ ] `cargo build` clean; release build produces `share-manager.exe`
- [ ] `node --check src/app.js` → JS OK
- [ ] Manual: second launch focuses existing window (G3); L2 ops buttons fetch/stash/pop work, push-reject surfaces stderr without hanging (G1)
- [ ] `PARITY_MATRIX.md` shows G1 + G3 ✅
