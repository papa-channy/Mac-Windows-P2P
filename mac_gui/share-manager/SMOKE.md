# UI Smoke Checklist (Phase A-D)

Run `cargo tauri dev` from `mac_gui/share-manager/` and walk through the
following. Each item should "just work" with no console errors in the
DevTools panel.

## 0. Launch
- [ ] App window opens, "Mac-Window 공유" title
- [ ] First run only: welcome modal appears with release notes
- [ ] DevTools (Cmd+Opt+I): no red console errors at idle
- [ ] If share is mounted: status footer shows `/Volumes/Mac-Window_Share`

## 1. Sidebar
- [ ] Brand card (40px blue icon · "Mac-Window" · "공유 관리자")
- [ ] 3 nav groups (Inbox / Outbox / Received) with totals reflecting share contents
- [ ] Category badges within each group show non-zero counts only
- [ ] Tools row (📝 공유 메모 · 📋 클립보드)
- [ ] Refresh + Settings buttons at bottom; Settings has active state
- [ ] Click between groups → ItemsView panel reloads, only one active at a time

## 2. Quick Send (Tree)
- [ ] Click `🚀 빠른 전송` → tree shows home directory
- [ ] `← 상위`, `🏠 홈`, `🖥 데스크탑` buttons navigate correctly
- [ ] Folder double-click enters that folder
- [ ] File double-click opens it in Finder/default app
- [ ] Hover any file row → `→ 전송` button fades in
- [ ] Click `→ 전송` → CategoryPickerModal opens with that one file
- [ ] Modal ESC closes
- [ ] Modal backdrop click closes
- [ ] Modal `취소` button closes

## 3. Drag-drop (window-level)
- [ ] Drag ONE file from Finder onto window → blue blur overlay appears
- [ ] Drop → CategoryPickerModal opens with that file
- [ ] Drag TWO+ files → no overlay-to-picker flow, files auto-send as `❔ 미분류` → toast `... 으로 N개 항목 전송 완료`
- [ ] If share NOT mounted → toast `... 실패 N건: ... ShareNotMounted` (expected)
- [ ] Drop zone `📂 파일 선택` button → native dialog → multi-select → same as drag-drop

## 4. Items (Transfers)
After at least one successful send:
- [ ] New item appears at top of Outbox group
- [ ] Item row shows friendly name (no `YYYY-MM-DD__cat__` prefix)
- [ ] Meta line: `<cat-emoji> <cat-label> · <size> · v01 · <date> · <relative>`
- [ ] Right tail shows full `toLocaleString('ko-KR')` timestamp
- [ ] Single-click row → DetailsModal opens
- [ ] DetailsModal has 8 rows: 카테고리/방향/상태/크기/버전/수정시각/저장파일명/전체경로
- [ ] DetailsModal `열기` opens file
- [ ] DetailsModal `Finder에서 보기` reveals in Finder
- [ ] Item double-click → opens file (skips modal)
- [ ] Header `📂 폴더 열기` → Finder opens at category directory

## 5. Settings
Click `⚙ 설정` bottom of sidebar.

### Update / 배포
- [ ] Current version shown (v0.1.0)
- [ ] `지금 업데이트 확인` → "최신 버전입니다." within ~2s
- [ ] 바탕화면 바로가기 상태: `healthy` (since we installed from DMG)

### 트리 탐색
- [ ] Depth stepper shows current value (default 4)
- [ ] `+` increments, `−` decrements, clamped 1..10
- [ ] Change depth → Quick Send tree re-renders with new depth on next visit
- [ ] `＋ 폴더 추가` → folder picker → added folder appears as chip in Quick Send toolbar
- [ ] Per-shortcut `제거` button removes chip immediately

### 네트워크
- [ ] Remote host input shows default `192.168.50.1`
- [ ] Change input value → persists (re-open settings to verify)
- [ ] `🔌 연결 확인` → result card appears with TCP + ICMP rows
- [ ] `⏱ 속도 측정 (100MB)` → result card with write/read MB/s (~10s if SMB)

### 정책 & 프로필
- [ ] Network mode radio shows current value from share/policy.json
- [ ] Toggle radio → file mtime on `<share>/00_System/10_Config/global/policy.json` updates
- [ ] Language presets card shows N presets (or "(셰어에 프리셋 없음)")
- [ ] `📤 내 프로필 게시` → file appears at `<share>/00_System/10_Config/profiles/<hostname>.profile.json`
- [ ] Profiles list shows my host + Windows host (if Windows side has published)

### 외관
- [ ] Default + ASCII radios, both selectable
- [ ] `📂 VSCode 아이콘 테마 추가` → folder picker for VSCode extension folder
- [ ] After install: theme appears in list with `아이콘 N개` meta
- [ ] Per-theme `제거` confirm + removal

## 6. Notes
- [ ] `＋ 새 메모` → editor right side opens, empty
- [ ] Type title + body → save status flips `편집 중…` then `저장됨`
- [ ] Note appears in left list with snippet
- [ ] Select existing note → editor populates
- [ ] `🗑 삭제` confirm dialog → confirm → removed

## 7. Clipboard
- [ ] Tab `📋 클립보드`
- [ ] Copy text in another app (Terminal: `pbcopy <<< "test"`) → entry appears within ~2s
- [ ] OS badge green `MAC` (or blue `WIN` for Windows entries)
- [ ] Click entry → toast (text copied back to OS clipboard)
- [ ] `↻ 다시 읽기` refreshes
- [ ] `🗑 내 기록 지우기` → confirm → my entries removed (Windows host entries kept)

## 8. Auto-refresh
With share mounted + Windows side running:
- [ ] Have Windows send a file → within ~400ms Inbox count badge increments
- [ ] Have Windows save a note → within ~400ms note list refreshes

## Notes to operator
- DevTools opens with Cmd+Opt+I on macOS
- If anything fails, capture the exact error message + which checkbox + which view; that's enough to track down
- Items in `8. Auto-refresh` need a coordinated session with the Windows host
