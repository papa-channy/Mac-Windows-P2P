# v0.3.0 Release Runbook

Phase 4 의 step-by-step. 두 섹션:
1. **One-time notary setup** — `MAC_WINDOW_SHARE_NOTARY` keychain 프로필이
   없을 때 한 번만 실행 (현재 상태: ❌ 부재 → 필요)
2. **Release execution** — `release.sh` 파이프라인 + GitHub Release

`mac_gui/CLAUDE.md` 의 distribution playbook 과 일관. 자세한 배경은 CLAUDE.md.

---

## A. One-time notary setup (1회만)

기존 `MAC_WINDOW_SHARE_NOTARY` 키체인 프로필이 없거나 만료된 경우 실행.
한 번 끝나면 다시 안 해도 됨 (App Store Connect API key 가 팀에 영구 부여).

### A.1 App Store Connect API key 생성

- [ ] https://appstoreconnect.apple.com 로그인 (팀 `JJH9NPABP6` 접근권 필요)
- [ ] **Users and Access** → **Integrations** 탭 → **App Store Connect API**
- [ ] `+` 클릭 → New Key
  - Name: `mac-window-share-notary`
  - Access: **Developer**
- [ ] **Generate** 클릭
- [ ] **`.p8` 파일 즉시 다운로드** — Apple 이 1회만 보여줌. 놓치면 새 키 생성
- [ ] 같은 화면에서 표시되는 두 ID 복사:
  - **Key ID** (10자, 영숫자)
  - **Issuer ID** (UUID 형식)

### A.2 `.p8` 파일 배치

```bash
mkdir -p ~/.appstoreconnect/private_keys
mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/
chmod 600 ~/.appstoreconnect/private_keys/AuthKey_*.p8
```

### A.3 환경변수 export

```bash
export ASC_API_KEY_ID=<위에서 복사한 10자>
export ASC_API_ISSUER_ID=<위에서 복사한 UUID>
```

(영구화하려면 `~/.zshrc` 에 적어두기. 이 값들은 비밀이 아님 — `.p8` 파일이 비밀)

### A.4 키체인 프로필 시드

```bash
sh /Users/chan/Developer/OS/Mac-Windows-P2P/mac_gui/scripts/setup-notary.sh
```

(이 스크립트가 `xcrun notarytool store-credentials MAC_WINDOW_SHARE_NOTARY ...`
를 호출. macOS 가 키체인 접근 dialog 띄울 수 있음 — Always Allow)

### A.5 검증

```bash
xcrun notarytool history --keychain-profile MAC_WINDOW_SHARE_NOTARY
```

기대: exit 0 (이전 제출 이력이 비어 있으면 빈 표 출력. 이건 정상)
실패: auth error → A.3 의 env 값 재확인 → A.4 재실행

- [ ] **A.5 통과 확인 후 다음 섹션으로**

---

## B. Release execution

Phase 1 (version bump + RELEASES) + Phase 2 (통합 테스트 통과) +
Phase 3 (UI 시각 검수 통과) 완료된 상태에서 실행.

### B.1 사전 검증

```bash
grep '"version"' /Users/chan/Developer/OS/Mac-Windows-P2P/mac_gui/share-manager/src-tauri/tauri.conf.json \
                /Users/chan/Developer/OS/Mac-Windows-P2P/mac_gui/share-manager/package.json
```
- [ ] 둘 다 `"version": "0.3.0"` 표시

```bash
python3 -c "import json; e=json.load(open('/Users/chan/Developer/OS/Mac-Windows-P2P/RELEASES.json')); assert e[0]['version']=='0.3.0', e[0]['version']; print('RELEASES.json OK')"
```
- [ ] `RELEASES.json OK` 출력

### B.2 (권장) Git 태그

bump commit 이 origin 에 push 된 후 태그 생성:

```bash
cd /Users/chan/Developer/OS/Mac-Windows-P2P
git tag -a v0.3.0 -m "v0.3.0"
```

(태그는 release.sh 후 push — B.6)

### B.3 파이프라인 실행

```bash
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
# (minisign 키에 비밀번호 안 걸었으면 빈 값. 걸었다면 그 값을 export)

sh /Users/chan/Developer/OS/Mac-Windows-P2P/mac_gui/scripts/release.sh
```

예상 소요: 10–30분. Apple notary 대기가 지배 (보통 1–10분, 최악 30분).
스크립트가 다음을 차례로 수행:
1. Pre-flight sanity (인증서 / `~/.tauri/share-manager.key` / RELEASES entry 매칭)
2. `cargo tauri build` (Tauri release 빌드)
3. `sign-app.sh` — share-manager.app 깊은 사인
4. SendToWindowsLauncher.app 빌드 + 사인 (`send-to-windows-launcher/scripts/bundle.sh release`)
5. DMG 생성 (`hdiutil`) + DMG 자체 사인
6. `notarize.sh` — Apple 노타리 제출 + `--wait` + 결과 stapler
7. 업데이터용 `share-manager.app.tar.gz` + minisign 서명 (`.sig`)
8. `latest.json` 매니페스트 작성

성공 시 스크립트 끝에 다음 출력:
```
✓ mac-window-share-0.3.0.dmg
✓ share-manager.app.tar.gz + .sig
✓ latest.json
```

### B.4 산출물 확인

```bash
ls -la /Users/chan/Developer/OS/Mac-Windows-P2P/mac_gui/dist/
```

- [ ] `mac-window-share-0.3.0.dmg`
- [ ] `share-manager.app.tar.gz`
- [ ] `share-manager.app.tar.gz.sig`
- [ ] `latest.json`

빠진 파일이 있으면 release.sh 가 어디서 멈췄는지 stderr 확인 후 재실행.

### B.5 로컬 Gatekeeper 검증

DMG 마운트 → 앱 추출 → `/Applications` 로 복사 → 검증:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/share-manager.app
spctl --assess --type execute --verbose=4 /Applications/share-manager.app
xcrun stapler validate /Applications/share-manager.app
```

- [ ] 3개 명령 모두 "accepted" / "valid on disk" 같은 OK 메시지

실패 시: notary 가 stapling 실패 (네트워크 단절 등) 가능. release.sh 재실행
또는 `xcrun stapler staple /Applications/share-manager.app` 수동.

### B.6 Push commit + tag

```bash
cd /Users/chan/Developer/OS/Mac-Windows-P2P
git push origin main
git push origin v0.3.0
```

- [ ] `gh repo view --web` 에서 v0.3.0 태그 확인

### B.7 GitHub Release 생성

`RELEASES.json` 의 첫 entry 에서 자동으로 release notes 생성:

```bash
cd /Users/chan/Developer/OS/Mac-Windows-P2P

gh release create v0.3.0 \
  mac_gui/dist/mac-window-share-0.3.0.dmg \
  mac_gui/dist/share-manager.app.tar.gz \
  mac_gui/dist/share-manager.app.tar.gz.sig \
  mac_gui/dist/latest.json \
  --title "v0.3.0 — Git 대시보드 · Log Hub · 공유 클립보드" \
  --notes "$(python3 -c "
import json
e = [r for r in json.load(open('RELEASES.json')) if r['version'] == '0.3.0'][0]
print('# ' + e['title'] + '\n')
print('\n'.join('- ' + h for h in e['highlights']))
if e.get('notes'):
    print('\n' + e['notes'])
")"
```

- [ ] `gh release view v0.3.0` 에 4 산출물 모두 표시

### B.8 업데이터 endpoint 라이브 검증

```bash
curl -fsSL https://github.com/papa-channy/Mac-Windows-P2P/releases/latest/download/latest.json | jq .version
```

- [ ] 출력이 `"0.3.0"`

다른 라이브 검증 (기존 v0.2.4 설치 본에서):
- [ ] v0.2.4 앱을 띄움 → Settings → "지금 업데이트 확인" 클릭 → "0.3.0 사용 가능" 표시
- [ ] 업데이트 수락 → 자동 다운로드 + 재시작 → 사이드바에 "🌿 Git" 노출

### B.9 마무리

- [ ] `WORKLOG/2026-05-24.md` v0.3.0 ship 섹션의 SHA / 산출물 / release URL 채워넣기
- [ ] CHECKLIST.md 에 "Phase 4 done @ <date>" 한 줄 추가

---

## 트러블슈팅

### "no credentials" / notarytool 인증 실패
- A.5 가 통과했는지 재확인
- `xcrun notarytool store-credentials --list` 로 프로필 존재 확인
- API key 가 revoke 된 경우 A.1 부터 다시 (새 키 생성)

### codesign "errSecInternalComponent"
- macOS 가 키체인을 잠가놨거나 Touch ID 가 막힘
- 키체인 unlock: `security unlock-keychain ~/Library/Keychains/login.keychain-db`
- 또는 GUI 에서 키체인 잠금 해제

### "no Apple Developer ID Application certificate in keychain"
- `security find-identity -v -p codesigning` 으로 확인
- 인증서 만료 시 Apple Developer Portal 에서 갱신 + 키체인 import

### release.sh "RELEASES.json missing entry"
- `tauri.conf.json` version 과 RELEASES.json 첫 entry version 이 정확히 일치하는지 확인
- 양쪽 파일 다 0.3.0 이어야

### `latest.json` 다운로드 404
- 리포가 private 으로 변경됐는지 (CLAUDE.md known-issues): `gh repo view --json visibility -q .visibility` → `PUBLIC` 이어야

### Mac 측 v0.2.4 가 업데이트 못 잡음
- `~/Library/Application Support/share-manager/EventEmitter/` 의 updater 캐시 삭제 후 재시도
- 또는 v0.2.4 앱의 Settings → "확인 실패" 출력을 보고 어느 단계인지 진단

---

## 사후 체크

- [ ] 양 머신에서 새 0.3.0 으로 동작 확인 (다시 1.1 ~ 1.12 시나리오 sample 통과)
- [ ] (다음 릴리스 준비) `WORKLOG/<next-date>.md` 시작
