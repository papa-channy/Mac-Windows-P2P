#!/bin/sh
# bundle-app.sh — Swift Package executable을 macOS .app 번들로 패키징.
#
# 사용:
#   sh scripts/bundle-app.sh                # release 빌드, dist/SendToWindows.app 생성
#   sh scripts/bundle-app.sh debug          # debug 빌드 (개발 중)
#
# 산출물: dist/SendToWindows.app (ad-hoc 서명됨)

set -e

cd "$(dirname "$0")/.."
CONFIG="${1:-release}"
APP_NAME="SendToWindows"
BUNDLE_ID="com.shareguard.sendtowindows"
DIST="dist"
APP="$DIST/${APP_NAME}.app"

echo "==> Building Swift package ($CONFIG)"
swift build -c "$CONFIG"

BIN_PATH="$(swift build -c "$CONFIG" --show-bin-path)/${APP_NAME}"
if [ ! -x "$BIN_PATH" ]; then
    echo "ERROR: binary not found at $BIN_PATH" >&2
    exit 1
fi

echo "==> Assembling app bundle: $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

cp "$BIN_PATH" "$APP/Contents/MacOS/${APP_NAME}"
chmod +x "$APP/Contents/MacOS/${APP_NAME}"
cp Resources/Info.plist "$APP/Contents/Info.plist"
echo -n "APPL????" > "$APP/Contents/PkgInfo"

# Icons (optional — 빌드 의존성 만들지 않기 위해 있을 때만 복사)
if [ -f Resources/AppIcon.icns ]; then
    cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
fi

echo "==> Codesigning"
# 우선순위:
#  1. Developer ID Application (시스템 신뢰 — TCC grant 영구)
#  2. Apple Development (Xcode 발급 — TCC grant 영구)
#  3. SendToWindows-Dev (self-signed, trust 필요)
#  4. ad-hoc (-) (CDHash 빌드마다 변동, TCC 매번 재프롬프트)
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
pick_identity() {
    security find-identity -p codesigning -v "$KEYCHAIN" 2>/dev/null \
        | awk -F'"' '/Developer ID Application:/ {print $2; exit}'
}
pick_dev_identity() {
    security find-identity -p codesigning -v "$KEYCHAIN" 2>/dev/null \
        | awk -F'"' '/Apple Development:/ {print $2; exit}'
}
pick_self_signed() {
    security find-identity -p codesigning "$KEYCHAIN" 2>/dev/null \
        | awk -F'"' '/SendToWindows-Dev/ && !/NOT_TRUSTED/ {print $2; exit}'
}

SIGN_IDENTITY="$(pick_identity)"
SIGN_KIND="Developer ID Application"
if [ -z "$SIGN_IDENTITY" ]; then
    SIGN_IDENTITY="$(pick_dev_identity)"
    SIGN_KIND="Apple Development"
fi
if [ -z "$SIGN_IDENTITY" ]; then
    SIGN_IDENTITY="$(pick_self_signed)"
    SIGN_KIND="self-signed (SendToWindows-Dev)"
fi

if [ -n "$SIGN_IDENTITY" ]; then
    echo "    Identity: $SIGN_IDENTITY"
    echo "    Kind:     $SIGN_KIND (TCC grant 영구 유지)"
    codesign --force --deep --sign "$SIGN_IDENTITY" \
             --identifier "$BUNDLE_ID" \
             --options runtime --timestamp=none \
             "$APP"
else
    echo "    Identity: ad-hoc (CDHash 빌드마다 변동 → TCC 매번 재프롬프트)"
    echo "    영구화: keychain에 Developer ID 또는 self-signed cert 추가"
    echo "             (sh scripts/create-signing-cert.sh, trust 별도 설정 필요)"
    codesign --force --deep --sign - \
             --identifier "$BUNDLE_ID" "$APP"
fi

echo "==> Verifying"
codesign --verify --verbose "$APP" 2>&1 | head -3 || true
spctl --assess --type execute "$APP" 2>&1 | head -3 || true

echo
echo "✓ Done: $APP"
echo "  Test launch:"
echo "    open '$APP' --args /path/to/some/file.txt"
