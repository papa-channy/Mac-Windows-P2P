# mac_gui/scripts/ — release pipeline

`share-manager.app` 과 `SendToWindowsLauncher.app` 두 .app 을 Developer ID 로
서명하고, Apple 노타라이즈 서비스에 올린 뒤 staple 까지 자동화하는
스크립트 모음. 결과물은 단일 DMG — Mac 어디서든 다운로드 받아 더블클릭하면
Gatekeeper 가 무경고로 실행을 허용함.

## 한 번만 — 노타라이즈 자격증명 등록

```sh
sh mac_gui/scripts/setup-notary.sh
```

대화형으로 다음 두 값을 물어봄:

1. **Apple ID 이메일** (Developer Program 등록된 계정)
2. **app-specific password** — appleid.apple.com → Sign-In and Security →
   App-Specific Passwords 에서 발급. 그냥 Apple ID 비밀번호는 안 됨.

저장 위치: 로그인 keychain 의 `MAC_WINDOW_SHARE_NOTARY` 프로필 (이름은
`env.sh` 의 `APPLE_NOTARY_PROFILE` 로 변경 가능).

확인:
```sh
xcrun notarytool history --keychain-profile MAC_WINDOW_SHARE_NOTARY
```

## 매 릴리스마다

```sh
sh mac_gui/scripts/release.sh
```

`mac_gui/dist/mac-window-share-<version>.dmg` 가 떨어짐. 단계:

1. `cargo tauri build --bundles app` — share-manager.app, Tauri 가 직접 서명
2. `send-to-windows-launcher/scripts/bundle.sh release` — 런처 .app, 수동 서명
3. `hdiutil create` — 두 .app + Applications symlink 로 DMG 패키징
4. `codesign` — DMG 자체에 Developer ID 서명
5. `xcrun notarytool submit --wait` — Apple 노타라이즈 (5~30분 대기)
6. `xcrun stapler staple` — 티켓을 DMG 에 박아 오프라인 검증 가능하게

`SKIP_NOTARIZE=1 sh mac_gui/scripts/release.sh` 로 5~6번 단계 생략 가능
(서명까지만 — Gatekeeper 는 거부함, 내부 테스트용).

## 환경 변수 (`env.sh` 기본값)

| 변수 | 기본값 |
|---|---|
| `APPLE_TEAM_ID` | `JJH9NPABP6` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: CHAN PARK (JJH9NPABP6)` |
| `APPLE_NOTARY_PROFILE` | `MAC_WINDOW_SHARE_NOTARY` |

다른 머신에서 빌드한다면 사전에 export 해서 덮어쓰면 됨.

## 개별 스크립트

| 파일 | 용도 |
|---|---|
| `env.sh` | 다른 스크립트들이 `.` 소싱하는 기본값 셋. 단독 실행 X. |
| `setup-notary.sh` | (한 번만) notarytool keychain 프로필 등록 |
| `sign-app.sh <App> <Entitlements>` | .app 하나를 Developer ID 로 deep-sign |
| `notarize.sh <artifact>` | .dmg / .pkg / .zip 를 노타라이즈 + staple |
| `release.sh` | 마스터 파이프라인 (위 모두 호출) |

## Entitlements

- `share-manager/src-tauri/Entitlements.plist` — WebKit JIT + 자식 프로세스
  실행 + 네트워크 클라이언트 (SMB, 추후 updater)
- `send-to-windows-launcher/Entitlements.plist` — 자식 프로세스 실행만 (Tauri
  본체를 spawn)

둘 다 **App Sandbox 안 씀** — Developer ID 직접배포는 sandbox 필수 아님.

## 트러블슈팅

- `errSecInternalComponent` 가 codesign 중에 뜸 → 보통 keychain 잠금. `security
  unlock-keychain` 후 재시도.
- 노타라이즈 거부 → 로그 보기: `xcrun notarytool log <submission-id>
  --keychain-profile MAC_WINDOW_SHARE_NOTARY`
- `Application is not signed with a valid Apple Developer ID` → tauri build
  실행 전에 `APPLE_SIGNING_IDENTITY` env 가 export 됐는지 확인. `release.sh`
  는 `env.sh` 를 소싱하지만, 직접 `cargo tauri build` 부르는 경우엔 수동.
