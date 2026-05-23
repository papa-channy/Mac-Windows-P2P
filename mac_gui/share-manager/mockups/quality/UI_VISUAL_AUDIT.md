# UI Visual Audit — v0.3.0 vs Windows reference

CHECKLIST.md 의 모든 "implemented" 행이 실제로 픽셀 단위에서 Windows 와
일치하는지 검증. ADR-0001 (Inspector 라이트 테마), ADR-0002 (modal header
overflow), ADR-0003 (Sync Timeline 그래프), ADR-0004 (Sync Timeline
narrative), brief §18.7 (디자인 토큰) 기준.

## 캡처 protocol

- **Mac**: `cargo tauri dev` 실행 중인 윈도우, Cmd-Shift-4 영역 선택,
  파일명 `mockups/quality/screenshots/<row-id>-mac.png` 로 저장
- **Windows**: 동일 view, Win+Shift+S 영역 선택,
  파일명 `mockups/quality/screenshots/<row-id>-win.png` (Windows 머신에서 캡처)
- 시각 diff: 파일 두 개를 ImageMagick `compare` 또는 그냥 슬라이드로 비교

## Walk-order (한 번에 끝내기)

`cargo tauri dev` 한 번 띄우고 다음 순서대로 panel 순회.
중간에 Settings → Git 까지 들어가서 PAT/SSH 입력 화면도 확인.

1. **Sidebar 전체** (`-sidebar-`) — In / Out / Archive + Log Hub + Memo + Clipboard + Settings
2. **Inbox 카테고리 행** (`-l1-inbox-`)
3. **DetailsModal** (`-l2-modal-`) — 임의 transfer row 클릭
4. **🔍 검증 결과** (`-l1-verify-`) — DetailsModal 안의 verify
5. **SettingsView 전체** (`-settings-`)
6. **NotesView** (`-notes-`)
7. **ClipboardView** (`-clipboard-`) — sticky panel + streaming + sort toggle
8. **LogsView** (`-logs-`) — 5 sub-items
9. **GitView L1** (`-l1-git-`) — Repo Card grid + hero stats
10. **GitDetailModal** (`-l2-git-`) — repo 카드 클릭
11. **GitInspectorModal** (`-l3-git-`) — 5 탭 모두 캡처
    - Raw Diffs (`-l3-diffs-`)
    - Daemon Logs (`-l3-logs-`)
    - Git Config (`-l3-config-`)
    - All Commits (`-l3-commits-`)
    - Sync Timeline (`-l3-timeline-`)
12. **TokenSettings + SshSettings** (`-git-settings-`) — Settings → Git section

---

## 검증 행

각 행에서 비교 항목 — §18.7 토큰 기준. drift 발견 시 "Drift" 열에 적기,
"Pass" 체크박스는 drift 없을 때만 체크.

### L1 Dashboard

| ID | Mac selector | Compare against | 비교 항목 | Pass | Drift |
|---|---|---|---|---|---|
| L1-A | `GitView` header (제목 + GitToolbar) | win L1 dashboard 헤더 | font-weight 700, size 20px, subtitle 12.5px text-sec | ☐ | |
| L1-B | hero 3카드 (`.git-hero`) | win hero | grid 3 col, card padding 14/18, num font 28/700, sync card 녹색 border, danger card 빨간 글로우 | ☐ | |
| L1-C | RepoCard grid | win repo card | card radius 12px, padding 14/16, left-border 3px (kind 별 색), 카드 hover transform | ☐ | |
| L1-C4 | 3-node bridge (`ThreeNodeBridge`) | win 3-node bridge | 38×38 노드 타일, LED 7px #30d158, gn-link 2px bar, mac/remote/win 이모지 (또는 windows 측 brand SVG 와 동일 인상) | ☐ | |
| L1-D | empty state (`.git-empty`) | win 빈 dashboard | 24px icon 🌿, title 13.5px, hint 11.5px text-sec | ☐ | |

### L2 Detail modal

| ID | Mac selector | Compare against | 비교 항목 | Pass | Drift |
|---|---|---|---|---|---|
| L2-A | `.git-detail-head` | win detail header | grid `minmax(0,1fr) auto auto auto`, branch select max-w 200, title ellipsis, close 32×32, overflow hidden | ☐ | |
| L2-B | status chip + overlap | win L2 status | `.git-l2-status.<kind>` 색 (synced 녹/dirty 호박/conflict 빨/partial 회색) | ☐ | |
| L2-C | 3 swimlanes (`.git-lane`) | win swimlanes | 3-col grid, mac/remote/win top-border 3px (#2563EB/#6E40C9/#0F766E), lane height ≥240, head + body + 변경없음 표시 | ☐ | |
| L2-C1 | lane header | win lane header | 36×36 아이콘 타일, title 13/600, sub mono SHA, tag chips | ☐ | |
| L2-C5 | Origin tip card | win origin card | dot 18px #6E40C9 + glow, mono SHA 13/700, msg 11.5 text-sec | ☐ | |
| L2-D | Connector bar | win connector | 5-col grid (Mac label · arrows · Origin · arrows · Win label), eq chip 녹색, up chip 호박, down chip 회색 | ☐ | |

### L3 Inspector — ADR-0001 light

| ID | Mac selector | Compare against | 비교 항목 | Pass | Drift |
|---|---|---|---|---|---|
| L3-A | `.gi-head` | win inspector header | 라이트 chrome, back ‹ 32×32, breadcrumb mono, sky `>_` accent | ☐ | |
| L3-B | `.gi-tabs` (DATA CATEGORIES) | win tab sidebar | 220px 폭, active 시 sky 좌 3px stripe (#0EA5E9), 라이트 hover | ☐ | |
| L3-C | Raw Diffs tab | win diffs | `.d-add #1F883D` / `.d-del #CF222E` / `.d-hunk #0969DA` on `#F6F8FA`, mono 11.5px, line-height 1.6 | ☐ | |
| L3-D | Daemon Logs | win logs | 4-col grid 70/70/90/1fr, `.l-lvl.l-ok #1F883D` / `.l-err #C41818` / `.l-info #0969DA` pill | ☐ | |
| L3-E | Git Config | win config | `.gi-config-pre` line-height 1.85, `#F6F8FA` bg, mono 12px | ☐ | |
| L3-F | All Commits | win commits | table heading 10.5px uppercase, SHA accent sky mono `.d-add`, date nowrap | ☐ | |
| L3-G | Sync Timeline (3 panel narrative) | win timeline | Status: kind 별 border 색 / Graph SVG: lane band 7% tint, LCA amber line `#D4A72C`, tip pill brand color fill / Detail: 큰 SHA pill `#0EA5E9` | ☐ | |

### Sidebar / 기타 view

| ID | Mac selector | Compare against | 비교 항목 | Pass | Drift |
|---|---|---|---|---|---|
| SIDE-A | `Sidebar.tsx` 전체 | win sidebar | In/Out/Archive 그룹 헤더, Log Hub 5 sub-item, Memo/Clipboard tools | ☐ | |
| SIDE-B | nav-group-header | win 그룹 헤더 | text-transform 제거 (ALL CAPS 아님), letter-spacing 0.5, font 10.5/600 | ☐ | |
| CLIP-A | SharedClipboardPanel | win shared clip | left-accent stripe 3px sky, sticky body padding 12/14, mono history rows | ☐ | |
| CLIP-B | sort toggle | win toggle | segmented control, active = accent fill | ☐ | |
| LOG-A | LogsView entry list | win log view | 2-col grid (160px time / 1fr main), ok/error border 좌 색, mono SHA chip | ☐ | |
| HTML-A | HtmlInspectorModal | win html modal | flagged file `<details open>`, asset kind chip uppercase 10px, present 녹/missing 빨 | ☐ | |
| SET-GIT | Settings → Git section | win git settings | block bg surface-low, password input mono, status row ✅/⚠ 색 | ☐ | |

### macOS-specific (MAC-1..MAC-8)

| ID | Verify | Pass | Drift |
|---|---|---|---|
| MAC-1 | Mono font stack — global.css의 mono 변수가 모든 mono 영역에 일관 적용 | ☐ | |
| MAC-2 | Traffic-lights chrome — 윈도우 좌상단 ●●● 노출 (tauri.conf.json `decorations: true` 확인) | ☐ | |
| MAC-3 | Keychain dialog — Settings→Git→PAT 저장 시 Touch ID/암호 dialog 노출 | ☐ | |
| MAC-4 | SSH 경로 — `~/.ssh/mac_window_git_ed25519` 가 표시되는지 (git_ssh_status) | ☐ | |
| MAC-5 | SMB 마운트 표시 — Sidebar status `(셰어 OK)` + 셰어 경로 표시 | ☐ | |
| MAC-6 | Single-instance + Space follow — 다른 Space 에서 dock 아이콘 클릭 시 현재 Space 로 따라옴 | ☐ | |
| MAC-7 | FDA onboarding — 첫 launch (또는 Settings → "권한 안내 다시 보기") 시 PermissionsOnboarding 모달 정상 | ☐ | |
| MAC-8 | Notarized 서명 — Phase 4 산출 DMG 가 `spctl --assess` 통과 (Phase 4 에서 검증) | ☐ | |

---

## 종합 판정

- [ ] 모든 행 Pass + Drift 열 empty → Phase 4 진행 가능
- [ ] Drift 있음 → 행 ID + 관찰 paste → CSS / tsx 패치 → 재캡처

Drift 패치 정책:
- 토큰 색/크기 미세 차이 → `src/styles/global.css` 수정
- 컴포넌트 구조 차이 → 해당 `src/components/*.tsx` 수정
- 행 ID 의 CHECKLIST status 도 "implemented" → "verified visually" 로 갱신

## 산출물

`mockups/quality/screenshots/` 디렉토리에 `<row-id>-{mac,win}.png` 한 쌍씩.
이건 git 에 commit 하지 말 것 (`.gitignore` 추가 권장 — `mockups/quality/screenshots/`).
