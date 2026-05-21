#!/bin/sh
# install.sh — bundle + install SendToWindowsLauncher.app to ~/Applications
# and register its Service vendor with the system.
#
# After install, enable in: System Settings → Keyboard → Keyboard Shortcuts →
# Services → Files and Folders → "Windows로 보내기".

set -e

HERE="$(cd "$(dirname "$0")"/.. && pwd)"
DEST_DIR="$HOME/Applications"
APP_NAME="SendToWindowsLauncher.app"
DEST_APP="$DEST_DIR/$APP_NAME"

if [ "$1" = "--uninstall" ]; then
    echo "==> removing $DEST_APP"
    rm -rf "$DEST_APP"
    /System/Library/CoreServices/pbs -update 2>/dev/null || true
    echo "==> uninstalled. You may need to log out / in for the Service to disappear."
    exit 0
fi

sh "$HERE/scripts/bundle.sh" release
mkdir -p "$DEST_DIR"
rm -rf "$DEST_APP"
cp -R "$HERE/dist/$APP_NAME" "$DEST_APP"

echo "==> refreshing Services index"
/System/Library/CoreServices/pbs -update 2>/dev/null || true

cat <<EOF
==> installed: $DEST_APP

다음 단계:
  1) System Settings → Keyboard → Keyboard Shortcuts → Services
  2) "Files and Folders" 카테고리에서 "Windows로 보내기" 체크
  3) Finder에서 파일/폴더 우클릭 → Services → "Windows로 보내기"

share-manager.app 도 /Applications 또는 ~/Applications 에 설치되어 있어야 합니다.
EOF
