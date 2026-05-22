#!/bin/sh
# setup-updater.sh — one-time minisign keypair generation for the Tauri
# auto-updater.
#
# Output:
#   ~/.tauri/share-manager.key           (PRIVATE — never commit)
#   ~/.tauri/share-manager.key.pub       (PUBLIC — safe but committed via
#                                          tauri.conf.json)
#   tauri.conf.json `plugins.updater.pubkey` patched in-place
#
# Re-running this OVERWRITES the existing keypair. Every installed user
# would then reject signed updates because their compiled-in pubkey no
# longer matches. Don't re-run unless you accept that all users must
# manually install a fresh DMG.

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
MAC_GUI="$(cd "$HERE/.." && pwd)"
SM_DIR="$MAC_GUI/share-manager"
CONF="$SM_DIR/src-tauri/tauri.conf.json"

KEY_DIR="$HOME/.tauri"
KEY="$KEY_DIR/share-manager.key"
PUB="$KEY.pub"

if [ -f "$KEY" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "ERROR: $KEY already exists. Refusing to overwrite." >&2
    echo "       Re-run with FORCE=1 if you really want a fresh keypair" >&2
    echo "       (this invalidates updates for every existing user)." >&2
    exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

echo "==> generating minisign keypair"

# Password handling:
#   - WITH_PASSWORD=1   → prompt interactively (for users who want extra
#                         protection on the key file)
#   - TAURI_SIGNING_PRIVATE_KEY_PASSWORD env set → use that, non-interactive
#   - otherwise         → no password (--ci). The key file at $KEY is
#                         already chmod 600 inside $HOME, which is the same
#                         protection an Apple certificate gets.
if [ "${WITH_PASSWORD:-0}" = "1" ]; then
    cargo tauri signer generate -w "$KEY"
elif [ -n "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" ]; then
    cargo tauri signer generate -w "$KEY" -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" --ci
else
    cargo tauri signer generate -w "$KEY" -p "" --ci
fi

if [ ! -f "$PUB" ]; then
    echo "ERROR: public key $PUB was not created by cargo tauri signer." >&2
    exit 1
fi
chmod 600 "$KEY"
chmod 644 "$PUB"

PUB_CONTENT="$(cat "$PUB")"

echo
echo "==> patching $CONF with new pubkey"
python3 - "$CONF" "$PUB_CONTENT" <<'PY'
import json, sys
conf_path, pub = sys.argv[1], sys.argv[2]
with open(conf_path) as f:
    conf = json.load(f)
conf.setdefault("plugins", {}).setdefault("updater", {})["pubkey"] = pub
with open(conf_path, "w") as f:
    json.dump(conf, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("    patched plugins.updater.pubkey")
PY

cat <<EOF

✓ Done.

Private key:   $KEY
Public key:    $PUB  (also committed into tauri.conf.json)

Next steps:
  1. Commit the tauri.conf.json change:
     git add $CONF
     git commit -m "updater: install minisign pubkey"

  2. For releases, export the password before running release.sh:
     export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY"
     export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<your password>

  3. Or store the password in keychain to avoid retyping:
     security add-generic-password -s tauri-signing -a $USER -w
     (then in env.sh add: export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\$(security find-generic-password -s tauri-signing -w))
EOF
