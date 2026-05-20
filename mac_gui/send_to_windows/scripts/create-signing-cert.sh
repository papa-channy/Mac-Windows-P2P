#!/bin/sh
# create-signing-cert.sh — SendToWindows 빌드용 self-signed code-signing 인증서 생성.
#
# 한 번만 실행. 이후 bundle-app.sh가 이 인증서로 서명 → 매 빌드마다 같은 CDHash →
# macOS TCC가 "같은 앱"으로 인식 → Files/Folders 권한 grant가 영구 유지됨.
#
# 사용:
#   sh scripts/create-signing-cert.sh             # 신규 생성 (이미 있으면 skip)
#   sh scripts/create-signing-cert.sh --force     # 기존 인증서 제거 후 재생성
#   sh scripts/create-signing-cert.sh --remove    # 인증서만 제거 (bundle-app.sh 자동 ad-hoc fallback)
#
# 보안 노트:
#   - self-signed → 시스템 신뢰 없음 → Gatekeeper "확인되지 않은 개발자" 경고는 그대로
#   - 코드 진본성 검증 X. 로컬 개발/사용용. 배포용으론 Apple Developer ID 필요.

set -e

CERT_NAME="SendToWindows-Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cmd_remove() {
    # 기존 SHA-1로 식별해서 keychain에서 제거
    local sha
    sha=$(security find-certificate -c "$CERT_NAME" -Z "$KEYCHAIN" 2>/dev/null \
          | awk '/SHA-1 hash:/ {print $3}')
    if [ -n "$sha" ]; then
        security delete-identity -Z "$sha" "$KEYCHAIN" 2>/dev/null || true
        security delete-certificate -Z "$sha" "$KEYCHAIN" 2>/dev/null || true
        echo "✓ 기존 '$CERT_NAME' 인증서 제거"
    else
        echo "(제거할 인증서 없음)"
    fi
}

cmd_check() {
    if security find-identity -p codesigning -v "$KEYCHAIN" 2>/dev/null \
       | grep -q "$CERT_NAME"; then
        return 0
    fi
    return 1
}

cmd_create() {
    if cmd_check; then
        echo "✓ '$CERT_NAME' 인증서 이미 존재 (재생성하려면 --force)"
        security find-identity -p codesigning -v "$KEYCHAIN" | grep "$CERT_NAME"
        return 0
    fi

    echo "==> openssl로 키페어 + cert 생성 (Code Signing extKeyUsage 포함)"
    cat > "$TMPDIR/cert.conf" <<EOF
[req]
distinguished_name = req_dn
x509_extensions    = v3_ext
prompt             = no

[req_dn]
CN = $CERT_NAME
O  = Local Dev
OU = ShareGuard

[v3_ext]
basicConstraints       = critical, CA:false
keyUsage               = critical, digitalSignature
extendedKeyUsage       = critical, codeSigning
subjectKeyIdentifier   = hash
authorityKeyIdentifier = keyid:always
EOF

    openssl req -x509 -newkey rsa:2048 \
        -keyout "$TMPDIR/key.pem" \
        -out    "$TMPDIR/cert.pem" \
        -days   3650 -nodes \
        -config "$TMPDIR/cert.conf" >/dev/null 2>&1

    # macOS `security` 가 empty p12 password를 잘 처리 못 함 → 임시 패스워드 사용.
    P12_PASS="sg-tmp-$$"
    echo "==> PKCS#12 묶음으로 변환 (legacy 모드 — macOS security 호환)"
    openssl pkcs12 -export -legacy \
        -inkey "$TMPDIR/key.pem" \
        -in    "$TMPDIR/cert.pem" \
        -out   "$TMPDIR/identity.p12" \
        -macalg sha1 \
        -keypbe PBE-SHA1-3DES \
        -certpbe PBE-SHA1-3DES \
        -password "pass:$P12_PASS" 2>&1 | tail -3

    echo "==> 로그인 키체인에 import (codesign이 사용할 수 있도록)"
    security import "$TMPDIR/identity.p12" \
        -k "$KEYCHAIN" \
        -P "$P12_PASS" \
        -T /usr/bin/codesign \
        -T /usr/bin/security 2>&1 | tail -3

    echo "==> partition list 갱신 (codesign 접근 허용 — 비밀번호 묻기 회피)"
    # 일부 macOS 버전에서 추가 prompt 회피용
    security set-key-partition-list \
        -S apple-tool:,apple:,codesign: \
        -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || true

    if cmd_check; then
        echo ""
        echo "✓ 인증서 생성 완료"
        security find-identity -p codesigning -v "$KEYCHAIN" | grep "$CERT_NAME"
        echo ""
        echo "다음 빌드부터 bundle-app.sh가 이 인증서로 서명합니다."
        echo "이후 TCC 권한 grant는 빌드 간에 유지됩니다."
    else
        echo "✗ 인증서 등록 실패 (keychain 검색에서 안 보임)"
        exit 1
    fi
}

case "${1:-}" in
    --remove)    cmd_remove ;;
    --force)     cmd_remove; cmd_create ;;
    ""|--check)  cmd_create ;;
    *)           echo "Usage: $0 [--force|--remove|--check]" >&2; exit 64 ;;
esac
