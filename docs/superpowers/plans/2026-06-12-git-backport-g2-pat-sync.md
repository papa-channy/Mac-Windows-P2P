# Git Backport G2 — PAT cross-host sync (age + ssh) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When one host registers a GitHub PAT, the other host's OS keychain receives it automatically — encrypted to each peer's ssh-ed25519 public key via `age`, exchanged through the share. Mirrors Mac (`MAC_PARITY_HANDOFF_GIT.md` G2 + `PAT_SHARE_PROTOCOL.md`).

**Architecture:** The `age` crate's ssh-ed25519 recipient support encrypts the PAT to each peer's published public key; only that peer's private key can decrypt. Plaintext PAT lives only in each OS keychain (Windows Credential Manager); the share carries ciphertext only. The crypto is extracted into two pure helpers (`encrypt_token_to_pubkey` / `decrypt_token_with_privkey`) with a real roundtrip test; three thin Tauri commands (`git_publish_host_pubkey` / `git_share_pat_to_peers` / `git_pull_pat_from_share`) wire keychain + share IO around them. A new `git-token` watcher topic triggers auto-import; the frontend auto-publishes + shares on token save and auto-pulls on the watcher event and at startup.

**Tech Stack:** Rust (`age = { version = "0.10", features = ["ssh"] }`, existing `keyring`), `ssh-keygen` (already used by `git_generate_ssh_key`), vanilla JS frontend, the `notify` file watcher.

## Wire contract (from `PAT_SHARE_PROTOCOL.md` — both OSes identical)
```
<share>/00_System/10_Config/
├── host-keys/<sanitized-host>.ssh.pub   # each host's ssh ed25519 PUBLIC key
└── git-token/<peer-host>.age            # PAT age-encrypted to <peer-host>'s pubkey
```
Sanitized host = `COMPUTERNAME` filtered to `[A-Za-z0-9_-]` (existing `host_id_safe`), default `"windows"`. Keychain entry: service `"mac-window-git"`, account `"github-pat"` (existing `KEYRING_SERVICE`/`KEYRING_USER`).

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `windows_gui/share-manager/src-tauri/Cargo.toml` | add `age` | modify |
| `windows_gui/share-manager/src-tauri/src/commands.rs` | crypto helpers + path/host helpers + 3 commands + watcher topic + tests | modify |
| `windows_gui/share-manager/src-tauri/src/lib.rs` | register 3 commands | modify |
| `windows_gui/share-manager/src/app.js` | auto publish/share on save, share-changed `git-token` handler, startup auto-pull | modify |
| `PARITY_MATRIX.md` | mark G2 done | modify |

Paths are relative to repo root `D:\dev\Mac-Windows-P2P`. Run cargo with `--manifest-path src-tauri/Cargo.toml` from `windows_gui/share-manager`. Confirmed existing in `commands.rs`: `get_token()` (1810), `keyring_entry()` (1806), `host_id_safe()`, `home_dir()` (1876, `%USERPROFILE%`), `git_generate_ssh_key` produces `~/.ssh/mac_window_git_ed25519(.pub)`, `classify_event_path` (2174), `start_file_watcher` watch_paths (2191), `PathBuf`/`Command`/`hide_console` in scope. Confirmed in `app.js`: `$gitTokenSave` handler (3403) calls `git_set_token` (3409); `$gitSshGen` handler (3438) calls `git_generate_ssh_key` (3441); the `share-changed` `listen` switch (3497-3517) with cases transfers/clipboard/notes/profiles/git.

---

### Task 1: `age` dependency + crypto helpers + roundtrip test (TDD)

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/commands.rs`

- [ ] **Step 1: Add the `age` dependency**

In `src-tauri/Cargo.toml`, find:
```toml
keyring = { version = "3", features = ["windows-native"] }
```
Insert immediately AFTER it:
```toml
age = { version = "0.10", features = ["ssh"] }
```

- [ ] **Step 2: Write the failing roundtrip test**

Append to the END of `src-tauri/src/commands.rs`:
```rust
#[cfg(test)]
mod pat_crypto_tests {
    use super::*;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn age_ssh_ed25519_roundtrip() {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir()
            .join(format!("mw-age-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.join("k");
        let out = Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "", "-C", "test", "-f"])
            .arg(&key)
            .output()
            .expect("ssh-keygen must be on PATH");
        assert!(out.status.success(), "ssh-keygen failed: {}", String::from_utf8_lossy(&out.stderr));
        let pub_line = std::fs::read_to_string(key.with_extension("pub")).unwrap().trim().to_string();
        let priv_text = std::fs::read_to_string(&key).unwrap();

        let token = "ghp_TESTtoken1234567890";
        let ct = encrypt_token_to_pubkey(token, &pub_line).expect("encrypt");
        assert!(!ct.is_empty());
        assert_ne!(&ct[..], token.as_bytes(), "ciphertext must differ from plaintext");
        let pt = decrypt_token_with_privkey(&ct, &priv_text, &key.to_string_lossy()).expect("decrypt");
        assert_eq!(pt.trim(), token);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- [ ] **Step 3: Verify it fails to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pat_crypto_tests 2>&1 | tail -20`
Expected: compile error `cannot find function encrypt_token_to_pubkey`. (The `age` crate also downloads here.) Confirm, then proceed.

- [ ] **Step 4: Add the two pure crypto helpers**

In `src-tauri/src/commands.rs`, find the existing line `fn get_token() -> Option<String> {` and insert this block IMMEDIATELY ABOVE it:
```rust
/// age-encrypt `token` to an ssh-ed25519 public-key line (one recipient).
/// Pure (no IO) — the PAT cross-host crypto core. Mirrors Mac git.rs.
#[allow(dead_code)]
fn encrypt_token_to_pubkey(token: &str, pubkey_line: &str) -> Result<Vec<u8>, String> {
    use age::ssh::Recipient as SshRecipient;
    use age::Encryptor;
    use std::io::Write as _;
    use std::str::FromStr;
    let recipient = SshRecipient::from_str(pubkey_line)
        .map_err(|e| format!("ssh 공개키 파싱 실패: {e:?}"))?;
    let encryptor = Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or("recipient 가 비었음")?;
    let mut out = Vec::new();
    let mut writer = encryptor.wrap_output(&mut out).map_err(|e| format!("encrypt 시작 실패: {e}"))?;
    writer.write_all(token.as_bytes()).map_err(|e| format!("encrypt write 실패: {e}"))?;
    writer.finish().map_err(|e| format!("encrypt finish 실패: {e}"))?;
    Ok(out)
}

/// age-decrypt ciphertext with an ssh-ed25519 private key (PEM text).
/// `priv_label` is just a human label for parse errors. Pure (no IO).
#[allow(dead_code)]
fn decrypt_token_with_privkey(ciphertext: &[u8], priv_text: &str, priv_label: &str) -> Result<String, String> {
    use age::Decryptor;
    use std::io::Read as _;
    let decryptor = match Decryptor::new(ciphertext).map_err(|e| e.to_string())? {
        Decryptor::Recipients(d) => d,
        Decryptor::Passphrase(_) => return Err("예상치 못한 passphrase age 파일".into()),
    };
    let identity = age::ssh::Identity::from_buffer(
        std::io::BufReader::new(priv_text.as_bytes()),
        Some(priv_label.to_string()),
    )
    .map_err(|e| format!("ssh 개인키 파싱 실패: {e}"))?;
    let identities: Vec<Box<dyn age::Identity>> = vec![Box::new(identity)];
    let mut reader = decryptor
        .decrypt(identities.iter().map(|i| i.as_ref()))
        .map_err(|e| format!("복호화 실패: {e}"))?;
    let mut plaintext = String::new();
    reader.read_to_string(&mut plaintext).map_err(|e| format!("복호화 read 실패: {e}"))?;
    Ok(plaintext)
}
```

- [ ] **Step 5: Verify the test passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pat_crypto_tests 2>&1 | tail -12`
Expected: `test result: ok. 1 passed; 0 failed`.
If `age::ssh::Identity::from_buffer` / `Decryptor::new` signatures differ for the resolved `age` 0.10.x, READ the error and adapt (the Mac code at `mac_gui/share-manager/src-tauri/src/git.rs:872-903` is the reference for the exact API) — keep the helper signatures and the test assertions unchanged. Report any adaptation.

- [ ] **Step 6: Commit**
```
git add windows_gui/share-manager/src-tauri/Cargo.toml windows_gui/share-manager/src-tauri/Cargo.lock windows_gui/share-manager/src-tauri/src/commands.rs
git commit -m "windows git: age ssh-ed25519 PAT crypto helpers + roundtrip test (G2 core)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: path/host helpers + 3 commands + registration

**Files:**
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Remove the two temporary `#[allow(dead_code)]`**

In `commands.rs`, delete the `#[allow(dead_code)]` line directly above EACH of `fn encrypt_token_to_pubkey` and `fn decrypt_token_with_privkey` (they get real callers in this task).

- [ ] **Step 2: Add the path/host/peer helpers**

In `commands.rs`, immediately ABOVE `fn get_token() -> Option<String> {` (just above the crypto helpers from Task 1), insert:
```rust
fn share_config_dir() -> PathBuf {
    let p = crate::share::share_root().join("00_System").join("10_Config");
    let _ = std::fs::create_dir_all(&p);
    p
}
fn host_keys_dir() -> PathBuf {
    let p = share_config_dir().join("host-keys");
    let _ = std::fs::create_dir_all(&p);
    p
}
fn git_token_share_dir() -> PathBuf {
    let p = share_config_dir().join("git-token");
    let _ = std::fs::create_dir_all(&p);
    p
}
fn my_host_sanitized() -> String {
    let h = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows".into());
    let safe = host_id_safe(&h);
    if safe.is_empty() { "windows".into() } else { safe }
}
fn my_ssh_pub_path() -> Result<PathBuf, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    for name in ["mac_window_git_ed25519.pub", "id_ed25519.pub"] {
        let p = ssh.join(name);
        if p.exists() { return Ok(p); }
    }
    Err("ssh ed25519 키가 없습니다 — Settings → Git → SSH 키 생성 먼저".into())
}
fn my_ssh_priv_path() -> Result<PathBuf, String> {
    let ssh = home_dir().ok_or("홈 디렉터리 없음")?.join(".ssh");
    for name in ["mac_window_git_ed25519", "id_ed25519"] {
        let p = ssh.join(name);
        if p.exists() { return Ok(p); }
    }
    Err("ssh ed25519 개인키가 없습니다".into())
}
fn list_peer_pubkeys() -> Result<Vec<(String, String)>, String> {
    let dir = host_keys_dir();
    let me = my_host_sanitized();
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&dir) { Ok(r) => r, Err(_) => return Ok(out) };
    for e in rd.flatten() {
        let p = e.path();
        let stem = p.file_name().and_then(|s| s.to_str())
            .and_then(|s| s.strip_suffix(".ssh.pub")).map(|s| s.to_string());
        let Some(host) = stem else { continue };
        if host == me { continue; }
        if let Ok(pubkey) = std::fs::read_to_string(&p) {
            out.push((host, pubkey.trim().to_string()));
        }
    }
    Ok(out)
}
```

- [ ] **Step 3: Add the three Tauri commands**

In `commands.rs`, insert immediately AFTER the `decrypt_token_with_privkey` function (after its closing brace):
```rust
/// Publish this host's ssh public key to the share so peers can encrypt PAT for us.
#[tauri::command]
pub fn git_publish_host_pubkey() -> Result<String, String> {
    let src = my_ssh_pub_path()?;
    let pub_text = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let cleaned = pub_text.trim().to_string();
    let dst = host_keys_dir().join(format!("{}.ssh.pub", my_host_sanitized()));
    std::fs::write(&dst, format!("{cleaned}\n")).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().into_owned())
}

/// Read the local PAT and write one age-encrypted blob per peer into the share.
/// Returns how many peers received it.
#[tauri::command]
pub fn git_share_pat_to_peers() -> Result<u32, String> {
    let token = get_token().ok_or("로컬 키체인에 PAT가 없습니다")?;
    let peers = list_peer_pubkeys()?;
    if peers.is_empty() { return Ok(0); }
    let mut count: u32 = 0;
    for (peer_host, pubkey_line) in peers {
        let ct = encrypt_token_to_pubkey(&token, &pubkey_line)
            .map_err(|e| format!("{peer_host}: {e}"))?;
        let dst = git_token_share_dir().join(format!("{peer_host}.age"));
        std::fs::write(&dst, &ct).map_err(|e| format!("{peer_host} write 실패: {e}"))?;
        count += 1;
    }
    Ok(count)
}

/// Look for <share>/git-token/<my-host>.age, decrypt with our ssh private key,
/// import into keychain. Returns true only when a NEW PAT was imported.
#[tauri::command]
pub fn git_pull_pat_from_share() -> Result<bool, String> {
    let src = git_token_share_dir().join(format!("{}.age", my_host_sanitized()));
    if !src.exists() { return Ok(false); }
    let ciphertext = std::fs::read(&src).map_err(|e| e.to_string())?;
    let priv_path = my_ssh_priv_path()?;
    let priv_text = std::fs::read_to_string(&priv_path).map_err(|e| e.to_string())?;
    let plaintext = decrypt_token_with_privkey(&ciphertext, &priv_text, &priv_path.to_string_lossy())?;
    let token = plaintext.trim();
    if token.is_empty() { return Err("복호화된 PAT가 비어있음".into()); }
    if let Some(existing) = get_token() {
        if existing == token { return Ok(false); }
    }
    keyring_entry()?.set_password(token).map_err(|e| e.to_string())?;
    Ok(true)
}
```

- [ ] **Step 4: Register in the invoke handler**

In `src-tauri/src/lib.rs`, find this exact line:
```rust
            commands::git_generate_ssh_key,
```
Insert these three lines immediately AFTER it:
```rust
            commands::git_publish_host_pubkey,
            commands::git_share_pat_to_peers,
            commands::git_pull_pat_from_share,
```

- [ ] **Step 5: Build + tests**
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -15
```
Expected: `Finished`, no errors, and NO `dead_code` warning mentioning `encrypt_token_to_pubkey`, `decrypt_token_with_privkey`, or the new helpers/commands (all now used).
```
cargo test --manifest-path src-tauri/Cargo.toml pat_crypto_tests 2>&1 | tail -8
```
Expected: `1 passed; 0 failed`.

- [ ] **Step 6: Commit**
```
git add windows_gui/share-manager/src-tauri/src/commands.rs windows_gui/share-manager/src-tauri/src/lib.rs
git commit -m "windows git: PAT publish/share/pull commands (age+ssh) + register (G2)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 3: watcher `git-token` topic

**Files:**
- Modify: `src-tauri/src/commands.rs` (`classify_event_path` + `start_file_watcher`)

- [ ] **Step 1: Classify the git-token path**

In `classify_event_path`, find:
```rust
    if has("\\profiles\\") || has("/profiles/") { return "profiles"; }
    if has("\\90_Git\\") || has("/90_Git/") { return "git"; }
```
Replace with (add the git-token branch — it must come before any broad match; `10_Config/git-token` does not contain `90_Git`, so order vs the git branch is safe, but keep git-token explicit):
```rust
    if has("\\profiles\\") || has("/profiles/") { return "profiles"; }
    if has("\\git-token\\") || has("/git-token/") { return "git-token"; }
    if has("\\90_Git\\") || has("/90_Git/") { return "git"; }
```

- [ ] **Step 2: Watch the git-token directory**

In `start_file_watcher`, find:
```rust
            share.join("00_System").join("90_Git"),
            share.join("00_System").join("10_Config").join("profiles"),
        ];
```
Replace with:
```rust
            share.join("00_System").join("90_Git"),
            share.join("00_System").join("10_Config").join("profiles"),
            share.join("00_System").join("10_Config").join("git-token"),
        ];
```

- [ ] **Step 3: Build**
```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -6
```
Expected: `Finished`, no errors.

- [ ] **Step 4: Commit**
```
git add windows_gui/share-manager/src-tauri/src/commands.rs
git commit -m "windows git: watch git-token dir + classify git-token topic (M-2-b, G2)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 4: frontend — auto publish/share, auto-pull on event + startup

**Files:**
- Modify: `windows_gui/share-manager/src/app.js`

- [ ] **Step 1: Auto publish pubkey + share PAT on token save**

In `src/app.js`, find:
```js
    await invoke('git_set_token', { token: tok });
    const info = await invoke('git_test_token');
```
Replace with:
```js
    await invoke('git_set_token', { token: tok });
    // G2: publish my ssh pubkey + push PAT to peers (best-effort; needs an ssh key).
    try {
      await invoke('git_publish_host_pubkey');
      const shared = await invoke('git_share_pat_to_peers');
      if (shared > 0) toast(`PAT를 ${shared}개 호스트에 자동 공유함`, 'success');
    } catch (_) {}
    const info = await invoke('git_test_token');
```

- [ ] **Step 2: Auto-publish pubkey right after generating the ssh key**

In `src/app.js`, find:
```js
    const pub = await invoke('git_generate_ssh_key');
    $gitSshPubkey.value = pub;
```
Replace with:
```js
    const pub = await invoke('git_generate_ssh_key');
    try { await invoke('git_publish_host_pubkey'); } catch (_) {}
    $gitSshPubkey.value = pub;
```

- [ ] **Step 3: Handle the `git-token` watcher topic**

In `src/app.js`, find:
```js
        case 'git':
          if (state.view === VIEW_GIT) refreshGit().catch(() => {});
          break;
      }
```
Replace with:
```js
        case 'git':
          if (state.view === VIEW_GIT) refreshGit().catch(() => {});
          break;
        case 'git-token':
          invoke('git_pull_pat_from_share').then((imported) => {
            if (imported) {
              toast('다른 호스트에서 PAT를 받아 등록함', 'success');
              if (state.view === VIEW_GIT) refreshGit().catch(() => {});
            }
          }).catch(() => {});
          break;
      }
```

- [ ] **Step 4: Best-effort auto-pull at startup**

In `src/app.js`, find:
```js
  maybeAutoVerify();

  // File-watcher driven refresh (no polling). Rust emits "share-changed"
```
Replace with:
```js
  maybeAutoVerify();

  // G2: on startup, import a PAT a peer may have shared while we were closed.
  invoke('git_pull_pat_from_share').then((imported) => {
    if (imported && state.view === VIEW_GIT) refreshGit().catch(() => {});
  }).catch(() => {});

  // File-watcher driven refresh (no polling). Rust emits "share-changed"
```

- [ ] **Step 5: Verify JS parses**
```
node --check windows_gui/share-manager/src/app.js && echo "JS OK"
```
Expected: `JS OK`.

- [ ] **Step 6: Commit**
```
git add windows_gui/share-manager/src/app.js
git commit -m "windows git: auto publish/share PAT + git-token auto-pull (event + startup) (G2)"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 5: build + manual cross-OS verification + parity closeout

**Files:**
- Modify: `PARITY_MATRIX.md`

- [ ] **Step 1: Full release build**
```
cargo tauri build 2>&1 | tail -8
```
Expected: `Finished N bundles` with `share-manager.exe`.

- [ ] **Step 2: Manual cross-OS verification (record results)**

Per `PAT_SHARE_PROTOCOL.md` §검증 (needs the Mac side running the matching commands):
- On Windows: Settings → Git → generate SSH key (auto-publishes pubkey → `<share>/00_System/10_Config/host-keys/<WINHOST>.ssh.pub` appears).
- On Mac: same (its pubkey appears in `host-keys/`).
- On one host: enter + save a PAT → toast "PAT를 N개 호스트에 자동 공유함"; confirm `<share>/00_System/10_Config/git-token/<peerhost>.age` is created.
- On the other host: within ~1.5s the `git-token` watcher fires → `git_pull_pat_from_share` imports → Settings → Git shows "✅ 토큰 등록됨"; GitView remote sync works.
- Negative: a host without the matching ssh private key cannot decrypt (safe).

If the Mac side isn't ready, at minimum verify the Windows half: pubkey publishes to `host-keys/`, and (with two ssh keys present locally for a self-test) the encrypt→`.age`→decrypt path produces a valid import. This is a human/agent gate; STOP and fix on failure.

- [ ] **Step 3: Update the parity matrix**

In `PARITY_MATRIX.md` §3-B, change the row:
```
| PAT cross-host sync (age+ssh) | F-3/B-10 | **HIGH** | cross-host 핵심인데 Windows 미구현 (KEYRING 상수만 있음) |
```
to:
```
| PAT cross-host sync (age+ssh) | F-3/B-10 | ✅ **완료** | git_publish/share/pull + git-token watch + 자동 import (G2) |
```
And in §4 "**Windows ← Mac (HIGH)**", change:
```
2. PAT cross-host sync (age+ssh) 3개 — F-3 · G2
```
to:
```
2. ~~PAT cross-host sync (age+ssh) 3개 — F-3 · G2~~ ✅ 완료
```

- [ ] **Step 4: Commit**
```
git add PARITY_MATRIX.md
git commit -m "parity: G2 PAT cross-host sync done on Windows — HIGH backlog cleared"
```
End with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-Review

- **Spec coverage:** handoff G2.1 (age crate) → Task 1; G2.4 commands → Task 2; G2.7 watcher git-token → Task 3; G2.6 auto-pull + publish/share wiring → Task 4; build/manual/closeout → Task 5. The 3 command signatures match Mac (`git.rs:791/833/872`); the wire contract (`host-keys/<host>.ssh.pub`, `git-token/<peer>.age`) matches `PAT_SHARE_PROTOCOL.md`.
- **Type consistency:** `encrypt_token_to_pubkey(&str,&str)->Result<Vec<u8>,String>` and `decrypt_token_with_privkey(&[u8],&str,&str)->Result<String,String>` defined in Task 1, called in Task 2's commands. Command names `git_publish_host_pubkey`/`git_share_pat_to_peers`/`git_pull_pat_from_share` match across commands.rs, lib.rs, and app.js. Watcher topic string `"git-token"` matches between `classify_event_path` (Task 3) and the app.js `case 'git-token'` (Task 4).
- **Reuse:** `get_token`/`keyring_entry`/`host_id_safe`/`home_dir` already exist (no duplication). Key-name preference (`mac_window_git_ed25519` then `id_ed25519`) matches Mac and what `git_generate_ssh_key` produces.
- **Security:** plaintext PAT only in the keychain; share holds age ciphertext only; the roundtrip test asserts ciphertext ≠ plaintext. Idempotent pull (skip when token unchanged) avoids keychain churn.
- **Known limit (documented):** a passphrase-protected ssh private key fails `age` decrypt — `git_generate_ssh_key` makes passphrase-less keys, so the default flow works; user-supplied protected keys are out of scope (same as Mac).

## Done when
- [ ] `cargo test ... pat_crypto_tests` → 1 passed (real ssh-ed25519 roundtrip)
- [ ] `cargo build` clean (no dead_code for the helpers/commands); release build produces `share-manager.exe`
- [ ] `node --check src/app.js` → JS OK
- [ ] Manual: pubkey publishes to `host-keys/`; saving a PAT writes `git-token/<peer>.age`; the peer auto-imports on the watcher event; remote sync works
- [ ] `PARITY_MATRIX.md` shows G2 ✅ and the HIGH backlog fully cleared
