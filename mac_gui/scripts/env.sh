#!/bin/sh
# env.sh — defaults for the Apple Developer signing pipeline.
#
# Sourced by sign-app.sh / notarize.sh / release.sh. Override any value by
# exporting it before sourcing (these use `:=` so prior exports win).
#
# To inspect the values that will be used: `. mac_gui/scripts/env.sh && env | grep APPLE_`
#
# Discovered values for this machine (security find-identity -v -p codesigning):
#   - Identity: "Developer ID Application: CHAN PARK (JJH9NPABP6)"
#   - Team ID:  JJH9NPABP6
# Override APPLE_SIGNING_IDENTITY / APPLE_TEAM_ID before sourcing if these
# change.

: "${APPLE_TEAM_ID:=JJH9NPABP6}"
: "${APPLE_SIGNING_IDENTITY:=Developer ID Application: CHAN PARK (JJH9NPABP6)}"
: "${APPLE_NOTARY_PROFILE:=MAC_WINDOW_SHARE_NOTARY}"

# App Store Connect API key — preferred over app-specific password because
# keys are issued at the team level, bypassing any Apple ID / 2FA / agreement
# friction. setup-notary.sh stores these into the keychain profile, so
# notarize.sh only ever talks to --keychain-profile and doesn't see these
# variables again at release time.
#
# Generate via browser at: https://appstoreconnect.apple.com →
#   Users and Access → Integrations tab → App Store Connect API → +
#   (role: Developer or higher)
# Download the .p8 file ONCE and stash it in ~/.appstoreconnect/private_keys/
# (xcrun + altool + notarytool all auto-discover that location).
: "${ASC_API_KEY_PATH:=$HOME/.appstoreconnect/private_keys}"
: "${ASC_API_KEY_ID:=}"
: "${ASC_API_ISSUER_ID:=}"

# Tauri updater (minisign) — created by setup-updater.sh.
# Note the variable name: cargo tauri signer reads TWO different env vars:
#   - TAURI_SIGNING_PRIVATE_KEY       → base64-encoded key STRING
#   - TAURI_SIGNING_PRIVATE_KEY_PATH  → path to the key FILE
# We use the PATH variant. Don't ever set the bare _KEY var, or both flags
# get implied at the call site and clap rejects the conflict.
unset TAURI_SIGNING_PRIVATE_KEY
: "${TAURI_SIGNING_PRIVATE_KEY_PATH:=$HOME/.tauri/share-manager.key}"

# Updater manifest endpoint (where clients fetch latest.json).
: "${UPDATER_RELEASES_URL:=https://github.com/papa-channy/Mac-Windows-P2P/releases/latest/download}"
: "${UPDATER_TARGET:=darwin-aarch64}"

export APPLE_TEAM_ID APPLE_SIGNING_IDENTITY APPLE_NOTARY_PROFILE \
    ASC_API_KEY_PATH ASC_API_KEY_ID ASC_API_ISSUER_ID \
    TAURI_SIGNING_PRIVATE_KEY_PATH UPDATER_RELEASES_URL UPDATER_TARGET
