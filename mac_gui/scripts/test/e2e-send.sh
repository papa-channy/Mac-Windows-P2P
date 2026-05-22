#!/bin/sh
# e2e-send.sh — run the engine end-to-end against the real mounted share,
# verify all 4 artifacts (file + manifest + sidecar + log), then clean up.
#
# Skipped (exit 0) if /Volumes/Mac-Window_Share isn't mounted.

set -e

cd "$(dirname "$0")/../../share-manager/src-tauri"

if [ ! -d /Volumes/Mac-Window_Share ]; then
    echo "share not mounted at /Volumes/Mac-Window_Share — skipping"
    exit 0
fi

echo "==> cargo test e2e_send_against_real_share_if_mounted"
cargo test --lib e2e_send_against_real_share_if_mounted -- --nocapture
