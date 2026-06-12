# MED M5 — github_fetch_check_runs (CI overlay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay each commit's GitHub Actions check-run status (✓/✗/⏳) on the git timeline. Mirrors Mac (`MAC_PARITY_HANDOFF_MED.md` M5 / F-6 / L-12). The PAT is already shared cross-host (G2), so the token is reused as-is.

**Architecture:** Port Mac's `CheckRunSummary` + the pure `classify_check_runs` + the `github_fetch_check_runs` command verbatim (reusing the existing Windows `gh_get` + `get_token`). The frontend, after the timeline renders, best-effort fetches check-runs for the visible commit SHAs and overlays a small colored badge on each commit dot via SVG DOM (degrades to bare dots on no-token / API error).

**Tech Stack:** Rust (Tauri command, `ureq` via existing `gh_get`), `#[cfg(test)]` unit test for the pure classifier, vanilla JS + SVG DOM.

## Wire contract (identical to Mac)
`CheckRunSummary { total, success, failure, in_progress, neutral, overall: "success"|"failure"|"pending"|"neutral"|"none"|"error", html_url: Option<String> }`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `windows_gui/share-manager/src-tauri/src/commands.rs` | `CheckRunSummary` + `classify_check_runs` (pure) + `github_fetch_check_runs` + test | modify |
| `windows_gui/share-manager/src-tauri/src/lib.rs` | register the command | modify |
| `windows_gui/share-manager/src/app.js` | overlay CI badges on commit dots | modify |
| `PARITY_MATRIX.md` | mark M5 done | modify |

Paths relative to repo root `D:\dev\Mac-Windows-P2P`. Confirmed in Windows `commands.rs`: `gh_get(token, url) -> Result<serde_json::Value, String>` (lines ~2015-2029) and `get_token() -> Option<String>` already exist; no `CheckRunSummary` exists; existing GH commands are `github_fetch_remote` (line ~2162) + `read_remote_cache`. In `lib.rs` the anchor is `commands::github_fetch_remote,`. In `app.js`, `renderGITimeline(ownerRepo)` (line ~2298) builds `pb.commits` (each `.sha`) and wires dots via `.gtl-river svg circle[data-sha]` (line ~2319).

---

### Task 1: CheckRunSummary + classify_check_runs (pure) + test (TDD)

**Files:**
- Modify: `windows_gui/share-manager/src-tauri/src/commands.rs`

- [ ] **Step 1: Write the failing test**

Append to the END of `src-tauri/src/commands.rs`:
```rust
#[cfg(test)]
mod check_run_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_is_none() {
        assert_eq!(classify_check_runs(&json!({"check_runs": []})).overall, "none");
        assert_eq!(classify_check_runs(&json!({})).overall, "none");
    }
    #[test]
    fn all_success() {
        let v = json!({"check_runs":[
            {"status":"completed","conclusion":"success","html_url":"u1"},
            {"status":"completed","conclusion":"success","html_url":"u2"}
        ]});
        let s = classify_check_runs(&v);
        assert_eq!(s.overall, "success");
        assert_eq!(s.success, 2);
        assert_eq!(s.total, 2);
        assert_eq!(s.html_url.as_deref(), Some("u1"));
    }
    #[test]
    fn failure_wins_over_success_and_pending() {
        let v = json!({"check_runs":[
            {"status":"completed","conclusion":"success"},
            {"status":"in_progress","conclusion":null},
            {"status":"completed","conclusion":"failure"}
        ]});
        let s = classify_check_runs(&v);
        assert_eq!(s.overall, "failure");
        assert_eq!(s.failure, 1);
        assert_eq!(s.in_progress, 1);
        assert_eq!(s.success, 1);
    }
    #[test]
    fn pending_when_in_progress_no_failure() {
        let v = json!({"check_runs":[
            {"status":"completed","conclusion":"success"},
            {"status":"queued","conclusion":null}
        ]});
        assert_eq!(classify_check_runs(&v).overall, "pending");
    }
    #[test]
    fn neutral_only() {
        let v = json!({"check_runs":[
            {"status":"completed","conclusion":"skipped"},
            {"status":"completed","conclusion":"neutral"}
        ]});
        let s = classify_check_runs(&v);
        assert_eq!(s.overall, "neutral");
        assert_eq!(s.neutral, 2);
    }
    #[test]
    fn timed_out_counts_as_failure() {
        let v = json!({"check_runs":[{"status":"completed","conclusion":"timed_out"}]});
        assert_eq!(classify_check_runs(&v).overall, "failure");
    }
}
```

- [ ] **Step 2: Verify it fails to compile**

Run (from `windows_gui/share-manager`): `cargo test --manifest-path src-tauri/Cargo.toml check_run_tests 2>&1 | tail -15`
Expected: compile error `cannot find function classify_check_runs`. Confirm, then proceed.

- [ ] **Step 3: Add the struct + pure classifier**

In `commands.rs`, find the existing line `fn gh_get(token: &str, url: &str) -> Result<serde_json::Value, String> {` and insert this block IMMEDIATELY ABOVE it:
```rust
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct CheckRunSummary {
    pub total: u32,
    pub success: u32,
    pub failure: u32,
    pub in_progress: u32,
    pub neutral: u32,
    /// Aggregated verdict: "success" / "failure" / "pending" / "neutral" / "none" / "error".
    pub overall: String,
    /// Click-through URL of the first run (GitHub Actions tab).
    pub html_url: Option<String>,
}

fn classify_check_runs(runs: &serde_json::Value) -> CheckRunSummary {
    let mut s = CheckRunSummary::default();
    let arr = match runs.get("check_runs").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => {
            s.overall = "none".into();
            return s;
        }
    };
    s.total = arr.len() as u32;
    if s.total == 0 {
        s.overall = "none".into();
        return s;
    }
    for r in arr {
        let status = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let conclusion = r.get("conclusion").and_then(|v| v.as_str()).unwrap_or("");
        if status != "completed" {
            s.in_progress += 1;
        } else {
            match conclusion {
                "success" => s.success += 1,
                "failure" | "timed_out" | "action_required" | "startup_failure" => s.failure += 1,
                "neutral" | "skipped" | "stale" | "cancelled" => s.neutral += 1,
                _ => s.neutral += 1,
            }
        }
        if s.html_url.is_none() {
            s.html_url = r.get("html_url").and_then(|v| v.as_str()).map(|s| s.to_string());
        }
    }
    s.overall = if s.failure > 0 {
        "failure".into()
    } else if s.in_progress > 0 {
        "pending".into()
    } else if s.success > 0 {
        "success".into()
    } else {
        "neutral".into()
    };
    s
}
```

- [ ] **Step 4: Verify the test passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml check_run_tests 2>&1 | tail -10`
Expected: `test result: ok. 6 passed; 0 failed`.

Note: `github_fetch_check_runs` (the command using these) is added in Task 2; a dead_code warning for `classify_check_runs`/`CheckRunSummary` is expected here only in non-test builds — add `#[allow(dead_code)]` above BOTH (the struct and the fn) to keep it warning-clean; Task 2 removes them when the command becomes a caller.

- [ ] **Step 5: Commit**
```
git add windows_gui/share-manager/src-tauri/src/commands.rs
git commit -m "windows git: CheckRunSummary + classify_check_runs (pure) + tests (M5 core)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: github_fetch_check_runs command + register

**Files:**
- Modify: `windows_gui/share-manager/src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Remove the temporary `#[allow(dead_code)]`**

Delete the `#[allow(dead_code)]` line above BOTH `pub struct CheckRunSummary` and `fn classify_check_runs` (they get a caller now).

- [ ] **Step 2: Add the command (insert immediately AFTER `classify_check_runs`'s closing brace)**
```rust
/// Fetch GitHub Actions check-run summaries for a batch of commit SHAs.
/// Sequential per SHA (no batch API); a single 404/403 yields overall="error"
/// for that sha without failing the batch. Reuses the cross-host PAT (G2).
#[tauri::command]
pub fn github_fetch_check_runs(
    owner_repo: String,
    shas: Vec<String>,
) -> Result<std::collections::HashMap<String, CheckRunSummary>, String> {
    let token = get_token().ok_or("등록된 토큰이 없습니다")?;
    let mut out = std::collections::HashMap::new();
    for sha in shas {
        if sha.is_empty() {
            continue;
        }
        let url = format!("https://api.github.com/repos/{owner_repo}/commits/{sha}/check-runs?per_page=20");
        match gh_get(&token, &url) {
            Ok(v) => {
                out.insert(sha, classify_check_runs(&v));
            }
            Err(_) => {
                let mut s = CheckRunSummary::default();
                s.overall = "error".into();
                out.insert(sha, s);
            }
        }
    }
    Ok(out)
}
```

- [ ] **Step 3: Register in lib.rs**

In `src-tauri/src/lib.rs`, find this exact line:
```rust
            commands::github_fetch_remote,
```
Insert immediately AFTER it:
```rust
            commands::github_fetch_check_runs,
```

- [ ] **Step 4: Build + tests**
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -12
```
Expected: `Finished`, no errors, no dead_code warning for `CheckRunSummary`/`classify_check_runs`/`github_fetch_check_runs`.
```
cargo test --manifest-path src-tauri/Cargo.toml check_run_tests 2>&1 | tail -6
```
Expected: `6 passed`.

- [ ] **Step 5: Commit**
```
git add windows_gui/share-manager/src-tauri/src/commands.rs windows_gui/share-manager/src-tauri/src/lib.rs
git commit -m "windows git: github_fetch_check_runs command + register (M5)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 3: frontend — CI badges on commit dots

**Files:**
- Modify: `windows_gui/share-manager/src/app.js`

- [ ] **Step 1: Add the overlay helper**

In `src/app.js`, find this exact line (the start of the timeline renderer):
```js
async function renderGITimeline(ownerRepo) {
```
Insert this helper IMMEDIATELY ABOVE it:
```js
// Best-effort: overlay a small CI status badge on each commit dot using the
// shared PAT. No token / API error → bare dots (no throw). M5 / F-6.
async function overlayCheckRuns(ownerRepo, commits) {
  const shas = (commits || []).map(c => c.sha).filter(Boolean);
  if (!shas.length) return;
  let runs;
  try {
    runs = await invoke('github_fetch_check_runs', { ownerRepo, shas });
  } catch (_) {
    return;
  }
  const CI_COLOR = {
    success: '#2DA44E', failure: '#D11A2A', pending: '#D4A72C', neutral: '#8A8E97', error: '#8A8E97',
  };
  const NS = 'http://www.w3.org/2000/svg';
  $gitInspectorBody.querySelectorAll('.gtl-river svg circle[data-sha]').forEach(el => {
    const sha = el.getAttribute('data-sha');
    const s = runs[sha];
    if (!s || !s.overall || s.overall === 'none') return;
    const color = CI_COLOR[s.overall];
    if (!color) return;
    const svg = el.ownerSVGElement;
    if (!svg) return;
    const cx = parseFloat(el.getAttribute('cx'));
    const cy = parseFloat(el.getAttribute('cy'));
    const r = parseFloat(el.getAttribute('r'));
    const badge = document.createElementNS(NS, 'circle');
    badge.setAttribute('cx', cx + r);
    badge.setAttribute('cy', cy - r);
    badge.setAttribute('r', '3');
    badge.setAttribute('fill', color);
    badge.setAttribute('stroke', '#FFFFFF');
    badge.setAttribute('stroke-width', '1.5');
    badge.setAttribute('pointer-events', 'none');
    const title = document.createElementNS(NS, 'title');
    title.textContent = `CI: ${s.overall} (✓${s.success} ✗${s.failure} ⏳${s.in_progress})`;
    badge.appendChild(title);
    svg.appendChild(badge);
  });
}

async function renderGITimeline(ownerRepo) {
```

- [ ] **Step 2: Call the overlay after the dots are wired**

Find this exact block (the end of the dot-click wiring inside `renderGITimeline`):
```js
    $gitInspectorBody.querySelectorAll('.gtl-river svg circle[data-sha]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const sha = el.getAttribute('data-sha');
        const c = (pb.commits || []).find(x => x.sha === sha);
        if (c) updateTimelineDetail(c, graph);
      });
    });
```
Replace with (append the best-effort overlay call):
```js
    $gitInspectorBody.querySelectorAll('.gtl-river svg circle[data-sha]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const sha = el.getAttribute('data-sha');
        const c = (pb.commits || []).find(x => x.sha === sha);
        if (c) updateTimelineDetail(c, graph);
      });
    });

    // M5: overlay CI check-run badges (best-effort; needs PAT).
    overlayCheckRuns(ownerRepo, pb.commits).catch(() => {});
```

- [ ] **Step 3: Verify JS parses**
```
node --check windows_gui/share-manager/src/app.js && echo "JS OK"
```
Expected: `JS OK`.

- [ ] **Step 4: Commit**
```
git add windows_gui/share-manager/src/app.js
git commit -m "windows git: CI check-run badges on timeline dots (M5)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 4: build + manual + parity closeout

**Files:**
- Modify: `PARITY_MATRIX.md`

- [ ] **Step 1: Full release build**
```
cargo tauri build 2>&1 | tail -8
```
Expected: `Finished N bundles`.

- [ ] **Step 2: Manual check (record result)**

With a PAT registered and a repo whose recent commits have GitHub Actions: open Git L3 inspector timeline → commit dots show a small colored badge (green success / red failure / amber pending / grey neutral) matching the actual Actions result; commits with no CI / 404 show a bare dot (no badge, no error). The 6 unit tests already prove the `classify_check_runs` verdict logic. Human/agent gate — fix before Step 3 on failure.

- [ ] **Step 3: Update the parity matrix**

In `PARITY_MATRIX.md` §3-B, change:
```
| GitHub check-runs (CI overlay) | F-6 | MED | Windows 미구현 |
```
to:
```
| GitHub check-runs (CI overlay) | F-6 | ✅ **완료** | github_fetch_check_runs + 타임라인 dot 배지 (M5) |
```
And in §4 "**Windows ← Mac (MED)**", change:
```
5. github_fetch_check_runs — F-6 · M5
```
to:
```
5. ~~github_fetch_check_runs — F-6 · M5~~ ✅ 완료
```

- [ ] **Step 4: Commit**
```
git add PARITY_MATRIX.md
git commit -m "parity: M5 github_fetch_check_runs done on Windows"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-Review

- **Spec coverage:** struct + pure classifier + test → Task 1; command + register → Task 2; frontend badges → Task 3; build/manual/closeout → Task 4. `classify_check_runs` logic (failure>pending>success>neutral, timed_out→failure, empty→none) matches Mac `git.rs` verbatim and is unit-tested.
- **Type consistency:** `CheckRunSummary` fields match Mac; `github_fetch_check_runs(owner_repo, shas) -> HashMap<String, CheckRunSummary>`; JS calls `invoke('github_fetch_check_runs', { ownerRepo, shas })` (Tauri camelCase) and reads `s.overall`/`s.success`/`s.failure`/`s.in_progress`.
- **Reuse:** existing `gh_get` + `get_token` (no duplication). Sequential per-sha matches Mac (no rayon needed). Frontend overlay is best-effort and degrades to bare dots — never blocks the timeline render.
- **No placeholders:** every step has full code + exact commands + expected output.

## Done when
- [ ] `cargo test ... check_run_tests` → 6 passed
- [ ] `cargo build` clean (no dead_code for the new items); release build OK
- [ ] `node --check src/app.js` → JS OK
- [ ] Manual: dots show CI-colored badges matching Actions; no-CI commits bare
- [ ] `PARITY_MATRIX.md` shows M5 ✅
