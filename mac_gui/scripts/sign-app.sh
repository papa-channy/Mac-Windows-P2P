#!/bin/sh
# sign-app.sh — deep-sign a .app bundle with Developer ID, Hardened Runtime,
# secure timestamp, and the supplied entitlements.
#
# Usage: sign-app.sh <App.app> <Entitlements.plist>
#
# Designed to be idempotent — running twice produces the same signed bundle.

set -e

if [ $# -lt 2 ]; then
    echo "Usage: $0 <App.app> <Entitlements.plist>" >&2
    exit 64
fi

APP="$1"
ENT="$2"

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/env.sh"

if [ ! -d "$APP" ]; then
    echo "ERROR: not a directory: $APP" >&2
    exit 1
fi
if [ ! -f "$ENT" ]; then
    echo "ERROR: entitlements missing: $ENT" >&2
    exit 1
fi
if [ -z "$APPLE_SIGNING_IDENTITY" ] || [ "$APPLE_SIGNING_IDENTITY" = "-" ]; then
    echo "ERROR: APPLE_SIGNING_IDENTITY is unset / ad-hoc — refusing to release-sign." >&2
    exit 1
fi

echo "==> sign deps (Frameworks, dylibs, helper executables) first"
# Sign every nested mach-O thing deepest-first so the final outer signature
# covers a consistent tree.
find "$APP/Contents" \
    \( -name "*.dylib" -o -name "*.so" -o -name "*.framework" \) \
    -print0 2>/dev/null | while IFS= read -r -d '' item; do
    echo "    sign: $item"
    codesign --force --options runtime --timestamp \
        --sign "$APPLE_SIGNING_IDENTITY" "$item"
done

# Sign any nested .app (e.g. helper apps inside Frameworks/)
find "$APP/Contents" -type d -name "*.app" 2>/dev/null | while IFS= read -r nested; do
    if [ "$nested" != "$APP" ]; then
        echo "    sign nested app: $nested"
        codesign --force --options runtime --timestamp \
            --entitlements "$ENT" \
            --sign "$APPLE_SIGNING_IDENTITY" "$nested"
    fi
done

echo "==> sign main bundle: $APP"
codesign --force \
    --options runtime \
    --timestamp \
    --entitlements "$ENT" \
    --sign "$APPLE_SIGNING_IDENTITY" \
    "$APP"

echo "==> verify"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=4 "$APP" || {
    echo "(spctl assess failed — likely because we haven't notarized + stapled yet)"
}

echo "✓ signed: $APP"
