# MED M3 — send_path_force (overwrite send) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow re-sending a file whose target already exists by overwriting it — a `send_path_force` command that passes `-Force` to the sender script, plus a frontend "already exists → overwrite?" retry. Mirrors Mac (`MAC_PARITY_HANDOFF_MED.md` M3 / D-8-b).

**Architecture:** Windows `send_path` shells out to `send-to-mac.ps1`, which currently refuses an existing target with `exit 20` in non-interactive (`-NoGui`) mode. We add a `-Force` switch to the script that skips the refusal and overwrites, a thin `send_path_force` command that invokes the script with `-Force`, and a shared frontend `sendOne` helper that catches the "Target already exists" error and retries with force after a confirm.

**Tech Stack:** PowerShell (`send-to-mac.ps1`), Rust (Tauri command shelling to pwsh), vanilla JS.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `windows_gui/send-to-mac.ps1` | accept `-Force`, skip the exit-20 refusal | modify (param block + exists-handling) |
| `windows_gui/share-manager/src-tauri/src/commands.rs` | `send_path_force` command | modify (add after `send_path`) |
| `windows_gui/share-manager/src-tauri/src/lib.rs` | register `send_path_force` | modify |
| `windows_gui/share-manager/src/app.js` | `sendOne` helper (force-retry on exists) + use in both send loops | modify |
| `PARITY_MATRIX.md` | mark M3 done | modify |

Paths relative to repo root `D:\dev\Mac-Windows-P2P`. Confirmed: `send_path` (commands.rs:330-378) shells to `send-to-mac.ps1` with args `<source> -Category <cat> -NoGui` and returns a `transfer_id`; on existing target the script does `exit 20` → `send_path` returns `Err("send failed (exit Some(20)): Target already exists: ...")`. The PS1 param block is at lines 5-12 (no `-Force`); the exists-handling is at lines 152-165. Both JS send loops (`sendBatch` ~3211, `submitDrop` ~3277) call the identical line `await invoke('send_path', { sourcePath: p, category });`.

---

### Task 1: `-Force` switch in send-to-mac.ps1

**Files:**
- Modify: `windows_gui/send-to-mac.ps1`

- [ ] **Step 1: Add the `-Force` param**

In `windows_gui/send-to-mac.ps1`, find this exact param block:
```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $SourcePath,
    [Parameter(Position = 1)]
    [string] $Category,
    [switch] $NoGui
)
```
Replace with:
```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $SourcePath,
    [Parameter(Position = 1)]
    [string] $Category,
    [switch] $NoGui,
    [switch] $Force
)
```

- [ ] **Step 2: Honor `-Force` in the exists-handling**

Find this exact block:
```powershell
if (Test-Path -LiteralPath $dstPath) {
    if ($useGui) {
        $confirm = [System.Windows.MessageBox]::Show(
            "Target already exists:`n$newName`n`nOverwrite?", 'Send to Mac', 'YesNo', 'Question')
        if ($confirm -ne 'Yes') { Dbg "user declined overwrite"; exit 0 }
    } else {
        [Console]::Error.WriteLine("Target already exists: $dstPath (remove first or rename)")
        exit 20
    }
    if ($isDir) {
        Dbg "removing existing destination directory"
        Remove-Item -LiteralPath $dstPath -Recurse -Force
    }
}
```
Replace with:
```powershell
if (Test-Path -LiteralPath $dstPath) {
    if ($Force) {
        Dbg "force overwrite (-Force)"
    } elseif ($useGui) {
        $confirm = [System.Windows.MessageBox]::Show(
            "Target already exists:`n$newName`n`nOverwrite?", 'Send to Mac', 'YesNo', 'Question')
        if ($confirm -ne 'Yes') { Dbg "user declined overwrite"; exit 0 }
    } else {
        [Console]::Error.WriteLine("Target already exists: $dstPath (remove first or rename)")
        exit 20
    }
    if ($isDir) {
        Dbg "removing existing destination directory"
        Remove-Item -LiteralPath $dstPath -Recurse -Force
    }
}
```
(For a file, the later `Copy-Item ... -Force` overwrites; for a directory, the `Remove-Item` above clears it first. `-Force` only skips the refusal gate.)

- [ ] **Step 3: Verify the script still parses**

Run (from repo root):
```
pwsh -NoProfile -Command "$errs=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path './windows_gui/send-to-mac.ps1').Path,[ref]$null,[ref]$errs); if($errs){$errs|%{$_.Message};exit 1}else{'PARSE OK'}"
```
Expected: `PARSE OK`.

- [ ] **Step 4: Verify `-Force` overwrites where bare send refuses (temp-share integration test)**

Run (from repo root) — one command:
```
pwsh -NoProfile -Command @'
$ErrorActionPreference = "Stop"
$script = (Resolve-Path ./windows_gui/send-to-mac.ps1).Path
$share = Join-Path $env:TEMP ("mw-force-test-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path $share | Out-Null
$src = Join-Path $env:TEMP ("mw-force-src-" + [guid]::NewGuid().ToString("N").Substring(0,8) + ".txt")
"hello" | Set-Content -LiteralPath $src -Encoding UTF8
$env:MW_SHARE_ROOT = $share
# 1st send → ok (exit 0)
& pwsh -NoProfile -File $script $src "documents" -NoGui *> $null; $a = $LASTEXITCODE
# 2nd send (same name exists) → refused exit 20
& pwsh -NoProfile -File $script $src "documents" -NoGui *> $null; $b = $LASTEXITCODE
# 3rd send with -Force → overwrites, exit 0
& pwsh -NoProfile -File $script $src "documents" -NoGui -Force *> $null; $c = $LASTEXITCODE
Remove-Item -LiteralPath $share -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
Remove-Item Env:\MW_SHARE_ROOT -ErrorAction SilentlyContinue
"1st=$a (want 0)  2nd=$b (want 20)  3rd-force=$c (want 0)"
if ($a -eq 0 -and $b -eq 20 -and $c -eq 0) { "PASS"; exit 0 } else { "FAIL"; exit 1 }
'@
```
Expected: `1st=0 (want 0)  2nd=20 (want 20)  3rd-force=0 (want 0)` then `PASS`.

- [ ] **Step 5: Commit**
```
git add windows_gui/send-to-mac.ps1
git commit -m "windows: send-to-mac.ps1 -Force switch (overwrite existing target) (M3)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: `send_path_force` command + registration

**Files:**
- Modify: `windows_gui/share-manager/src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command**

In `commands.rs`, find the end of `send_path` (the function returning `Ok(tid)` after the `append_log("send", ...)` for `send_ok`). Insert the following immediately AFTER `send_path`'s closing brace:

```rust
#[tauri::command]
pub fn send_path_force(source_path: String, category: String) -> Result<String, String> {
    // Same as send_path but passes -Force to the sender so an existing
    // target is overwritten instead of refused (M3 / D-8-b).
    if crate::share::category_by_key(&category).is_none() {
        return Err(format!("unknown category: {category}"));
    }
    if !Path::new(&source_path).exists() {
        return Err(format!("source missing: {source_path}"));
    }
    let here = current_script_root();
    let send_ps1 = here.join("send-to-mac.ps1");
    if !send_ps1.exists() {
        return Err(format!("send-to-mac.ps1 not found at {}", send_ps1.display()));
    }
    let pwsh = locate_pwsh();
    let mut cmd = Command::new(pwsh);
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", send_ps1.to_string_lossy().as_ref(),
        &source_path,
        "-Category", &category,
        "-NoGui",
        "-Force",
    ]);
    hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| format!("failed to launch pwsh: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        append_log("error", serde_json::json!({
            "event": "send_fail", "source": source_path, "category": category,
            "exit": out.status.code(), "stderr": stderr.trim(), "forced": true,
        }));
        return Err(format!("send failed (exit {:?}): {}\n{}", out.status.code(), stderr, stdout));
    }
    let tid = stdout
        .lines()
        .find_map(|l| l.strip_prefix("transfer_id: ").map(|r| r.trim().to_string()))
        .unwrap_or_else(|| stdout.trim().to_string());
    append_log("send", serde_json::json!({
        "event": "send_ok", "source": source_path, "category": category, "transfer_id": tid, "forced": true,
    }));
    Ok(tid)
}
```

> If the helpers `current_script_root` / `locate_pwsh` / `hide_console` / `crate::share::category_by_key` are named differently, match what `send_path` actually calls (read `send_path` directly above this insertion point and mirror it exactly — only the added `-Force` arg and the `"forced": true` log fields differ).

- [ ] **Step 2: Register in lib.rs**

In `src-tauri/src/lib.rs`, find this exact line:
```rust
            commands::send_path,
```
Insert immediately AFTER it:
```rust
            commands::send_path_force,
```

- [ ] **Step 3: Build**
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -12
```
Expected: `Finished`, no errors.

- [ ] **Step 4: Commit**
```
git add windows_gui/share-manager/src-tauri/src/commands.rs windows_gui/share-manager/src-tauri/src/lib.rs
git commit -m "windows: send_path_force command (overwrite send) + register (M3)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 3: frontend — overwrite-on-exists retry

**Files:**
- Modify: `windows_gui/share-manager/src/app.js`

- [ ] **Step 1: Add the `sendOne` helper**

In `src/app.js`, find this exact line (the start of the batch sender):
```js
async function sendBatch(paths, category) {
```
Insert this helper IMMEDIATELY ABOVE it:
```js
// Send one path; if the target already exists (PS exit 20), ask to overwrite
// and retry with the force variant. Throws on real failure / declined overwrite.
async function sendOne(p, category) {
  try {
    await invoke('send_path', { sourcePath: p, category });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('Target already exists') || msg.includes('exit Some(20)')) {
      const name = p.split(/[\\/]/).pop();
      if (window.confirm(`"${name}" 이(가) 이미 있어요. 덮어쓸까요?`)) {
        await invoke('send_path_force', { sourcePath: p, category });
      } else {
        throw new Error('덮어쓰기 취소됨');
      }
    } else {
      throw e;
    }
  }
}

```

- [ ] **Step 2: Route both send loops through `sendOne`**

Replace BOTH occurrences of this exact line:
```js
      await invoke('send_path', { sourcePath: p, category });
```
with:
```js
      await sendOne(p, category);
```
(There are exactly two — in `sendBatch` and `submitDrop`. Use a replace-all on this exact string.)

- [ ] **Step 3: Verify JS parses**
```
node --check windows_gui/share-manager/src/app.js && echo "JS OK"
```
Expected: `JS OK`.

- [ ] **Step 4: Commit**
```
git add windows_gui/share-manager/src/app.js
git commit -m "windows: overwrite-on-exists retry via send_path_force (M3)"
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
Expected: `Finished N bundles` with `share-manager.exe`.

- [ ] **Step 2: Manual check (record result)**

In the running app: send a file, then send the SAME file again → an "이미 있어요. 덮어쓸까요?" confirm appears; accepting overwrites (success toast), declining reports "덮어쓰기 취소됨". The Task-1 Step-4 integration test already proves the script-level `-Force` behavior; this confirms the UI wiring. Human/agent gate — fix before Step 3 on failure.

- [ ] **Step 3: Update the parity matrix**

In `PARITY_MATRIX.md` §3-B, change:
```
| `send_path_force` (overwrite) | D-8-b | MED | Windows 덮어쓰기 송신 경로 |
```
to:
```
| `send_path_force` (overwrite) | D-8-b | ✅ **완료** | send-to-mac.ps1 -Force + send_path_force + 덮어쓰기 확인 (M3) |
```
And in §4 "**Windows ← Mac (MED)**", change:
```
6. send_path_force — D-8-b · M3
```
to:
```
6. ~~send_path_force — D-8-b · M3~~ ✅ 완료
```

- [ ] **Step 4: Commit**
```
git add PARITY_MATRIX.md
git commit -m "parity: M3 send_path_force done on Windows"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-Review

- **Spec coverage:** `-Force` script switch → Task 1; `send_path_force` command + register → Task 2; frontend overwrite retry → Task 3; build/manual/closeout → Task 4. Matches handoff M3.
- **Type consistency:** `send_path_force(source_path, category) -> Result<String, String>` mirrors `send_path`; JS calls `invoke('send_path_force', { sourcePath, category })` (Tauri camelCase, consistent with the existing `send_path` call). The error string `"Target already exists"` produced by the PS1 (unchanged in non-force mode) is what `sendOne` matches on.
- **Reuse / DRY:** `sendOne` is shared by both send loops (no duplicated overwrite logic). `send_path_force` mirrors `send_path`'s exact shell-out pattern, differing only by the `-Force` arg + `"forced": true` log fields.
- **No placeholders:** every step has full code + exact commands + expected output. Task 1 Step 4 gives an automated script-level proof of `-Force`.

## Done when
- [ ] Task 1 Step 4 prints `1st=0 ... 2nd=20 ... 3rd-force=0` then `PASS`
- [ ] `cargo build` clean; release build produces `share-manager.exe`
- [ ] `node --check src/app.js` → JS OK
- [ ] Manual: re-sending an existing file prompts overwrite; force overwrites
- [ ] `PARITY_MATRIX.md` shows M3 ✅
