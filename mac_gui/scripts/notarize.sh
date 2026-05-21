#!/bin/sh
# notarize.sh — submit an artifact to Apple's notary service, wait for
# acceptance, then staple the ticket so the artifact verifies offline.
#
# Usage: notarize.sh <artifact>
#   <artifact> may be a .dmg, .pkg, or .zip. For a raw .app, zip it first.
#
# Requires: setup-notary.sh has been run once (keychain profile present).

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <artifact.dmg|.pkg|.zip>" >&2
    exit 64
fi

ARTIFACT="$1"

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/env.sh"

if [ ! -f "$ARTIFACT" ]; then
    echo "ERROR: artifact missing: $ARTIFACT" >&2
    exit 1
fi

echo "==> submit: $ARTIFACT"
echo "    profile: $APPLE_NOTARY_PROFILE"
echo "    (this typically takes 5–30 minutes; status streamed below)"
echo

xcrun notarytool submit "$ARTIFACT" \
    --keychain-profile "$APPLE_NOTARY_PROFILE" \
    --wait

case "$ARTIFACT" in
    *.dmg|*.pkg|*.app)
        echo "==> stapling ticket onto $ARTIFACT"
        xcrun stapler staple "$ARTIFACT"
        xcrun stapler validate "$ARTIFACT"
        ;;
    *.zip)
        echo "(note: .zip cannot be stapled — distribute the contents from"
        echo " the original signed .app/.dmg that *was* stapled instead.)"
        ;;
esac

echo "==> Gatekeeper assessment"
spctl --assess --type install --verbose=4 "$ARTIFACT" 2>&1 || \
    spctl --assess --type execute --verbose=4 "$ARTIFACT" 2>&1 || true

echo "✓ notarized + stapled: $ARTIFACT"
