#!/bin/sh
# install.sh — SendToWindows.app을 ~/Applications에 배치하고,
# 바탕화면에는 그 .app을 가리키는 symlink(=Finder alias 동등)을 만든다.
# macOS Services 캐시도 갱신해서 Finder/ForkLift 우클릭에 "Windows로 보내기" 추가.
#
# 핵심: 단일 source of truth는 ~/Applications/SendToWindows.app.
#       바탕화면의 SendToWindows.app은 symlink → 매 install마다 자동으로 최신 빌드 가리킴.
#       즉 install.sh 한 번 = 두 위치 동시 최신화.
#
# 사용:
#   sh scripts/install.sh                     # release 빌드+번들+설치+desktop symlink
#   sh scripts/install.sh --no-build          # 이미 빌드된 dist/ 사용
#   sh scripts/install.sh --no-desktop        # desktop symlink 만들지 않음
#   sh scripts/install.sh --uninstall         # 전부 제거 (Apps + desktop)

set -e

cd "$(dirname "$0")/.."
APP_NAME="SendToWindows"
APPS_DIR="$HOME/Applications"
TARGET="$APPS_DIR/${APP_NAME}.app"
DESKTOP="$HOME/Desktop"
DESKTOP_LINK="$DESKTOP/${APP_NAME}.app"
BUILT="dist/${APP_NAME}.app"
BUNDLE_ID="com.shareguard.sendtowindows"

# 파싱: --no-build / --no-desktop / --no-system-link / --uninstall
SKIP_BUILD=0
SKIP_DESKTOP=0
SKIP_SYSTEM=0
UNINSTALL=0
for arg in "$@"; do
    case "$arg" in
        --no-build)        SKIP_BUILD=1 ;;
        --no-desktop)      SKIP_DESKTOP=1 ;;
        --no-system-link)  SKIP_SYSTEM=1 ;;
        --uninstall)       UNINSTALL=1 ;;
        -h|--help)
            sed -n '2,15p' "$0"
            exit 0 ;;
        *)
            echo "Unknown flag: $arg" >&2
            echo "Usage: $0 [--no-build] [--no-desktop] [--no-system-link] [--uninstall]" >&2
            exit 64 ;;
    esac
done

# ─── Uninstall ───
if [ "$UNINSTALL" -eq 1 ]; then
    SYS_LINK="/Applications/${APP_NAME}.app"
    if [ -d "$TARGET" ] || [ -L "$TARGET" ]; then
        echo "==> 제거: $TARGET"
        rm -rf "$TARGET"
    fi
    if [ -L "$DESKTOP_LINK" ] || [ -d "$DESKTOP_LINK" ] || [ -f "$DESKTOP_LINK" ]; then
        echo "==> 제거: $DESKTOP_LINK"
        rm -rf "$DESKTOP_LINK"
    fi
    if [ -L "$SYS_LINK" ]; then
        echo "==> 제거: $SYS_LINK (sudo 필요)"
        sudo rm -f "$SYS_LINK"
    fi
    echo "==> Services 캐시 flush"
    /System/Library/CoreServices/pbs -flush 2>&1 | head -3 || true
    echo "✓ 제거 완료 (Launch Services 캐시는 다음 재로그인 시 자동 정리)"
    exit 0
fi

# ─── Build (옵션) ───
if [ "$SKIP_BUILD" -eq 0 ]; then
    echo "==> 빌드 + 번들"
    sh scripts/bundle-app.sh release
fi

if [ ! -d "$BUILT" ]; then
    echo "ERROR: $BUILT 없음. 먼저 bundle-app.sh 실행." >&2
    exit 1
fi

# ─── ~/Applications에 배치 (canonical 위치) ───
mkdir -p "$APPS_DIR"
if [ -d "$TARGET" ] || [ -L "$TARGET" ]; then
    echo "==> 기존 설치 제거: $TARGET"
    rm -rf "$TARGET"
fi
echo "==> 설치: $BUILT → $TARGET"
cp -R "$BUILT" "$TARGET"

# ─── Desktop symlink ───
if [ "$SKIP_DESKTOP" -eq 0 ]; then
    # 바탕화면에 이전 stale copy/링크가 있을 수 있음 — 어떤 형태든 제거 후 새 symlink
    if [ -L "$DESKTOP_LINK" ]; then
        echo "==> 기존 desktop symlink 갱신: $DESKTOP_LINK"
        rm -f "$DESKTOP_LINK"
    elif [ -d "$DESKTOP_LINK" ] || [ -f "$DESKTOP_LINK" ]; then
        echo "==> 기존 desktop 항목(copy)을 symlink로 대체: $DESKTOP_LINK"
        rm -rf "$DESKTOP_LINK"
    fi
    ln -s "$TARGET" "$DESKTOP_LINK"
    echo "    Desktop symlink: $DESKTOP_LINK → $TARGET"
fi

# ─── /Applications symlink (시스템 폴더; FDA 패널 default 위치) ───
# 첫 install 때만 sudo 필요 — symlink 한 번 만들면 ~/Applications가 갱신될 때
# 자동으로 같이 최신화됨. --no-system-link 로 끌 수 있음.
SYS_LINK="/Applications/${APP_NAME}.app"
if [ "$SKIP_SYSTEM" -eq 1 ]; then
    echo "==> /Applications symlink skip (--no-system-link)"
elif [ ! -e "$SYS_LINK" ] && [ ! -L "$SYS_LINK" ]; then
    echo "==> /Applications에 symlink 만들기 (sudo 한 번 필요 — FDA 패널 인식용)"
    if sudo -n true 2>/dev/null; then
        sudo ln -s "$TARGET" "$SYS_LINK" && \
            echo "    /Applications symlink: $SYS_LINK → $TARGET"
    else
        echo "    sudo 비번 입력 필요 (스킵하려면 Ctrl-C 후 --no-system-link):"
        sudo ln -s "$TARGET" "$SYS_LINK" && \
            echo "    /Applications symlink: $SYS_LINK → $TARGET"
    fi
elif [ -L "$SYS_LINK" ]; then
    actual=$(readlink "$SYS_LINK")
    if [ "$actual" = "$TARGET" ]; then
        echo "==> /Applications symlink 이미 정상 ($SYS_LINK)"
    else
        echo "==> WARN: /Applications symlink가 다른 곳을 가리킴: $actual"
        echo "       수정하려면: sudo rm '$SYS_LINK' && sh scripts/install.sh"
    fi
else
    echo "==> WARN: $SYS_LINK 가 실제 폴더/파일임. 수동 정리 후 재실행 필요."
fi

# ─── Launch Services + Service vendor 갱신 ───
echo "==> Launch Services 등록 (lsregister)"
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
    -f -R "$TARGET" >/dev/null 2>&1 || true

echo "==> Services 캐시 갱신 (pbs -update / -flush)"
/System/Library/CoreServices/pbs -update 2>&1 | head -3 || true
/System/Library/CoreServices/pbs -flush 2>&1 | head -3 || true

echo "==> 한 번 실행 (Service vendor 등록 트리거)"
open -g -j "$TARGET" || true
sleep 1
killall "$APP_NAME" 2>/dev/null || true

echo "==> Service 강제 활성화 (macOS 14+ 신규 서비스는 기본 비활성)"
SERVICE_KEY="${BUNDLE_ID} - Windows로 보내기 - handleSendService"
defaults write pbs NSServicesStatus -dict-add "$SERVICE_KEY" '{
    "enabled_context_menu" = 1;
    "enabled_services_menu" = 1;
    "presentation_modes" = {
        "ContextMenu" = 1;
        "ServicesMenu" = 1;
    };
}' 2>&1 | tail -3 || true

echo "==> 최종 캐시 flush + Finder 재시작 (메뉴 갱신)"
/System/Library/CoreServices/pbs -flush 2>&1 | head -3 || true
killall Finder 2>/dev/null || true

echo
echo "✓ 설치 완료"
echo "  canonical: $TARGET"
[ "$SKIP_DESKTOP" -eq 0 ] && echo "  desktop  : $DESKTOP_LINK (symlink)"
echo
echo "사용법:"
echo "  - 바탕화면 더블클릭 또는 Dock/Spotlight 'SendToWindows'"
echo "  - Finder/ForkLift 우클릭 → Services → 'Windows로 보내기'"
echo
echo "다음 빌드부터는 sh scripts/install.sh 한 번이면 양쪽 자동 갱신."
