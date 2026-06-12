# MED M4 — notify dispatch (native + webhook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fan out send/verify success+failure to an OS-native toast and a Slack/Discord-compatible webhook, gated by per-event user settings. Mirrors Mac (`MAC_PARITY_HANDOFF_MED.md` M4 / H-2/3/4 / K-4-h, Mac `notify.rs`).

**Architecture:** A `NotificationSettings` section is added to the local `Settings` (same field names as Mac so settings.json stays parity-compatible). Notify helpers live in `commands.rs` (single-file backend convention): a pure `notify_allowed` gate, a `post_webhook` (Slack JSON), and a best-effort `notify_dispatch` that reads settings, shows a native toast via `tauri-plugin-notification`, and POSTs the webhook on a detached thread. The send/verify commands gain an `app: tauri::AppHandle` param and call `notify_dispatch` at their success/failure points. The frontend adds a Notifications settings section (enable / native / webhook URL / per-event toggles / test button).

**Tech Stack:** Rust (`tauri-plugin-notification`, existing `ureq` for webhook), `#[cfg(test)]` for the pure gate + payload, vanilla JS + index.html settings UI.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `windows_gui/share-manager/src-tauri/Cargo.toml` | add notification plugin | modify |
| `windows_gui/share-manager/src-tauri/src/lib.rs` | register plugin | modify |
| `windows_gui/share-manager/src-tauri/src/share.rs` | `NotificationSettings` + `Settings.notifications` | modify |
| `windows_gui/share-manager/src-tauri/src/commands.rs` | notify helpers + test + hook into send/verify | modify |
| `windows_gui/share-manager/src/index.html` | Notifications settings section | modify |
| `windows_gui/share-manager/src/app.js` | DEFAULT_SETTINGS + render + listeners + test button | modify |
| `PARITY_MATRIX.md` | mark M4 done | modify |

Paths relative to repo root `D:\dev\Mac-Windows-P2P`. Confirmed: `share.rs` has `default_true()` (line 176) and the `Settings` struct (231-263) with `git: GitSettings` last + an `impl Default`; `commands.rs` has `settings_path(app)` (≈600-608), `send_path` (≈330-378, `(source_path, category)` — no app), `send_path_force` (added in M3), `auto_verify_pending` (≈2594-2613, no app), `verify_transfer` (≈244-247, no app), and `ureq` is a dep; `app.js` has `DEFAULT_SETTINGS` (117-124), `renderSettings()` ending at `renderPolicyAndProfiles()` (652), `persistSettings()`, and the integrity-toggle pattern (`$integrityAuto.checked = ...`); `index.html` settings sections use `<section class="settings-section"><h3>…</h3>` with `settings-row`/`settings-label`/`settings-control`/`toggle-row`; the last settings section before 외관 is "Git / GitHub" ending at line 325.

---

### Task 1: settings foundation (plugin + NotificationSettings)

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/share.rs`

- [ ] **Step 1: Add the plugin dependency**

In `src-tauri/Cargo.toml`, find:
```toml
tauri-plugin-autostart = "2"
```
Insert immediately AFTER it:
```toml
tauri-plugin-notification = "2"
```

- [ ] **Step 2: Register the plugin**

In `src-tauri/src/lib.rs`, find:
```rust
        .plugin(tauri_plugin_clipboard_manager::init())
```
Insert immediately AFTER it:
```rust
        .plugin(tauri_plugin_notification::init())
```

- [ ] **Step 3: Add `NotificationSettings` + wire into `Settings`**

In `src-tauri/src/share.rs`, find the line `fn default_true() -> bool { true }` and insert this struct IMMEDIATELY ABOVE it:
```rust
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct NotificationSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub native: bool,
    #[serde(default)]
    pub webhook_url: String,
    #[serde(default = "default_true")]
    pub on_send_ok: bool,
    #[serde(default = "default_true")]
    pub on_send_fail: bool,
    #[serde(default = "default_true")]
    pub on_verify_fail: bool,
    #[serde(default)]
    pub on_verify_ok: bool,
    #[serde(default)]
    pub on_clipboard: bool,
}

```
Then find the `Settings` struct and add the `notifications` field after `git`:
```rust
    #[serde(default)]
    pub git: GitSettings,
```
→
```rust
    #[serde(default)]
    pub git: GitSettings,
    #[serde(default)]
    pub notifications: NotificationSettings,
```
Then in `impl Default for Settings`, find:
```rust
            git: GitSettings::default(),
        }
    }
```
→
```rust
            git: GitSettings::default(),
            notifications: NotificationSettings::default(),
        }
    }
```

- [ ] **Step 4: Build**
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -12
```
Expected: `Finished` (notification plugin downloads + compiles), no errors.

- [ ] **Step 5: Commit**
```
git add windows_gui/share-manager/src-tauri/Cargo.toml windows_gui/share-manager/src-tauri/Cargo.lock windows_gui/share-manager/src-tauri/src/lib.rs windows_gui/share-manager/src-tauri/src/share.rs
git commit -m "windows: notification plugin + NotificationSettings (M4 foundation)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: notify helpers + test (TDD for the pure parts)

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write the failing tests (append to END of `commands.rs`)**
```rust
#[cfg(test)]
mod notify_tests {
    use super::*;

    #[test]
    fn gate_respects_master_toggle() {
        let mut s = crate::share::NotificationSettings { enabled: false, ..Default::default() };
        s.on_send_ok = true;
        assert!(!notify_allowed(&s, NotifyEvent::SendOk)); // master off → nothing
        s.enabled = true;
        assert!(notify_allowed(&s, NotifyEvent::SendOk));
    }
    #[test]
    fn gate_respects_per_event() {
        let s = crate::share::NotificationSettings {
            enabled: true, on_send_ok: true, on_send_fail: false,
            on_verify_ok: false, on_verify_fail: true, ..Default::default()
        };
        assert!(notify_allowed(&s, NotifyEvent::SendOk));
        assert!(!notify_allowed(&s, NotifyEvent::SendFail));
        assert!(!notify_allowed(&s, NotifyEvent::VerifyOk));
        assert!(notify_allowed(&s, NotifyEvent::VerifyFail));
    }
    #[test]
    fn slack_payload_shape() {
        let v = build_slack_payload("타이틀", "본문");
        assert_eq!(v.get("text").and_then(|x| x.as_str()), Some("*타이틀*\n본문"));
        assert_eq!(v.get("username").and_then(|x| x.as_str()), Some("share-manager"));
    }
}
```

- [ ] **Step 2: Verify it fails to compile**

Run (from `windows_gui/share-manager`): `cargo test --manifest-path src-tauri/Cargo.toml notify_tests 2>&1 | tail -15`
Expected: `cannot find function notify_allowed` / `NotifyEvent`. Confirm, then proceed.

- [ ] **Step 3: Add the notify helpers**

In `commands.rs`, find the existing `fn settings_path(app: &tauri::AppHandle) -> PathBuf {` and insert this block IMMEDIATELY ABOVE it:
```rust
// ─── Notifications (native toast + webhook) — M4 ───────────────
#[derive(Debug, Clone, Copy)]
pub enum NotifyEvent {
    SendOk,
    SendFail,
    VerifyOk,
    VerifyFail,
}

/// Pure gate: should this event fire under the user's settings?
fn notify_allowed(s: &crate::share::NotificationSettings, ev: NotifyEvent) -> bool {
    if !s.enabled {
        return false;
    }
    match ev {
        NotifyEvent::SendOk => s.on_send_ok,
        NotifyEvent::SendFail => s.on_send_fail,
        NotifyEvent::VerifyOk => s.on_verify_ok,
        NotifyEvent::VerifyFail => s.on_verify_fail,
    }
}

/// Slack/Discord-compatible JSON ({"text": "*title*\nbody"}). Pure.
fn build_slack_payload(title: &str, body: &str) -> serde_json::Value {
    serde_json::json!({ "text": format!("*{title}*\n{body}"), "username": "share-manager" })
}

fn post_webhook(url: &str, title: &str, body: &str) -> Result<(), String> {
    ureq::post(url)
        .timeout(std::time::Duration::from_secs(5))
        .set("Content-Type", "application/json")
        .send_json(build_slack_payload(title, body))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_settings_for_notify(app: &tauri::AppHandle) -> crate::share::Settings {
    let p = settings_path(app);
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Best-effort fan-out: native toast + webhook. Never blocks the caller
/// (webhook runs on a detached thread); never returns Err.
fn notify_dispatch(app: &tauri::AppHandle, ev: NotifyEvent, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let settings = read_settings_for_notify(app);
    if !notify_allowed(&settings.notifications, ev) {
        return;
    }
    if settings.notifications.native {
        let _ = app.notification().builder().title(title).body(body).show();
    }
    let webhook = settings.notifications.webhook_url.trim().to_string();
    if !webhook.is_empty() {
        let (t, b) = (title.to_string(), body.to_string());
        std::thread::spawn(move || {
            let _ = post_webhook(&webhook, &t, &b);
        });
    }
}

#[tauri::command]
pub fn notify_test(app: tauri::AppHandle) -> Result<(), String> {
    // Bypass the per-event gate so the user can verify wiring; still respects
    // the master "enabled" + native/webhook channel toggles via dispatch's read.
    notify_dispatch(&app, NotifyEvent::SendOk, "🔔 테스트 알림", "share-manager 알림이 정상 동작합니다.");
    Ok(())
}
```

> `notify_test` bypasses the per-event gate intentionally (it calls dispatch with SendOk, which is on by default) so "테스트 알림" works whenever notifications are enabled. If you want it to fire even when the master toggle is off, that's a product choice — keep it gated for now (simpler, matches "settings drive everything").

- [ ] **Step 4: Register `notify_test` in lib.rs**

In `src-tauri/src/lib.rs`, find `commands::save_settings,` and insert immediately AFTER it:
```rust
            commands::notify_test,
```

- [ ] **Step 5: Verify tests pass + build**
```
cargo test --manifest-path src-tauri/Cargo.toml notify_tests 2>&1 | tail -8
```
Expected: `3 passed; 0 failed`.
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -8
```
Expected: `Finished`. (A dead_code warning for `notify_dispatch`/`NotifyEvent` variants is acceptable until Task 3 wires the call sites — do NOT add `#[allow(dead_code)]`; Task 3 lands next and uses them. If you prefer a clean build between tasks, you may add `#[allow(dead_code)]` to `notify_dispatch` + `NotifyEvent` and have Task 3 remove it.)

- [ ] **Step 6: Commit**
```
git add windows_gui/share-manager/src-tauri/src/commands.rs windows_gui/share-manager/src-tauri/src/lib.rs
git commit -m "windows: notify helpers (gate/webhook/dispatch) + notify_test + tests (M4)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 3: hook notify into send/verify

**Files:**
- Modify: `src-tauri/src/commands.rs`

> Each command below gains `app: tauri::AppHandle` as its FIRST parameter (Tauri auto-injects it; the JS `invoke(...)` calls are unchanged). Then add `notify_dispatch` at the success/failure points. Read each function first and place the dispatch calls exactly where success/failure is determined.

- [ ] **Step 1: `send_path`**

Change the signature:
```rust
pub fn send_path(source_path: String, category: String) -> Result<String, String> {
```
→
```rust
pub fn send_path(app: tauri::AppHandle, source_path: String, category: String) -> Result<String, String> {
```
In the failure branch, immediately BEFORE the `return Err(format!("send failed ...`, add:
```rust
        notify_dispatch(&app, NotifyEvent::SendFail, "✗ 전송 실패",
            &format!("{}: {}", source_path, stderr.lines().next().unwrap_or("")));
```
In the success path, immediately BEFORE the final `Ok(tid)`, add:
```rust
    notify_dispatch(&app, NotifyEvent::SendOk, "✓ Mac로 전송 완료",
        &format!("{} → {}", source_path, category));
```

- [ ] **Step 2: `send_path_force`** (added in M3) — same edits

Signature → add `app: tauri::AppHandle` first param. Failure branch → `notify_dispatch(&app, NotifyEvent::SendFail, "✗ 전송 실패 (overwrite)", ...)` before its `return Err`. Success → `notify_dispatch(&app, NotifyEvent::SendOk, "✓ Mac로 전송 완료 (overwrite)", &format!("{} → {}", source_path, category))` before `Ok(tid)`.

- [ ] **Step 3: `verify_transfer`**

```rust
pub fn verify_transfer(transfer_id: String) -> Result<VerifyResult, String> {
    run_verify(&transfer_id)
}
```
→
```rust
pub fn verify_transfer(app: tauri::AppHandle, transfer_id: String) -> Result<VerifyResult, String> {
    let r = run_verify(&transfer_id);
    match &r {
        Ok(v) if v.ok => notify_dispatch(&app, NotifyEvent::VerifyOk, "✓ 검증 통과", &transfer_id),
        Ok(_) => notify_dispatch(&app, NotifyEvent::VerifyFail, "✗ 검증 실패", &transfer_id),
        Err(_) => {}
    }
    r
}
```
(Confirm `VerifyResult` has an `ok` field — it does per the existing `auto_verify_pending` which checks `r.ok`. If the field name differs, match it.)

- [ ] **Step 4: `auto_verify_pending`**

Add `app: tauri::AppHandle` as the first param. In its ok/fail branches (where `append_log("recv", verify_ok ...)` / `append_log("error", verify_fail ...)` happen), add after each `append_log`:
```rust
            notify_dispatch(&app, NotifyEvent::VerifyOk, "✓ 검증 통과", &r.transfer_id);
```
and
```rust
            notify_dispatch(&app, NotifyEvent::VerifyFail, "✗ 검증 실패", &r.transfer_id);
```
respectively (match the actual field used for the transfer id in those branches).

- [ ] **Step 5: Build + tests**
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -12
```
Expected: `Finished`, no errors, no dead_code warning for `notify_dispatch`/`NotifyEvent`.
```
cargo test --manifest-path src-tauri/Cargo.toml notify_tests 2>&1 | tail -6
```
Expected: `3 passed`.

- [ ] **Step 6: Commit**
```
git add windows_gui/share-manager/src-tauri/src/commands.rs
git commit -m "windows: dispatch notifications on send/verify ok+fail (M4)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 4: frontend — Notifications settings section

**Files:**
- Modify: `windows_gui/share-manager/src/index.html`, `windows_gui/share-manager/src/app.js`

- [ ] **Step 1: Add the settings section (index.html)**

In `src/index.html`, find the end of the "Git / GitHub" section:
```html
          </section>

          <section class="settings-section">
            <h3>외관</h3>
```
Insert a new section BETWEEN them (i.e., after the Git section's `</section>`, before the 외관 `<section>`):
```html
          <section class="settings-section">
            <h3>알림</h3>
            <div class="settings-row">
              <div class="settings-label">알림 사용</div>
              <div class="settings-control">
                <label class="toggle-row"><input type="checkbox" id="notify-enabled"><span>전송/검증 결과를 알림으로 받기</span></label>
                <label class="toggle-row"><input type="checkbox" id="notify-native"><span>OS 네이티브 토스트</span></label>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-label">Webhook (Slack/Discord)</div>
              <div class="settings-control">
                <input id="notify-webhook" type="text" class="text-input" placeholder="https://hooks.slack.com/services/...">
                <span class="settings-hint">Incoming Webhook URL. <code>{"text": "..."}</code> 형식 — Slack/Discord 호환.</span>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-label">이벤트별</div>
              <div class="settings-control">
                <label class="toggle-row"><input type="checkbox" id="notify-on-send-ok"><span>전송 성공</span></label>
                <label class="toggle-row"><input type="checkbox" id="notify-on-send-fail"><span>전송 실패</span></label>
                <label class="toggle-row"><input type="checkbox" id="notify-on-verify-ok"><span>검증 통과</span></label>
                <label class="toggle-row"><input type="checkbox" id="notify-on-verify-fail"><span>검증 실패</span></label>
                <button id="notify-test" class="ghost-btn" style="margin-top:8px">🔔 테스트 알림</button>
              </div>
            </div>
          </section>
```

- [ ] **Step 2: Add the default + DOM refs + render + listeners (app.js)**

In `src/app.js`, find in `DEFAULT_SETTINGS`:
```js
  git: { extra_roots: [], exclude_dirs: [], scan_enabled: true, owners: [], only_mine: true },
};
```
→
```js
  git: { extra_roots: [], exclude_dirs: [], scan_enabled: true, owners: [], only_mine: true },
  notifications: { enabled: false, native: true, webhook_url: '', on_send_ok: true, on_send_fail: true, on_verify_ok: false, on_verify_fail: true, on_clipboard: false },
};
```

Then find the git settings DOM-ref block (the `const $gitOnlyMine = ...` area near the other `git-*` refs — search for `git-only-mine`) and add these refs right after the git refs (anywhere module-level alongside other `getElementById` refs works; place near the git refs for cohesion):
```js
const $notifyEnabled    = document.getElementById('notify-enabled');
const $notifyNative     = document.getElementById('notify-native');
const $notifyWebhook    = document.getElementById('notify-webhook');
const $notifyOnSendOk   = document.getElementById('notify-on-send-ok');
const $notifyOnSendFail = document.getElementById('notify-on-send-fail');
const $notifyOnVerifyOk = document.getElementById('notify-on-verify-ok');
const $notifyOnVerifyFail = document.getElementById('notify-on-verify-fail');
const $notifyTest       = document.getElementById('notify-test');
```

Then find the end of `renderSettings()`:
```js
  // Policy & profiles
  renderPolicyAndProfiles();
}
```
→
```js
  // Policy & profiles
  renderPolicyAndProfiles();
  // Notifications
  renderNotificationSettings();
}

function renderNotificationSettings() {
  const n = state.settings.notifications || DEFAULT_SETTINGS.notifications;
  $notifyEnabled.checked    = !!n.enabled;
  $notifyNative.checked     = n.native !== false;
  $notifyWebhook.value      = n.webhook_url || '';
  $notifyOnSendOk.checked   = n.on_send_ok !== false;
  $notifyOnSendFail.checked = n.on_send_fail !== false;
  $notifyOnVerifyOk.checked = !!n.on_verify_ok;
  $notifyOnVerifyFail.checked = n.on_verify_fail !== false;
}

async function saveNotificationSettings() {
  state.settings.notifications = {
    enabled: $notifyEnabled.checked,
    native: $notifyNative.checked,
    webhook_url: ($notifyWebhook.value || '').trim(),
    on_send_ok: $notifyOnSendOk.checked,
    on_send_fail: $notifyOnSendFail.checked,
    on_verify_ok: $notifyOnVerifyOk.checked,
    on_verify_fail: $notifyOnVerifyFail.checked,
    on_clipboard: false,
  };
  await persistSettings();
}
```

Then register the listeners. Find the existing settings listener block (e.g. where `$gitTokenSave.addEventListener(...)` is wired — near the bottom of the file with the other `addEventListener` setup) and add:
```js
[$notifyEnabled, $notifyNative, $notifyOnSendOk, $notifyOnSendFail, $notifyOnVerifyOk, $notifyOnVerifyFail]
  .forEach(el => el.addEventListener('change', saveNotificationSettings));
$notifyWebhook.addEventListener('change', saveNotificationSettings);
$notifyTest.addEventListener('click', async () => {
  await saveNotificationSettings();
  try { await invoke('notify_test'); toast('테스트 알림 보냄', 'success'); }
  catch (e) { toast('테스트 실패: ' + e, 'error'); }
});
```

- [ ] **Step 3: Verify JS parses**
```
node --check windows_gui/share-manager/src/app.js && echo "JS OK"
```
Expected: `JS OK`.

- [ ] **Step 4: Commit**
```
git add windows_gui/share-manager/src/index.html windows_gui/share-manager/src/app.js
git commit -m "windows: Notifications settings section + test button (M4)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 5: build + manual + parity closeout

**Files:**
- Modify: `PARITY_MATRIX.md`

- [ ] **Step 1: Full release build**
```
cargo tauri build 2>&1 | tail -8
```
Expected: `Finished N bundles` with `share-manager.exe`.

- [ ] **Step 2: Manual check (record result)**

In the running app: Settings → 알림 → enable + check "전송 성공" + click "🔔 테스트 알림" → an OS toast appears. Paste a Slack incoming-webhook URL → test → `*🔔 테스트 알림*\n...` arrives in the channel. Turn "전송 성공" off → send a file → no send-ok toast (but "전송 실패" still fires on failure if on). Human/agent gate. The 3 unit tests already prove the gate + payload shape.

- [ ] **Step 3: Update the parity matrix**

In `PARITY_MATRIX.md` §3-B, change:
```
| 외부 알림 dispatch (native+webhook) | H-2/3/4 | MED | Windows 에 notify 동등물 없음 |
```
to:
```
| 외부 알림 dispatch (native+webhook) | H-2/3/4 | ✅ **완료** | notify_dispatch(native+webhook) + NotificationSettings + 설정 UI (M4) |
```
And in §4 "**Windows ← Mac (MED)**", change:
```
4. notify (native+webhook) — H-2/3/4 · M4
```
to:
```
4. ~~notify (native+webhook) — H-2/3/4 · M4~~ ✅ 완료
```
Optionally add a note in §4 that the MED backlog is now fully cleared (only LOW/conditional remain).

- [ ] **Step 4: Commit**
```
git add PARITY_MATRIX.md
git commit -m "parity: M4 notify dispatch done on Windows — MED backlog cleared"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-Review

- **Spec coverage:** plugin + NotificationSettings → Task 1; notify helpers (gate/webhook/dispatch) + test → Task 2; send/verify hooks → Task 3; settings UI → Task 4; build/manual/closeout → Task 5. The 3 completion criteria (settings-driven native toast / webhook delivery / per-event off) are all covered.
- **Type consistency:** `NotificationSettings` field names match Mac exactly (settings.json parity). `NotifyEvent` (SendOk/SendFail/VerifyOk/VerifyFail) used by `notify_allowed` (Task 2) and the call sites (Task 3). JS `state.settings.notifications` field names match the Rust struct. `notify_test` command registered + called from the test button.
- **Reuse / safety:** webhook reuses existing `ureq`; dispatch is best-effort (never returns Err, webhook on detached thread); `notify_allowed`/`build_slack_payload` are pure and unit-tested. Adding `app: tauri::AppHandle` to commands is backend-only (Tauri injects it; JS `invoke` unchanged).
- **No placeholders:** every step has full code + exact commands. Task 3 instructs reading each function to place dispatch calls precisely (success/failure points differ per function).

## Done when
- [ ] `cargo test ... notify_tests` → 3 passed
- [ ] `cargo build` clean; release build produces `share-manager.exe`
- [ ] `node --check src/app.js` → JS OK
- [ ] Manual: test button shows a toast; webhook URL delivers a Slack message; per-event toggle suppresses that event
- [ ] `PARITY_MATRIX.md` shows M4 ✅ and the MED backlog cleared
