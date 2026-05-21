#!/bin/sh
# setup-notary.sh — bootstrap the notarytool keychain profile.
#
# Two supported methods:
#
#   (A) App Store Connect API key  ← DEFAULT, recommended
#       • Generated in your browser at appstoreconnect.apple.com
#       • Bound to the team, NOT to an Apple ID — sidesteps password / 2FA
#         issues, account membership confusion, and "pending agreements"
#         401s entirely.
#       • Download the .p8 ONCE; subsequent CLI use is keyless from the
#         user's perspective.
#
#   (B) App-specific password         (legacy fallback)
#       • Use only if API key creation is unavailable (e.g. team owner
#         hasn't granted you Admin / API access yet).
#       • Set NOTARY_METHOD=password to choose this.
#
# Both methods end up stored into the same keychain profile
# ($APPLE_NOTARY_PROFILE, default MAC_WINDOW_SHARE_NOTARY); release.sh and
# notarize.sh don't care which method was used.

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/env.sh"

METHOD="${NOTARY_METHOD:-apikey}"

echo "======================================================="
echo "  notarytool credentials setup"
echo "  team id:      $APPLE_TEAM_ID"
echo "  profile name: $APPLE_NOTARY_PROFILE"
echo "  method:       $METHOD"
echo "======================================================="
echo

case "$METHOD" in
    apikey|api-key|key)
        # ─── (A) App Store Connect API key ──────────────────
        cat <<EOF
Steps to generate the API key (browser):

  1. Log in to https://appstoreconnect.apple.com  (any Apple ID with
     access to team $APPLE_TEAM_ID — owner / admin / app-manager)
  2. Top nav → "Users and Access" → "Integrations" tab
  3. "App Store Connect API" section → click  +  (next to "Active")
  4. Name: e.g. "mac-window-share-notary"
     Access: Developer (or higher — but Developer is enough for notary)
  5. Click "Generate". You will see exactly ONE chance to download the
     .p8 file — download it.
  6. From the same page, copy:
       • Key ID      (10-char, e.g.  ABCD12EF34)
       • Issuer ID   (uuid form, e.g.  69a6de7c-...-1f2b)
  7. Move the .p8 file into the standard location:
       mkdir -p ~/.appstoreconnect/private_keys
       mv ~/Downloads/AuthKey_<KEYID>.p8 ~/.appstoreconnect/private_keys/

After that, run this script again with the IDs exported:

  export ASC_API_KEY_ID=ABCD12EF34
  export ASC_API_ISSUER_ID=69a6de7c-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  sh mac_gui/scripts/setup-notary.sh

EOF
        if [ -z "$ASC_API_KEY_ID" ] || [ -z "$ASC_API_ISSUER_ID" ]; then
            echo "ASC_API_KEY_ID / ASC_API_ISSUER_ID are not set."
            echo "Follow the steps above first, then re-run this script with"
            echo "those two values exported."
            exit 64
        fi

        KEYFILE="$ASC_API_KEY_PATH/AuthKey_${ASC_API_KEY_ID}.p8"
        if [ ! -f "$KEYFILE" ]; then
            echo "ERROR: .p8 file missing at $KEYFILE" >&2
            echo "       move it there or export ASC_API_KEY_PATH to its directory." >&2
            exit 1
        fi
        chmod 600 "$KEYFILE"

        echo "==> storing API key into keychain profile '$APPLE_NOTARY_PROFILE'"
        xcrun notarytool store-credentials "$APPLE_NOTARY_PROFILE" \
            --key "$KEYFILE" \
            --key-id "$ASC_API_KEY_ID" \
            --issuer "$ASC_API_ISSUER_ID"

        echo
        echo "==> sanity check (history call should auth and return — empty list is OK)"
        if xcrun notarytool history --keychain-profile "$APPLE_NOTARY_PROFILE" >/dev/null 2>&1; then
            echo "✓ credentials accepted. ready to release."
        else
            echo "✗ history call failed. Re-run and double-check the IDs." >&2
            exit 1
        fi
        ;;

    password|app-specific|asp)
        # ─── (B) App-specific password ──────────────────────
        cat <<EOF
You will be prompted for:
  - Apple ID email   (must be a user with Developer+ access to team $APPLE_TEAM_ID)
  - app-specific password from appleid.apple.com → Sign-In and Security

NOTE: this method depends on the Apple ID, its 2FA state, and any
pending Developer Program agreements. If you hit "Invalid credentials"
with what you know is a correct password, switch to the API key method
(default — re-run without NOTARY_METHOD=password).

EOF
        xcrun notarytool store-credentials "$APPLE_NOTARY_PROFILE" \
            --team-id "$APPLE_TEAM_ID"
        ;;

    *)
        echo "ERROR: unknown NOTARY_METHOD: $METHOD" >&2
        echo "       use 'apikey' (default) or 'password'." >&2
        exit 64
        ;;
esac

echo
echo "✓ stored under keychain profile: $APPLE_NOTARY_PROFILE"
echo "  inspect with:"
echo "    xcrun notarytool history --keychain-profile $APPLE_NOTARY_PROFILE"
