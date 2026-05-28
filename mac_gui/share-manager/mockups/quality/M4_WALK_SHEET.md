# M4-B Walk Sheet — 수동 검증 worksheet

[IMPL_STATUS.md](./IMPL_STATUS.md) §6 의 ⚠M 항목들을 **11 session × 5-20분**
으로 쪼갠 walk-through. 한 번에 다 할 필요 없음 — session 단위로 끝낸
뒤 IMPL_STATUS 갱신, 다음에 또.

## 사용법

1. **prerequisite** (§0) 한 번만
2. session 한 개 골라서 walk
3. 각 step 의 "→ Expected" 가 보이면 그 행의 leaf id 들에 체크 ☑
4. session 끝나면 §99 "통과 처리" 절차로 IMPL_STATUS.md 의 해당 leaf
   `✅A` → `✅ 2026-MM-DD chan` 으로 일괄 승격
5. 이상 발견 시 §98 "이슈 처리" 절차

walk 결과 기록 (sheet 의 ☑ + 이슈 메모) 은 본 파일 직접 편집 또는
별도 commit message 에 caption.

---

## §0. Prerequisite (한 번만)

**환경**:
- macOS Sonoma 14+ (Space follow / mDNS multicast 정확 검증)
- Mac 측 share-manager.app 설치되어 있어야 (release 빌드) — Service vendor 도 함께 설치
- 셰어 마운트 필요한 walk 는 SMB share (Windows host) 가 살아있어야

**앱 실행 두 모드**:
```sh
# 모드 A — dev server (frontend hot-reload, devtools 사용 가능)
cd mac_gui/share-manager && npm run tauri dev

# 모드 B — installed app (실 사용자 경로, 권한 / Service 검증)
open /Applications/share-manager.app
```

특정 session 은 dev / install 둘 중 하나 강제 (각 session header 에 명시).

**셰어 상태 확인**:
```sh
mount | grep smbfs   # 셰어 path 1 줄 보여야
```

마운트 안 돼 있으면 session B / I / J / K 일부 skip 가능.

---

## §1. Session A — App boot + 권한 onboarding

대상: 첫 실행 흐름. **모드 B (installed app)** 권장 — 권한 prompt 가
dev 에서는 안 뜸.

### Walk

```
1. (clean state 위해 한 번만)
   defaults delete com.shareguard.share-manager  # 모든 prefs reset
   rm -rf ~/Library/Application\ Support/com.shareguard.share-manager
   tccutil reset SystemPolicyAllFiles com.shareguard.share-manager

2. /Applications/share-manager.app 더블클릭
   → Expected: PermissionsOnboarding 모달 표시
      [☑ A-8-h welcome 분기, B-1-c PermissionsOnboarding, B-1-d gate, M-8-a perms gate]

3. 모달의 "전체 디스크 접근 허용" 버튼 클릭
   → System Settings 열림, share-manager 항목으로 점프
      [☑ B-1-b open_privacy_settings]

4. 토글 ON → 앱 prompt → 재시작 후 모달 사라짐
   → Expected: hasFullDiskAccess true
      [☑ B-1-a has_full_disk_access]

5. 다음 launch 부터 onboarding 모달 안 뜸 (re-entry 없음)
   → Expected: localStorage 의 permissions_onboarded = "1"
      [☑ K-3-b permissions_onboarded, M-8-a gate]

6. RELEASES.json 의 최신 entry version 이 last_seen_version 과 다르면 AnnouncementModal 표시
   → 첫 launch (last_seen 없음) → welcome variant
   → "확인" 누르면 last_seen_version = current
      [☑ A-8-d/e get_release_notes/current_app_version, A-8-f AnnouncementModal,
        A-8-g LAST_SEEN gate, K-3-a last_seen_version, M-8-b announcement gate]
```

### 통과 조건
- ☑ 9 leaves (B-1-a..d, A-8-d..h, K-3-a/b, M-8-a/b)
- onboarding 한 번만 뜨고 재진입 없음
- AnnouncementModal 한 번만 뜨고 dismiss 후 안 뜸

---

## §2. Session B — Inbox / Outbox / Archive UI

대상: 송수신 흐름의 시각 UI. **모드 A (dev)** OK.

### Sub-walk B.1 — 사이드바 navigation

```
1. 앱 시작. 사이드바 좌측 표시
   → Expected: pinned 상단 (Fast Forward / Notes / Clipboard) + scrollable 하단
      [☑ G-2-a Sidebar component, G-2-b pinned, G-2-c scrollable, G-1-b layout]

2. 사이드바 "In" 그룹 → Inbox / Sent / Archive 3 아이템
   → Expected: NAV_GROUPS 의 contract 와 일치
      [☑ G-2-d NAV_GROUPS, G-2-f DEFAULT_SELECTION, G-2-g SidebarSelection]

3. 각 그룹 chevron 토글 → 펼침/접힘
   → Expected: 부드러운 transition
      [☑ G-2-c, G-1-b]

4. 사이드바 영어 라벨 확인 (Inbox, Outbox, Archive)
      [☑ G-9-a]
```

### Sub-walk B.2 — ItemsView + DetailsModal

```
5. Inbox 선택 → ItemsView 표시 (없으면 빈 상태)
   → Expected: 빈 상태 메시지 + 카드 grid
      [☑ D-9-a ItemsView]

6. (필요시) Service 우클릭 또는 dev send 로 1 개 송신 후 Inbox 진입
   → 카드 클릭 → DetailsModal pop
      [☑ D-9-b DetailsModal, G-3-a Modal base]

7. DetailsModal 안 PreviewPanel — 확장자별 분기
   - .txt → 텍스트 미리보기
   - .png/.jpg → 이미지 (assetProtocol)
   - .pdf → PDF iframe
   - 기타 → "미리보기 없음" placeholder
      [☑ D-9-e PreviewPanel, D-13-a/b, B-13-a/b assetProtocol]

8. DetailsModal 의 verify badge 확인 (녹색 ✓ / 빨강 ✗)
      [☑ D-8-e verify_transfer, D-11-a/b]
```

### Sub-walk B.3 — Drop overlay + 송신 흐름

```
9. 임의 파일을 앱 윈도우로 drag-over
   → Expected: 화면 전체 covering DropOverlay 표시
      [☑ D-9-d / G-5-a DropOverlay, G-10-b dragging state, D-9-h useDragDrop]

10. drop → CategoryPickerModal 등장
    → Expected: 9 categories 표시
      [☑ D-9-c CategoryPickerModal, D-12-a CATEGORIES, G-6-g CategoryIcon]

11. .html 파일 + sibling .css/.js 가 있는 경로 drop
    → Expected: HtmlInspectorModal 가 sibling 검출 + 동봉 확인
      [☑ D-9-f HtmlInspectorModal, D-9-g useSendFlow, D-10-c inspect_html_assets]
```

### 통과 조건
- ☑ 23 leaves
- 모든 UI 가 깨짐 없이 표시, 인터랙션 응답 정상

---

## §3. Session C — Clipboard + Notes UI

대상: 클립보드 sticky 패널 + history + notes CRUD. **모드 A OK**.

### Walk

```
1. 사이드바 Clipboard 선택 → ClipboardView
   → Expected: 상단 SharedClipboardPanel (sticky, 양쪽 host 가 공유)
      [☑ E-8-a ClipboardView, E-8-b SharedClipboardPanel]

2. OS clipboard 에 텍스트 복사 (다른 앱에서 Cmd-C)
   → Expected: ~1s 후 history 상단에 entry 추가
      [☑ E-1-a start_poller, E-2-a append_entry, M-3-a poller cycle]

3. 이미지 (스크린샷 Cmd-Shift-4) 복사
   → Expected: history 에 image entry, content="📷 image (WxH, NN KB)"
   → Expected: thumb 표시 (asset protocol)
      [☑ E-2-b append_image_entry, E-3-a encode_png, E-4-a image_path_for_ref,
        L-3-a..d image entry v2 wire]

4. SharedClipboardPanel 의 "공유" 입력란에 텍스트 입력 + 저장
   → Expected: 양쪽 host 가 1.5s 내 동일 텍스트 표시
      [☑ E-6-a/b read/write_shared_clipboard, L-4-a SharedClipboardEntry,
        M-4-d clipboard-changed emit]

5. 사이드바 Notes 선택 → NotesView
   → "신규" 클릭 → title + body 입력 → 저장 → 리스트에 추가
   → 항목 클릭 → 편집 → 다시 저장 (last-write-wins)
   → 삭제 버튼 → 사라짐
      [☑ E-12-a NotesView, E-10-c/d save/delete, E-11-a..d notes commands,
        L-5-a NoteEntry]
```

### 통과 조건
- ☑ 17 leaves
- 클립보드 폴러가 1-2초 안에 OS clipboard 변화 감지
- shared clipboard 가 양쪽 host 에 round-trip

---

## §4. Session D — Settings 7 sections

대상: SettingsView 의 7 sub-section 각각. **모드 A OK**.

### Walk

```
1. 사이드바 Settings 진입 (기어 아이콘)
   → Expected: SettingsView shell + 좌측 7 section nav
      [☑ G-8-a SettingsView, G-12-c Provider stack]

2. Tree 섹션 → 디렉토리 깊이 슬라이더 (1-10), 적용
      [☑ G-8-b TreeSection]

3. Network 섹션 → "Scan SMB hosts" 클릭
   → Expected: 5-10초 내 발견된 Windows host 리스트 등장 (self 제외)
   → IP/hostname 표시
      [☑ G-8-c NetworkSection, C-2-a discover_smb_hosts,
        C-2-b mounted_smb_hosts, C-2-d Bonjour services]

4. (선택) "ping" 클릭 → check_connection 결과 표시
      [☑ C-3-a check_connection]

5. Policy 섹션 → JSON 편집 → 저장 → load 다시 → persist 확인
      [☑ G-8-d PolicySection, K-5-a..d, K-6-a..h]

6. Appearance 섹션 → 빌트인 테마 4종 미리보기
   → 외부 VSIX URL 입력 → "Install" → 5-30s 후 추가된 테마 활성화
      [☑ G-8-e AppearanceSection, K-7-a..f icon theme install]

7. Git 섹션
   - SSH 영역: "키 생성" → ~/.ssh/id_ed25519 + .pub 생성 확인
   - "내 SSH 공개키 셰어에 게시" → host pubkey 가 share 에 publish
      [☑ G-8-f GitSection, F-12-b SshSettings, F-3-a publish_host_pubkey,
        B-3-a/b ssh paths, K-3-c ssh.published]
   - PAT 영역: GitHub PAT 입력 → "테스트" 클릭 → "✓ <username> 인증 완료"
   - "삭제" → "토큰 없음" 상태로 복귀
      [☑ F-12-a TokenSettings, B-2-b/c/d set/has/clear_token, F-3-f test_token]

8. Notification 섹션
   - "활성화" 토글 → 5 event toggle (SendOk / SendFail / VerifyOk / VerifyFail / Clipboard)
   - "네이티브 알림" 토글 / Slack URL 입력 / "테스트 알림 보내기"
      [☑ G-8-g NotificationSection, K-4-h NotificationSettings struct]

9. Update 섹션
   - "지금 업데이트 확인" → "최신 버전입니다" 또는 "v0.x.y 사용 가능"
      [☑ G-8-h UpdateSection, A-7-e checkForUpdateDetailed]
```

### 통과 조건
- ☑ 25 leaves
- 각 section 진입 시 깨짐 없이 렌더
- Network Scan 이 mDNS multicast 정상 동작 (Local Network 권한 prompt 한 번 뜨면 OK)

---

## §5. Session E — Tree view + 송신

대상: 파일 탐색기 기반 송신. **모드 A OK**.

### Walk

```
1. 사이드바 "Tree" 또는 송신 진입점 → TreeView
   → Expected: home directory 부터 펼친 트리
      [☑ K-8-a TreeView, K-8-b list_directory, K-8-c build_tree, K-8-e home_directory]

2. 디렉토리 진입 / 상위 이동 / "선택" 버튼으로 pick_folder
      [☑ K-8-d parent_directory, K-8-g pick_folder]

3. 파일 우클릭 또는 "전송" → CategoryPickerModal → 카테고리 선택 → 송신
   → Expected: send_path 호출, 셰어에 manifest + payload 생성, Outbox 에 등장
      [☑ D-8-a send_path, D-1-a engine::send, D-2-a make_transfer_id,
        M-4-b transfers-changed emit]

4. drop zone 으로 drag-drop
      [☑ D-9-h useDragDrop integration]
```

### 통과 조건
- ☑ 9 leaves
- 송신 완료 후 셰어에 manifest + payload 가 실제로 생성됨 (Finder 로 확인)

---

## §6. Session F — Git Dashboard (L1 / L2 / L3)

대상: GitView 의 3-tier UI 전체. **모드 A OK**. PAT + 1+ git repo 가 사전 필요.

### Walk

```
1. 사이드바 Git 진입 → GitView L1
   → Expected: scan 완료된 repo 카드 grid
   → 카드 마다 ThreeNodeBridge (Mac · Win · GitHub) 노드 SHA + dirty count
      [☑ F-8-a GitView, F-8-b RepoCard, F-8-c ThreeNodeBridge, F-8-d gitStore,
        F-13-a/b BrandIcons, F-1-c scan_and_publish_git]

2. GitToolbar "Scan Now" 클릭
   → Expected: ~5s 내 완료, "[2분 전] N repos scanned, M with changes" strip 표시
      [☑ F-11-a GitToolbar, F-1-c rayon parallel, F-1-a..l scan helpers]

3. 카드 클릭 → GitDetailModal (L2)
   → Expected: 3 swimlane (Mac / GitHub / Win) + Sync Timeline + ConnectorBar
      [☑ F-9-a GitDetailModal, G-11-c/d ADR-0003/4]

4. L2 안 "Inspector" 버튼 → GitInspectorModal (L3)
   → 5 tab 확인:
   a. Raw diffs tab — git_file_diff 결과 표시
      [☑ F-10-c RawDiffsTab, F-2-g git_file_diff]
   b. Daemon logs tab — 80_Logs/error.jsonl 표시
      [☑ F-10-d DaemonLogsTab]
   c. Git config tab — .git/config 표시
      [☑ F-10-e GitConfigTab, F-2-f git_config_read]
   d. All commits tab — 커밋 history 풀 리스트
      [☑ F-10-f AllCommitsTab, F-2-e list_git_logs]
   e. Sync Timeline tab — 시간 축 위 commit 노드 graph
      [☑ F-10-g SyncTimelineTab, F-5-f build_repo_graph]

5. L2 의 GitOpsBar (Fetch/Pull/Push/Stash/Stash Pop)
   - 깨끗한 repo 에서 Fetch → "[방금] up to date" strip
      [☑ F-11-b GitOpsBar, F-7-c git_op_fetch, F-7-a run_git_op]
   - dirty repo 에서 Pull / Push / Stash 동작 + 결과 strip
      [☑ F-7-d/e/f/g, B-2-a/e keyring]
   - branch list (drop-down) 가져오기
      [☑ F-7-h git_list_branches]

6. CheckRunBadge — PAT 설정된 repo + 최근 commit 에 CI 가 있으면 표시
   → 색상: ✓ green / ✗ red / 🕐 yellow / ⊝ gray
      [☑ F-10-b CheckRunBadge, F-6-a fetch_check_runs, F-6-b classify, L-12-a]
```

### 통과 조건
- ☑ 24 leaves
- L1 → L2 → L3 흐름이 끊김 없이 동작
- GitOpsBar 결과 strip 이 toast 사라진 후에도 살아있음 (T52 fix)
- 한계 발견 (push 거절 hang 등) → SP-F-3 reference 확인

---

## §7. Session G — Updater + Announcement (선택)

대상: 새 버전 배포 흐름. **모드 B 필요** — 실제 update 흐름.

### Walk

```
A. (앱 내) Settings → Update → "지금 업데이트 확인"
   → 최신이면 "최신 버전입니다"
   → 새 버전 있으면 UpdaterBanner 상단 등장
      [☑ A-7-d/e/f UpdaterBanner]

B. UpdaterBanner "지금 설치" 클릭
   → 다운로드 progress %
   → 완료 시 앱 재시작 (성공) 또는 에러 → "DMG 직접 다운로드" 변환
      [☑ A-7-g DMG fallback]

C. "DMG 다운로드" 클릭 → 브라우저로 GitHub release DMG 다운로드 시작
      [☑ A-7-g openDmg]

D. "릴리스 노트" 클릭 → GitHub releases 페이지 오픈
      [☑ A-7-g openReleasesPage]
```

### 통과 조건
- ☑ 3 leaves
- 자동 설치 silent fail 시 DMG fallback 으로 우회 가능
- (SP-A-1 root cause 미해결 — 자동 설치 실패해도 ✅ 처리 OK, fallback 동작이 contract)

---

## §8. Session H — Logs UI + 실 알림

대상: Log Hub UI + 알림 dispatch 실 trigger. **모드 A OK**.

### Walk

```
1. 사이드바 Log Hub group → 5 카테고리 (Send / Recv / Error / Worklog / Compressed)
      [☑ G-2-c Log Hub group, G-2-e LOG_CATEGORIES, I-2-a LogsView]

2. Send 카테고리 → 최근 송신 entry 들 (host/ts/transfer_id/result)
   → Recv / Error / Worklog 도 동일
      [☑ I-1-d list_log_entries, L-16-a/b/c LogEntry wire]

3. Compressed 카테고리 → 이미지 thumb grid (E-4-c 결과)
      [☑ I-2-b Compressed gallery]

4. (실 알림 trigger) 송신 1 회 실행
   → Native banner 표시 ("✓ Windows로 전송 완료" 또는 실패 메시지)
      [☑ H-2-a/b/c native notif]

5. (Slack 설정 후) 같은 송신 → Slack 채널에 "*<title>*\n<body>" 메시지 도착
      [☑ H-3-a post_webhook, H-3-b SlackPayload]

6. Notification 토글 OFF → 송신 → 알림 안 옴
      [☑ H-4-a/b dispatch/allowed]
```

### 통과 조건
- ☑ 11 leaves
- 5 카테고리 모두 데이터 표시 (없는 카테고리는 empty state)
- 알림 dispatch 가 실제로 Slack/native 양쪽 도착

---

## §9. Session I — Lifecycle / 백그라운드

대상: watcher / 이벤트 / Space follow / 데스크탑 alias. **모드 B 권장**
(install 흐름과 dock click 검증).

### Walk

```
1. 앱 첫 launch (clean install) 후 ~/Desktop 확인
   → ~/Desktop/share-manager.app → /Applications/share-manager.app symlink 존재
      [☑ M-6-a ensure_on_first_launch, M-6-h symlink contract]

2. (수동) "alias 삭제" 명령 후 다시 만들기 (Settings 또는 dev 명령)
      [☑ M-6-b/c install/remove, M-6-d/g status]

3. Mission Control 으로 다른 Space 로 이동
   → Dock 의 share-manager 아이콘 클릭
   → Expected: 윈도우가 현재 Space 로 따라옴 (이전 Space 로 가지 않음)
      [☑ B-11-a apply_macos_space_behavior, B-11-b bitmask,
        M-1-f Reopen handler, M-7-b 적용 시점]

4. 두 번째 launch (open 두 번)
   → Expected: 두 번째 프로세스 안 뜸, 기존 윈도우 활성화
      [☑ M-7-a single-instance hook]

5. (셰어 마운트 상태에서) Finder 로 셰어에 새 파일 추가
   → 5초 내 앱 frontend 의 Inbox 가 자동 refresh
      [☑ M-2-a..e watcher, M-4-a share-changed emit, M-4-b transfers-changed,
        M-5-a useShareTopic listener]

6. 새 Inbox 항목이 → 자동 verify sweep 후 녹색 ✓
      [☑ M-9-a auto-verify sweep, D-8-f auto_verify_pending]

7. (마운트 해제 상태에서) 송신 시도
   → ensure_mounted 호출 → 마운트 회복 또는 에러 메시지
      [☑ C-1-c ensure_mounted]
```

### 통과 조건
- ☑ 14 leaves
- Space follow 가 즉시 동작 (지연 없음)
- watcher 가 OS 알림 (notify crate) 또는 polling fallback 으로 변화 감지

---

## §10. Session J — PAT cross-host sync (선택, 두 번째 Mac 필요)

대상: B-10 + F-3 + L-13 wire 의 실 round-trip. **두 host 가 같은 셰어 마운트**.

### Walk

```
1. Host A (이 Mac) — Settings → Git → SSH 키 생성 → "공개키 게시"
   → 셰어의 00_System/10_Config/git-keys/<hostA>.pub 작성
      [☑ F-3-a publish_host_pubkey, B-10-b host pubkey publication]

2. Host A — Settings → Git → PAT 입력 + 테스트 통과
   → "다른 host 에 PAT 공유" 클릭
   → 셰어의 git-token/<peerHostB>.age 파일 작성 (B 의 ssh 공개키로 암호화)
      [☑ F-3-c share_pat_to_peers, B-10-a age ssh, L-13-a/b/c PAT share schema]

3. Host B (다른 Mac) — 앱 launch
   → gitStore.tsx 의 pullPatFromShare auto-import 호출
   → host B 의 ssh 개인키로 decrypt → keyring 저장
   → "토큰 있음" 상태 (B-2-c git_has_token = true)
      [☑ F-3-d git_pull_pat_from_share, F-3-g auto-import]

4. Host B — Git 대시보드 진입 → remote fetch 가 host A 의 PAT 로 동작
      [☑ F-5-d github_fetch_remote]

5. (양쪽) Service vendor 우클릭 → Windows로 보내기 (다른 host 가 Windows 라면)
      [☑ N-1-a..f Service vendor end-to-end]
```

### 통과 조건
- ☑ 8 leaves
- PAT 가 두 host 에 모두 활성화됨, 양쪽 GitHub fetch 가 같은 권한 으로 동작
- B 의 ssh 개인키 없으면 decrypt 실패 → 안전

---

## §11. Session K — Cross-OS L5 walk (선택, Windows 필요)

대상: INTEGRATION_TEST.md 미수행 시나리오 1/2/6/7/10/12. **Mac + Windows
동시 실행**.

### Walk

[INTEGRATION_TEST.md](./INTEGRATION_TEST.md) 의 12 시나리오 표 참조. M3 에서
walked 된 3/4/5/8/9/11 외 6 시나리오를 양쪽 동시 walk.

각 시나리오마다 Pass-Fail + Observed 기록.

### 통과 조건
- ☑ J-5-a partial → 12/12 walked 시 ✅
- 각 시나리오 검증되는 leaf 는 INTEGRATION_TEST 의 "verify" 컬럼 참조

---

## §98. 이슈 처리 흐름

walk 중 expected 안 보임 / 동작 이상 발견 시:

```
1. 어느 step / leaf 인지 식별 (예: §6 step 5b "git_op_push 가 hang")
2. CODE_MAP 의 해당 leaf 위치 확인 (예: F-7-e — git.rs:627)
3. IMPL_STATUS.md 갱신:
   a. Spotlight (§4) 에 새 SP-* 블록 추가
   b. 해당 leaf Status: `impl` → `partial` 로 demote
   c. 매트릭스에서 ✅A → ⚠M (M4-B 미통과)
4. Cross-OS 영향 있으면 §5 backport 백로그 갱신
5. 새 Task 추가 (TaskCreate) — fix 작업 추적
```

예시 워크플로우:

```
사용자: "F-7-e push 가 conflict 시 hang 함"
→ IMPL_STATUS.md §4 에 SP-F-3 (이미 있음) 의 cross-ref Task 추가
→ Task 신설: "[F-7-e] Push conflict 시 stderr parse + UI 분기"
→ 매트릭스 F-7-e 의 Verified: ⚠M (이미 partial 이라 ⚠M 유지)
```

## §99. 통과 처리 흐름

session 한 개 walk 끝나면:

```
1. 본 sheet 의 해당 session 의 모든 ☑ 체크 (또는 사용자가 "session F 통과" 라고 말해주면 Claude 가 일괄 처리)

2. IMPL_STATUS.md 의 매트릭스에서:
   - session F 가 cover 한 leaf 들의 ✅A → ✅ <date> chan 로 변경
   - 예: F-8-a..g, F-9-a, F-10-a..g, F-11-a/b, F-7-c..h 모두 ✅

3. 본 sheet 의 session header 에 "walked 2026-MM-DD" 기록

4. 다음 session 으로 이동
```

**한 번에 ✅ 일괄 처리하는 가장 빠른 방법** — Claude 에게:
```
"§6 Session F walk 통과. 모든 leaf ✅ 처리해줘"
```
→ Claude 가 매트릭스의 해당 leaf 들에 ✅A → ✅ replace.

발견 이슈 없이 통과한 session 은 그냥 보고만 하면 됨. 이슈 있으면
§98 흐름.

## 진행 현황 (수동 갱신)

| Session | 대상 leaf 수 | 상태 | walked at | 메모 |
|---|---|---|---|---|
| A — Boot + Onboarding | 10 | 🔁 재walk 필요 | 2026-05-28 (issue 발견) | SP-B-1: FDA 리스트 미등록 → v0.3.2 에서 B-1-e 신설 후 재검증 |
| B — Inbox/Outbox/Archive | 23 | ⬜ | — | — |
| C — Clipboard + Notes | 17 | ⬜ | — | — |
| D — Settings 7 sections | 25 | ⬜ | — | — |
| E — Tree view | 9 | ⬜ | — | — |
| F — Git Dashboard | 24 | ⬜ | — | — |
| G — Updater | 3 | ⬜ | — | — |
| H — Logs + 알림 | 11 | ⬜ | — | — |
| I — Lifecycle | 14 | ⬜ | — | — |
| J — PAT cross-host (선택) | 8 | ⬜ | — | 두 번째 Mac 필요 |
| K — Cross-OS L5 (선택) | — | ⬜ | — | Windows 머신 필요 |
| **합계** | **143** | — | — | — |

총 ⚠M ~73 → walk-able 143 (중복 cover 포함). 모든 session 완료 시
M4-B 통과, IMPL_STATUS 의 매트릭스가 100% ✅ 또는 ⚠X 로 채워짐.
