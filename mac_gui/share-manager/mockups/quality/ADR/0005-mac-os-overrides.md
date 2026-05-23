# ADR-0005 · macOS-specific overrides for the v0.3 git UI

**Date**: 2026-05-24
**Status**: Accepted
**Scope**: `mac_gui/share-manager/` only — Windows side is unaffected

## Context

ADR-0001..0004 define the **universal** UI contract (light theme,
modal header grid, timeline graph layout, narrative panel). Those are
OS-agnostic and Mac mirrors them verbatim.

A handful of decisions, however, are inherently OS-specific. This ADR
captures them so they're not re-litigated every time the Mac side
diverges visually or behaviorally from Windows.

## Decisions

### D1. Monospace font stack

| | stack |
|---|---|
| Windows | `JetBrains Mono, Consolas, "Cascadia Mono", monospace` |
| **Mac** | `"SF Mono", Menlo, "JetBrains Mono", Consolas, monospace` |

Rationale: SF Mono ships with every macOS install (`/System/Library/Fonts/SFNS.ttf`),
matches the system aesthetic, and is what users expect for terminal /
diff content. JetBrains Mono is the third fallback in case the user has
installed it for parity with their Windows machine.

Verifier: CHECKLIST MAC-1.

### D2. Window chrome

Tauri's `decorations: true` + no custom titlebar → macOS draws the
native window with traffic-light (●●●) close/min/zoom controls on the
left.

Rationale: native chrome is what every macOS user expects; custom
chrome interferes with full-screen, Mission Control, and accessibility.

Verifier: CHECKLIST MAC-2.

### D3. Credential storage — Keychain via `keyring` crate

`keyring = { version = "...", features = ["apple-native"] }` —
`apple-native` feature uses macOS Security framework directly (Keychain
Services). Token CRUD (`git_set_token`, `git_has_token`, `git_clear_token`,
`git_test_token`) goes through this.

User experience: first save triggers a Keychain access dialog ("share-
manager wants to access the keychain item ...") with a Touch ID prompt
(if available). Subsequent reads from the same bundle id are silent.

Rationale: Windows credential manager and macOS Keychain are functionally
equivalent for our needs but require different backends. The `keyring`
crate's feature-gated backends keep the Rust API identical across OSes.

Verifier: CHECKLIST MAC-3.

### D4. SSH key path

| | path |
|---|---|
| Windows | `%USERPROFILE%\.ssh\id_ed25519` |
| **Mac** | `~/.ssh/id_ed25519` |

`git_ssh_status` resolves `$HOME/.ssh/` and probes for `id_ed25519`,
`id_ed25519.pub`, `config`. Generate flow (`git_generate_ssh_key`)
writes the same path with 0600 perms.

Verifier: CHECKLIST MAC-4.

### D5. Share mount detection

The Mac side reads its share via SMB at `/Volumes/Mac-Window_Share`.
Detection happens through `mount::is_share_mounted()` which stats
`share_root()/00_System` rather than running `/sbin/mount`. The mount
itself is established by the `mw` CLI helper invoked from
`mount::ensure_mounted()`.

Rationale: SMB is the only path that works in our two-host topology;
NTFS-direct (Windows) is not an option from macOS without third-party
drivers. The `mw` helper centralizes credential prompts so the GUI
never has to.

Verifier: CHECKLIST MAC-5.

### D6. Single-instance and Space following

`tauri-plugin-single-instance` routes second launches into the running
process. Combined with `NSWindowCollectionBehaviorMoveToActiveSpace`
applied at startup AND on every `RunEvent::Reopen`, the window follows
the user to whatever virtual desktop they're on. See `lib.rs::run` and
`apply_macos_space_behavior`.

Settled in v0.2.1/0.2.2 — no further work needed for v0.3 unless the
git UI introduces new window types (it doesn't).

Verifier: CHECKLIST MAC-6.

### D7. Full Disk Access onboarding

First launch triggers `PermissionsOnboarding` modal. The modal probes
`/Library/Application Support/com.apple.TCC/TCC.db` (FDA-protected) as
a side effect, which registers the bundle in System Settings → Privacy
& Security → 전체 디스크 접근. Polling continues every 1.5s until the
user toggles us on, at which point the modal auto-closes.

Settled in v0.2.2/0.2.3 — git UI doesn't change this behavior.

Verifier: CHECKLIST MAC-7.

### D8. Distribution — Notarized Developer ID

`release.sh` orchestrates `cargo tauri build` → deep `sign-app.sh` →
DMG → `xcrun notarytool` (App Store Connect API key) → `xcrun stapler`
→ minisign-signed `.tar.gz` for the Tauri updater → `latest.json` →
GitHub Release. The git UI release follows the same flow without any
config change.

Verifier: CHECKLIST MAC-8.

## Non-decisions (kept identical to Windows)

- Light theme color tokens (`--surface`, `--accent`, etc.)
- Grid spacing (16 / 20 / 24px)
- Modal header layout (`minmax(0,1fr) auto auto auto`, ADR-0002)
- Sync timeline graph metrics (ADR-0003)
- Narrative 3-panel layout (ADR-0004)
- Inspector light theme styling (ADR-0001)
- Brand SVG icons (Apple / Windows / GitHub octocat — UPC-4)
- Verdict / action ruleset (`computeGitNarrative()` semantics)

## Consequences

- Visual output is 1:1 with Windows except for native chrome and font
  rendering nuances.
- Implementation effort for git UI is in `git.rs` Rust backend and
  React component tree; OS-specific behavior is isolated to 8 numbered
  decisions above and one feature flag (`keyring`'s `apple-native`).
- Future OS divergences should land here as D9, D10, … rather than
  diffusing across the codebase as ad-hoc `#[cfg(target_os = ...)]`.
