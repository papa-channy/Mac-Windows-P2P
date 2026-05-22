#!/bin/sh
# bundle.sh — build SendToWindowsLauncher.app from the SPM target.
#
# Signing mode is controlled by the APPLE_SIGNING_IDENTITY env var:
#   - unset (or "-")  → ad-hoc signature (local dev only, not notarizable)
#   - "Developer ID Application: NAME (TEAMID)" → full hardened-runtime
#     codesign with entitlements + secure timestamp (notarizable)
#
# Usage: sh scripts/bundle.sh [release|debug]   (default: release)

set -e

CONFIG="${1:-release}"
HERE="$(cd "$(dirname "$0")"/.. && pwd)"
DIST="$HERE/dist"
APP="$DIST/SendToWindowsLauncher.app"
ENT="$HERE/Entitlements.plist"

cd "$HERE"
echo "==> swift build -c $CONFIG"
swift build -c "$CONFIG"

BIN_PATH="$(swift build -c "$CONFIG" --show-bin-path)"
BIN="$BIN_PATH/SendToWindowsLauncher"
if [ ! -x "$BIN" ]; then
    echo "ERROR: binary missing: $BIN" >&2
    exit 1
fi

echo "==> assembling .app at $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/"
cp "$HERE/Resources/Info.plist" "$APP/Contents/Info.plist"

IDENT="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "$IDENT" ] || [ "$IDENT" = "-" ]; then
    echo "==> ad-hoc codesign (dev only — not notarizable)"
    codesign --force --deep --sign - "$APP" || {
        echo "(ad-hoc codesign failed — Service may not register)" >&2
    }
else
    echo "==> Developer ID codesign: $IDENT"
    if [ ! -f "$ENT" ]; then
        echo "ERROR: missing entitlements at $ENT" >&2
        exit 1
    fi
    codesign --force \
        --options runtime \
        --timestamp \
        --entitlements "$ENT" \
        --sign "$IDENT" \
        "$APP"
    echo "==> verifying signature"
    codesign --verify --deep --strict --verbose=2 "$APP"
fi

echo "==> done: $APP"
