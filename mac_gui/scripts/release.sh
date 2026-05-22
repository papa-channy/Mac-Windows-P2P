#!/bin/sh
# release.sh — end-to-end release pipeline.
#
#   1) cargo tauri build             → share-manager.app (signed by Tauri,
#                                       env-var driven Developer ID identity)
#   2) launcher bundle.sh            → SendToWindowsLauncher.app (signed)
#   3) hdiutil create                → mac-window-share-<ver>.dmg
#   4) codesign DMG                  → container signature
#   5) xcrun notarytool submit       → Apple notarization (~5–30 min wait)
#   6) xcrun stapler staple          → embeds ticket so the DMG passes
#                                       Gatekeeper offline
#   7) tar + cargo tauri signer sign → share-manager.app.tar.gz(+.sig)
#                                       updater payload
#   8) latest.json                   → updater manifest with notes from
#                                       RELEASES.json
#
# Output in mac_gui/dist/:
#   mac-window-share-<ver>.dmg
#   share-manager.app.tar.gz
#   share-manager.app.tar.gz.sig
#   latest.json
#
# Usage:
#   sh mac_gui/scripts/release.sh                    # full pipeline
#   SKIP_NOTARIZE=1 sh mac_gui/scripts/release.sh    # build+sign only
#   SKIP_UPDATER=1 sh mac_gui/scripts/release.sh     # DMG only, no updater

set -e
# Without pipefail, `cargo tauri build | tee log` returns tee's exit (0)
# even when cargo failed — caught us once already. Force the script to
# notice any error in a pipe.
set -o pipefail 2>/dev/null || true   # `sh` fallback: ignore if unsupported

HERE_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
MAC_GUI="$(cd "$HERE_SCRIPTS/.." && pwd)"
REPO_ROOT="$(cd "$MAC_GUI/.." && pwd)"
. "$HERE_SCRIPTS/env.sh"

SM_DIR="$MAC_GUI/share-manager"
LAUNCHER_DIR="$MAC_GUI/send-to-windows-launcher"
DIST="$MAC_GUI/dist"
STAGE="$DIST/stage"

VERSION="$(grep -m1 '"version"' "$SM_DIR/src-tauri/tauri.conf.json" \
    | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
DMG_NAME="mac-window-share-$VERSION.dmg"
DMG="$DIST/$DMG_NAME"

echo "==============================================="
echo "  release: mac-window-share v$VERSION"
echo "  identity:  $APPLE_SIGNING_IDENTITY"
echo "  team:      $APPLE_TEAM_ID"
echo "  updater:   ${SKIP_UPDATER:-0} == 1  →  skipped"
echo "  notarize:  ${SKIP_NOTARIZE:-0} == 1  →  skipped"
echo "==============================================="

# Sanity: identity must exist in keychain
if ! security find-identity -v -p codesigning | grep -q "$APPLE_TEAM_ID"; then
    echo "ERROR: codesigning identity for team $APPLE_TEAM_ID not in keychain." >&2
    echo "       run:  security find-identity -v -p codesigning" >&2
    exit 1
fi

# Sanity: RELEASES.json must have an entry for the current version
if [ ! -f "$REPO_ROOT/RELEASES.json" ]; then
    echo "ERROR: $REPO_ROOT/RELEASES.json missing." >&2
    exit 1
fi
if ! python3 -c "
import json,sys
v='$VERSION'
entries=json.load(open('$REPO_ROOT/RELEASES.json'))
assert any(e['version']==v for e in entries), f'no entry for {v}'
" 2>/dev/null; then
    echo "ERROR: RELEASES.json has no entry for version $VERSION." >&2
    echo "       Add one before releasing — it gets bundled and shown in-app." >&2
    exit 1
fi

# ─── 1) Tauri build (share-manager.app, signed) ─────────────
echo
echo "==> [1] cargo tauri build"
cd "$SM_DIR"
if [ ! -d node_modules ]; then
    npm install
fi
cargo tauri build --bundles app
SM_APP_SRC="$SM_DIR/src-tauri/target/release/bundle/macos/share-manager.app"
if [ ! -d "$SM_APP_SRC" ]; then
    echo "ERROR: share-manager.app not produced at $SM_APP_SRC" >&2
    exit 1
fi

# Always re-deep-sign with our explicit settings. Tauri's own signing
# behavior between cli versions has been inconsistent (sometimes ad-hoc,
# sometimes missing the timestamp), so we don't trust it. sign-app.sh
# is idempotent — re-running just replaces the signature.
echo "==> deep-sign share-manager.app via sign-app.sh (idempotent)"
sh "$HERE_SCRIPTS/sign-app.sh" "$SM_APP_SRC" "$SM_DIR/src-tauri/Entitlements.plist"

echo "==> final verify"
# Stash codesign output first — piping `codesign -dvv | grep -q` under
# `set -o pipefail` propagates SIGPIPE back to codesign as a non-zero
# exit, which is wrongly treated as a verify failure.
SIG_INFO="$(codesign -dvv "$SM_APP_SRC" 2>&1)"
if ! printf '%s\n' "$SIG_INFO" | grep -q "Authority=Developer ID Application"; then
    echo "ERROR: share-manager.app still lacks a Developer ID Authority line." >&2
    printf '%s\n' "$SIG_INFO" | head -10 >&2
    exit 1
fi

# ─── 2) Launcher build (signed) ─────────────────────────────
echo
echo "==> [2] launcher bundle.sh"
sh "$LAUNCHER_DIR/scripts/bundle.sh" release
LAUNCHER_APP_SRC="$LAUNCHER_DIR/dist/SendToWindowsLauncher.app"
if [ ! -d "$LAUNCHER_APP_SRC" ]; then
    echo "ERROR: SendToWindowsLauncher.app not produced at $LAUNCHER_APP_SRC" >&2
    exit 1
fi

# ─── 3) Stage both apps + Applications symlink ──────────────
echo
echo "==> [3] staging DMG payload at $STAGE"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$SM_APP_SRC"        "$STAGE/share-manager.app"
cp -R "$LAUNCHER_APP_SRC"  "$STAGE/SendToWindowsLauncher.app"
ln -s /Applications "$STAGE/Applications"

echo "==> [3] hdiutil create $DMG_NAME"
hdiutil create \
    -volname "Mac-Window Share $VERSION" \
    -srcfolder "$STAGE" \
    -ov \
    -format UDZO \
    "$DMG" > /dev/null

# ─── 4) Sign the DMG container ──────────────────────────────
echo
echo "==> [4] codesign DMG"
codesign --force \
    --sign "$APPLE_SIGNING_IDENTITY" \
    --timestamp \
    "$DMG"
codesign --verify --verbose=2 "$DMG"

# ─── 5+6) Notarize + staple ─────────────────────────────────
if [ "${SKIP_NOTARIZE:-0}" = "1" ]; then
    echo
    echo "==> [5+6] SKIPPED (SKIP_NOTARIZE=1)"
else
    echo
    echo "==> [5+6] notarize + staple"
    sh "$HERE_SCRIPTS/notarize.sh" "$DMG"
fi

# ─── 7+8) Updater artifacts ─────────────────────────────────
if [ "${SKIP_UPDATER:-0}" = "1" ]; then
    echo
    echo "==> [7+8] SKIPPED (SKIP_UPDATER=1)"
    echo
    echo "✓ DMG-only release: $DMG"
    exit 0
fi

if [ ! -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then
    echo "WARNING: TAURI_SIGNING_PRIVATE_KEY missing at $TAURI_SIGNING_PRIVATE_KEY_PATH" >&2
    echo "         Run mac_gui/scripts/setup-updater.sh first, or set SKIP_UPDATER=1." >&2
    exit 1
fi

echo
echo "==> [7] tar.gz the .app for updater"
TARBALL="$DIST/share-manager.app.tar.gz"
rm -f "$TARBALL" "$TARBALL.sig"
# Bundle from the freshly notarized + stapled .app inside the staged DMG
# payload (so the updater payload also carries the staple ticket).
( cd "$STAGE" && tar -czf "$TARBALL" share-manager.app )

echo "==> [7] minisign-sign the tarball"
# `cargo tauri signer sign` writes <file>.sig next to the input.
# --private-key-path loads from a file; --private-key takes a base64 string.
cargo tauri signer sign \
    --private-key-path "$TAURI_SIGNING_PRIVATE_KEY_PATH" \
    --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    "$TARBALL"

if [ ! -f "$TARBALL.sig" ]; then
    echo "ERROR: cargo tauri signer did not produce $TARBALL.sig" >&2
    exit 1
fi
SIG_CONTENT="$(cat "$TARBALL.sig")"

echo "==> [8] write latest.json manifest"
LATEST="$DIST/latest.json"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DOWNLOAD_URL="$UPDATER_RELEASES_URL/share-manager.app.tar.gz"

python3 - "$REPO_ROOT/RELEASES.json" "$LATEST" "$VERSION" "$NOW_ISO" \
        "$DOWNLOAD_URL" "$UPDATER_TARGET" "$SIG_CONTENT" <<'PY'
import json, sys
releases_path, out_path, version, now_iso, url, target, sig = sys.argv[1:8]
entries = json.load(open(releases_path))
entry = next((e for e in entries if e["version"] == version), None)
if entry is None:
    print(f"WARN: no RELEASES.json entry for {version}", file=sys.stderr)
    notes_md = ""
else:
    parts = [f"# {entry.get('title', version)}", ""]
    for h in entry.get("highlights", []):
        parts.append(f"- {h}")
    if entry.get("notes"):
        parts.append("")
        parts.append(entry["notes"])
    notes_md = "\n".join(parts)

manifest = {
    "version": version,
    "notes": notes_md,
    "pub_date": now_iso,
    "platforms": {
        target: {
            "signature": sig,
            "url": url,
        },
    },
}
with open(out_path, "w") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"    wrote {out_path}")
PY

echo
echo "✓ release artifacts in $DIST/"
echo "    $DMG_NAME"
echo "    share-manager.app.tar.gz"
echo "    share-manager.app.tar.gz.sig"
echo "    latest.json"
echo
echo "Next: upload all four to a GitHub Release named v$VERSION:"
echo
echo "  gh release create v$VERSION \\"
echo "      $DIST/$DMG_NAME \\"
echo "      $DIST/share-manager.app.tar.gz \\"
echo "      $DIST/share-manager.app.tar.gz.sig \\"
echo "      $DIST/latest.json \\"
echo "      --title \"v$VERSION\" \\"
echo "      --notes-from-tag"
