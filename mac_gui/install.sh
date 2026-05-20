#!/bin/sh
# install.sh — install Mac-Window_Share GUI + LaunchAgent on this Mac.
#
# Idempotent: re-running this updates everything from the share-side source.
# Requires: share is mounted (run "open smb://192.168.50.1/Mac-Window_Share" first
# and save credentials to keychain).

set -e

# Paths on the share (source of truth)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_CLI="$SCRIPT_DIR/mw"
SRC_APPLESCRIPT="$SCRIPT_DIR/MacWindowShare.applescript"
SRC_PLIST_TEMPLATE="$SCRIPT_DIR/com.shareguard.mw.mount.plist.template"

# Local install targets
LOCAL_LIB="$HOME/Library/Application Support/MacWindowShare"
LOCAL_LOGS="$HOME/Library/Logs/MacWindowShare"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_LABEL="com.shareguard.mw.mount"
LAUNCH_AGENT_PLIST="$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_LABEL.plist"
DESKTOP_APP="$HOME/Desktop/Mac-Window_Share.app"

# Sanity check
for f in "$SRC_CLI" "$SRC_APPLESCRIPT" "$SRC_PLIST_TEMPLATE"; do
    if [ ! -f "$f" ]; then
        echo "ERROR: missing source file: $f" >&2
        echo "  Is the share mounted?" >&2
        exit 1
    fi
done

echo "==> Creating local directories"
mkdir -p "$LOCAL_LIB" "$LOCAL_LOGS" "$LAUNCH_AGENT_DIR"

echo "==> Copying CLI to local cache: $LOCAL_LIB/mw"
cp "$SRC_CLI" "$LOCAL_LIB/mw"
chmod 755 "$LOCAL_LIB/mw"

echo "==> Rendering LaunchAgent plist"
sed "s|__HOME__|$HOME|g" "$SRC_PLIST_TEMPLATE" > "$LAUNCH_AGENT_PLIST"

echo "==> Building desktop app: $DESKTOP_APP"
rm -rf "$DESKTOP_APP"
/usr/bin/osacompile -o "$DESKTOP_APP" "$SRC_APPLESCRIPT"

echo "==> (Re)loading LaunchAgent"
# launchctl bootout/bootstrap for modern macOS; fall back to load/unload
if launchctl print "gui/$UID/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID" "$LAUNCH_AGENT_PLIST" 2>/dev/null || true
fi
launchctl bootstrap "gui/$UID" "$LAUNCH_AGENT_PLIST"
launchctl enable "gui/$UID/$LAUNCH_AGENT_LABEL" 2>/dev/null || true

echo
echo "✓ Installed."
echo "  CLI:          $LOCAL_LIB/mw"
echo "  Desktop App:  $DESKTOP_APP"
echo "  LaunchAgent:  $LAUNCH_AGENT_PLIST"
echo "  Logs:         $LOCAL_LOGS/"
echo
echo "Try:"
echo "  $LOCAL_LIB/mw status"
echo "  open '$DESKTOP_APP'"
