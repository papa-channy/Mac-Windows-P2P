# Mac-Windows-P2P — Distribution & Release Playbook

This file captures how the macOS side of the project ships, signs, notarizes,
and auto-updates. Future Claude sessions should read this before touching
anything in `mac_gui/scripts/`, `tauri.conf.json` signing/updater fields, or
`RELEASES.json`.

## Distribution philosophy

- **Direct distribution outside the Mac App Store.** Apple Developer ID +
  Notarization + Stapling — recipients download a single DMG from GitHub
  Releases and Gatekeeper accepts it without warnings, offline.
- **One DMG, two apps.** The DMG carries both `share-manager.app` (Tauri
  GUI) and `SendToWindowsLauncher.app` (Swift Service vendor for Finder's
  right-click menu). Recipients drag both to `/Applications`.
- **Auto-update via Tauri updater + minisign.** Releases publish
  `share-manager.app.tar.gz` + `.sig` + `latest.json` alongside the DMG;
  installed apps check the manifest and self-update in place.
- **Release notes are part of the contract.** Every release writes an
  entry into `RELEASES.json` at the repo root. The entry is bundled into
  the .app and shown on first launch after an update.

## Identities & secrets

| What | Where | How discovered |
|---|---|---|
| Apple Developer ID Application cert | Login keychain | `security find-identity -v -p codesigning` |
| Notary credentials (App Store Connect API key — preferred) | Keychain profile `MAC_WINDOW_SHARE_NOTARY`, `.p8` at `~/.appstoreconnect/private_keys/AuthKey_<ID>.p8` | created once by `setup-notary.sh` |
| Tauri updater minisign private key | `~/.tauri/share-manager.key` (default no password, optional encryption) | created once by `setup-updater.sh` |
| Tauri updater minisign public key | `mac_gui/share-manager/src-tauri/tauri.conf.json` `plugins.updater.pubkey` | written by `setup-updater.sh` |

Defaults baked into `mac_gui/scripts/env.sh`:

```
APPLE_TEAM_ID=JJH9NPABP6
APPLE_SIGNING_IDENTITY="Developer ID Application: CHAN PARK (JJH9NPABP6)"
APPLE_NOTARY_PROFILE=MAC_WINDOW_SHARE_NOTARY
TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/share-manager.key"
```

`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is **never** committed — export it in
your shell when releasing, or feed it through `security find-generic-password`
if you store it in keychain.

## One-time setup (per developer machine)

```sh
# Notary credentials. Default method is App Store Connect API key — see
# the script header for the (browser-side) steps to generate the .p8 file
# and the two IDs. App-specific-password fallback available via
# NOTARY_METHOD=password if API key isn't an option.
export ASC_API_KEY_ID=ABCD12EF34
export ASC_API_ISSUER_ID=69a6de7c-xxxx-xxxx-xxxx-xxxxxxxxxxxx
sh mac_gui/scripts/setup-notary.sh

sh mac_gui/scripts/setup-updater.sh   # generate minisign keypair + patch tauri.conf.json
```

Why API key over app-specific password: keys are bound to the team itself
rather than to an Apple ID. They survive Apple ID password changes, 2FA
resets, "pending agreement" 401s, and team-membership confusion. Generate
once in the browser, drop into `~/.appstoreconnect/private_keys/`, done.

`setup-updater.sh` writes the public key into `tauri.conf.json` and prints
the private key path. Commit the public key change. **Never** commit the
private key.

## Every release

1. **Edit `RELEASES.json`** — prepend a new entry at the top:
   ```json
   {
     "version": "0.2.0",
     "date": "2026-05-21",
     "title": "Drag-drop send",
     "highlights": [
       "Finder 우클릭 다중 선택 → 한 transfer 로 묶음 송신",
       "Sent view: 로컬 jsonl 기반 영구 송신 이력"
     ],
     "notes": "Full markdown body if you want longer prose."
   }
   ```
2. **Bump version** in `mac_gui/share-manager/src-tauri/tauri.conf.json`
   AND `mac_gui/share-manager/package.json`. They must match.
3. **Run the release pipeline**:
   ```sh
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=…   # if you password-protected the key
   sh mac_gui/scripts/release.sh
   ```
   Output in `mac_gui/dist/`:
   - `mac-window-share-<ver>.dmg` — signed + notarized + stapled
   - `share-manager.app.tar.gz` — minisign-signed updater payload
   - `share-manager.app.tar.gz.sig` — minisign signature
   - `latest.json` — updater manifest
4. **Upload to GitHub Releases**:
   ```sh
   gh release create v<ver> \
     mac_gui/dist/mac-window-share-<ver>.dmg \
     mac_gui/dist/share-manager.app.tar.gz \
     mac_gui/dist/share-manager.app.tar.gz.sig \
     mac_gui/dist/latest.json \
     --title "v<ver>" \
     --notes-from-tag
   ```
   The updater endpoint
   (`https://github.com/papa-channy/Mac-Windows-P2P/releases/latest/download/latest.json`)
   resolves to the newest release's `latest.json` automatically.

## How the desktop shortcut survives auto-update

On first launch, the app creates a **symbolic link** at
`~/Desktop/share-manager.app → /Applications/share-manager.app`. Symbolic
links resolve dynamically, so when the Tauri updater replaces
`/Applications/share-manager.app` in place during an update, the desktop
shortcut points at the new binary automatically — no extra work needed.

If a user explicitly drags `share-manager.app` to the Desktop (instead of
keeping the alias), auto-updates only apply to whichever `/Applications`
copy the updater finds. The first-launch flow prompts to install to
`/Applications` if the running binary is somewhere else.

## How release notes surface on launch

- `RELEASES.json` is bundled into the .app as a Tauri resource
  (`bundle.resources` in `tauri.conf.json`).
- Frontend calls `get_release_notes()` on mount → reads the bundled file.
- Compared to `settings.last_seen_version`. If different (or unset),
  the `AnnouncementModal` opens with the entry's `title` + `highlights`
  for the current version.
- On dismiss, `settings.last_seen_version` is set to the current app
  version — the modal does not reappear until the next update.

The first launch on a clean install shows a "환영합니다" variant of the same
modal with first-run guidance (Service menu activation, share root setup).

## Common operations

```sh
# Verify the chain end-to-end
codesign --verify --deep --strict --verbose=2 /Applications/share-manager.app
spctl --assess --type execute --verbose=4 /Applications/share-manager.app
xcrun stapler validate /Applications/share-manager.app

# Inspect the updater manifest live
curl -fsSL https://github.com/papa-channy/Mac-Windows-P2P/releases/latest/download/latest.json | jq

# Force an update check from a running app
# (Settings → "지금 업데이트 확인" button)

# Roll back: download the prior DMG and overwrite /Applications/share-manager.app
```

## Known issues

### Updater + DMG distribution require a public repo

GitHub Releases public download URLs (`releases/latest/download/...`)
return 404 on private repos — only authenticated API calls (e.g.
`gh release download`) work. This breaks the Tauri updater client AND
direct DMG download links.

**Resolution applied (2026-05-22)**: repo flipped to public via
`gh repo edit papa-channy/Mac-Windows-P2P --visibility public`. All
release artifacts now resolve with HTTP 200. If a future fork wants to
stay private, route updater artifacts through S3 / Cloudflare R2 /
personal hosting instead of `releases/.../download/`.

The frontend correctly reports "확인 실패" on any updater fetch error
via `checkForUpdateDetailed()` in `src/lib/updater.ts` — distinguishes
up-to-date / available / error so the user never sees a misleading
"최신 버전입니다" when the endpoint is actually unreachable.

## What NOT to do

- **Never** commit `~/.tauri/share-manager.key` or the keychain dump.
- **Never** ship an update without bumping `tauri.conf.json` `version` —
  the updater client compares semver and silently no-ops on equal versions.
- **Never** rotate the minisign key without a coordinated migration —
  clients running an older `pubkey` will reject updates signed with a new
  key. The pubkey is compiled into the binary, so rotation requires every
  installed user to install a fresh DMG manually.
- **Never** notarize with `--no-wait` in CI without persisting the
  submission ID; without `--wait` the staple step has nothing to verify.
- **Never** put `signingIdentity` directly in `tauri.conf.json` — keep it
  in env.sh so the file works on machines without that cert installed.

## File map

```
mac_gui/
├── CLAUDE.md (THIS FILE in spirit — actual file is at repo root)
├── .gitignore                              # dist/ excluded
├── install.sh                              # local install of mw CLI + apps
├── scripts/
│   ├── README.md                           # detailed per-script docs
│   ├── env.sh                              # defaults (Team ID, identity name)
│   ├── setup-notary.sh                     # one-time notarytool credential store
│   ├── setup-updater.sh                    # one-time minisign keypair generation
│   ├── sign-app.sh                         # deep-sign a .app
│   ├── notarize.sh                         # submit + staple any artifact
│   └── release.sh                          # full pipeline orchestrator
├── share-manager/                          # Tauri v2 + React GUI
│   └── src-tauri/
│       ├── Entitlements.plist              # Hardened Runtime entitlements
│       └── tauri.conf.json                 # bundle.macOS, plugins.updater
├── send-to-windows-launcher/               # Swift Service vendor
│   ├── Entitlements.plist
│   └── scripts/bundle.sh                   # Developer ID-aware
└── RELEASES.json (at repo root)            # release notes — source of truth
```
