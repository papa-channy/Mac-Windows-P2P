# MAC_MIRROR_PLAN — Windows ↔ Mac 전체 미러 작업 계획

**작성일**: 2026-05-24
**대상**: macOS 측 `mac_gui/share-manager/` 구현자
**목표**: Windows 측이 앞서 있는 모든 영역을 Mac에서 같은 UI / 같은 기능 / 같은 통과기준으로 미러
**참고 문서 (역할 분리)**:
- `WINDOWS_PARITY_BRIEF.md §18` ← **Git 영역 reference** (스키마/API 사양)
- `windows_gui/share-manager/mockups/quality/ADR/*` ← **결정 근거 4개**
- `windows_gui/share-manager/mockups/quality/CHECKLIST.md` ← **UPC 1~9 + 컴포넌트별 통과 기준**
- **이 문서** ← **오늘 뭘 할지** (T1~T7 트랙 + Wave A/B/C 순서)

---

## §1. 전체 Gap 진단 (2026-05-24 시점)

### 1.1 Rust 커맨드 통계
- Windows 등록 커맨드: **61개** (commands.rs 101,563 bytes)
- Mac 등록 커맨드: **45개** (commands.rs 37,878 bytes + 분리된 모듈)
- **Windows-only**: 28개 (Mac 추가 대상)
- **Mac-only**: 10개 (macOS 특화 — 미러 불필요)

### 1.2 Windows-only 28개 — 7개 트랙으로 분류

| 트랙 | 영역 | 누락 커맨드 (개수) | Mac 현 상태 |
|---|---|---|---|
| **T1** | Git 대시보드 | 17개 (`scan_git_repos`/`scan_and_publish_git`/`publish_git_status`/`list_git_status`/`list_git_logs`/`github_fetch_remote`/`read_remote_cache`/`build_repo_graph`/`git_file_diff`/`git_config_read`/`git_list_branches`/`git_set_token`/`git_has_token`/`git_clear_token`/`git_test_token`/`git_ssh_status`/`git_generate_ssh_key`) | **0%** — 모듈 자체 없음 |
| **T2** | Clipboard 확장 | 5개 노출 누락 (`list_clipboard_history`/`read_shared_clipboard`/`write_shared_clipboard`/`compressed_image_path`/`list_compressed_images`) + 1개 자동시작 wiring (`start_clipboard_poller`) | **80%** — Mac `clipboard.rs`에 인프라(폴러/엔트리/이미지/sync) 이미 구현. **Tauri 노출만 추가**. 압축이미지 갤러리는 0% |
| **T3** | 파일 감시 + 자동검증 | 2개 (`start_file_watcher` wiring, `auto_verify_pending`) | **70%** — Mac `watcher.rs` 인프라 있음. `auto_verify_pending` 만 신규. wiring은 `lib.rs` setup hook 확인 필요 |
| **T4** | Log Hub | 1개 (`list_log_entries`) + 프론트 `renderLogHub` | **0%** — 모듈/뷰 전무 |
| **T5** | 압축 이미지 갤러리 | T2와 겹침 (`list_compressed_images`/`compressed_image_path`) + 프론트 `renderCompressedImages` | **0%** — Mac에 압축 캐시 디렉토리 개념 없음 |
| **T6** | HTML Assets Inspector | 1개 (`inspect_html_assets`) — 사용자 명시 요청 도구 | **0%** |
| **T7** | Worklog API | 1개 (`append_worklog`) — 품질 프레임워크 보조 | **0%** |

### 1.3 Mac-only 10개 — macOS 특화 (Windows 미러 불필요)
`current_app_version`, `get_release_notes`, `has_full_disk_access`, `open_privacy_settings`, `install_desktop_alias`, `remove_desktop_alias`, `desktop_alias_status`, `ensure_mount`, `mount_status`, `send_path_force`
→ Finder alias, TCC 권한, SMB 마운트 등 macOS 환경 의존. **유지 정당.**

### 1.4 품질 프레임워크 차이
| 항목 | Windows | Mac |
|---|---|---|
| `mockups/quality/CHECKLIST.md` | ✅ 있음 | ❌ 없음 |
| `mockups/quality/ADR/0001~0004.md` | ✅ 4개 | ❌ 없음 |
| `mockups/quality/WORKLOG/*.md` | ✅ 일일 로그 | ❌ 없음 |
| `mockups/{conflict,dag,syncmap,resolver}.html` | ✅ 5개 mockup | ❌ 없음 |
| `mockups/design-system.css` | ✅ 있음 | ❌ 없음 |

### 1.5 프론트 페이지 차이
Windows `app.js` 의 `render*` 섹션 (대형 SPA) vs Mac `views/*.tsx` (React 컴포넌트):

| Windows 섹션 | Mac 대응 | 상태 |
|---|---|---|
| `renderTree*` | TreeView.tsx | ✅ 있음 |
| `renderSettings` / `renderThemeOptions` / `renderThemeCatalog` | SettingsView.tsx + settings/ | ✅ 있음 (분리 정도만 다름) |
| `renderNotesList` / `renderNoteEditor` | NotesView.tsx | ✅ 있음 |
| `renderClipboardPanel` | ClipboardView.tsx | ⚠ 부분 (history/shared 누락) |
| `renderPinned`, `renderTools` | ❌ 없음 | **추가 검토 필요 (Mac에 별도 위치인지 미존재인지)** |
| `renderLogHub` / `renderLogEntries` | ❌ 없음 | **T4 신규** |
| `renderCompressedImages` | ❌ 없음 | **T5 신규** |
| `renderGitPanel` / `renderGitL1Dashboard` / `renderGitL1Card` / `renderGitL2Lanes` / `renderTimelineStatus/Graph/Detail` / `renderGitDetailBody` / `renderGitSyncMap` / `renderGitDag` | ❌ 없음 | **T1 신규** |
| `renderItems` | ItemsView.tsx | ✅ 있음 |

---

## §2. 트랙 T1 ~ T7 — 상세 산출물 / 통과 기준

### Track T1 · Git 대시보드 (가장 큰 차이)
**상세**: `WINDOWS_PARITY_BRIEF.md §18` 전체 + Phase M1~M8 (아래 압축본, 풀버전은 §18.10).

| Sub | 산출물 | 통과 기준 | 예상 LOC |
|---|---|---|---|
| T1.1 | `src-tauri/src/git.rs` 신규 모듈 + 17 커맨드 | cargo check warning 0, keychain 동의 다이얼로그 동작 | 1200 |
| T1.2 | Mac이 자기 `chans-MacBook-Pro.git-status.json` / `.git-log.json` 게시 | Win 대시보드에 진짜 Mac 데이터 표시, 합성본 제거 후도 정상 | (코드 0, 검증) |
| T1.3 | `src/lib/gitApi.ts` / `gitStore.tsx` / `computeGitNarrative.ts` | 타입 안전 invoke, verdict-action 규칙 코드화 | 400 |
| T1.4 | L1: `views/GitView.tsx` + `components/git/{RepoCard, RepoList, GitToolbar, ThreeNodeBridge}.tsx` | CHECKLIST L1-A~D 통과 | 700 |
| T1.5 | L2: `components/git/{GitDetailModal, SyncTimeline, StatusSummary, TimelineGraph, SelectedCommit}.tsx` | CHECKLIST L2-A~C + ADR-0002/0003/0004 검증 | 900 |
| T1.6 | L3: `components/git/{GitInspector, RawDiffsTab, DaemonLogsTab, GitConfigTab, AllCommitsTab, BranchesTab}.tsx` | CHECKLIST L3-A~G + ADR-0001 | 1100 |
| T1.7 | Creds UX: `components/git/{TokenSettings, SshSettings}.tsx` | Keychain 저장/조회/삭제 라운드트립 | 350 |

**의존성**: T1.1 → T1.2 → (T1.3 → T1.4 / T1.5 / T1.6 / T1.7 병렬)
**OS 차이**: keyring `apple-native` feature / `~/.ssh/id_ed25519` / SF Mono / `cargo tauri build`

---

### Track T2 · Clipboard 확장 (Mac 80% 완료)
**Mac 현재 인프라 (clipboard.rs)**: `start_poller` / `list_entries` / `append_entry` / `append_image_entry` / `cleanup_old_images` / `sync_to_share` / `clear_own_history` / `copy_image_to_os_clipboard`

| Sub | 산출물 | 통과 기준 | 예상 LOC |
|---|---|---|---|
| T2.1 | `commands.rs` 에 5개 Tauri 래퍼 추가: `list_clipboard_history`, `read_shared_clipboard`, `write_shared_clipboard`, `compressed_image_path`, `list_compressed_images` | 5개 커맨드 invoke 가능 | 200 |
| T2.2 | `clipboard.rs` 에 누락 함수: `read_shared_clipboard()`, `write_shared_clipboard()`, `prune_clipboard_history(keep)` | Win과 동일 JSON 응답 | 250 |
| T2.3 | `lib.rs` invoke_handler 5건 등록 + `setup()` 훅에서 `start_clipboard_poller` 자동 시작 | 앱 시작 시 폴러 활성 | 30 |
| T2.4 | `lib/api.ts` 에 TS 래퍼 5개 | 타입 안전 호출 | 50 |
| T2.5 | `views/ClipboardView.tsx` 에 "Shared clipboard" 패널 + "History" 정렬 토글 추가 | 양 OS 동일 UX | 300 |

**의존성**: 독립 (T1과 무관, 병렬 가능)

---

### Track T3 · 파일 감시 + 자동검증
**Mac 현재 인프라 (watcher.rs)**: `watch_paths` / `classify_event_path` / `start` / `run_polling_fallback` / `newest_mtime_under`

| Sub | 산출물 | 통과 기준 | 예상 LOC |
|---|---|---|---|
| T3.1 | `lib.rs` `setup()` 훅에서 `watcher::start(app)` 호출 확인 (이미 있을 수 있음) | 앱 시작 시 watcher 활성 | 5~20 |
| T3.2 | `commands.rs` 에 `auto_verify_pending()` 추가 — pending transfer 자동 검증 | Win과 동일 응답 | 150 |
| T3.3 | `lib.rs` invoke_handler 1건 등록 | invoke 가능 | 2 |
| T3.4 | `lib/api.ts` 래퍼 + 적용 화면 (ItemsView에서 자동 호출) | UI 통합 | 50 |

**의존성**: 독립

---

### Track T4 · Log Hub
**용도**: daemon / transfer / clipboard / watcher 로그를 통합 조회. Win은 `pinned`/`tools` 패널 옆에 있음.

| Sub | 산출물 | 통과 기준 | 예상 LOC |
|---|---|---|---|
| T4.1 | `src-tauri/src/log_hub.rs` (또는 `commands.rs` 내) `list_log_entries(cat, n)` | 카테고리별 JSON 응답 | 200 |
| T4.2 | `lib.rs` 등록 | invoke 가능 | 2 |
| T4.3 | `lib/api.ts` 래퍼 | 타입 | 30 |
| T4.4 | `views/LogsView.tsx` + `lib/nav.ts` 에 "Logs" 그룹 추가 | 사이드바 표시, 카테고리 필터, 로그 행 렌더 | 350 |

**의존성**: 독립 (단 T1.6의 Daemon Logs Tab 과 데이터 소스 공유 가능 — 한 함수로 재사용)

---

### Track T5 · 압축 이미지 갤러리
**용도**: Win은 클립보드 이미지 누적분을 압축 캐시(`compressed_images_dir`)에 저장 후 갤러리로 조회.

| Sub | 산출물 | 통과 기준 | 예상 LOC |
|---|---|---|---|
| T5.1 | `clipboard.rs` 에 `compressed_images_dir()` / `sweep_clipboard_images()` / 압축 트리거 | 디스크에 캐시 생성 | 250 |
| T5.2 | `commands.rs` 에 `list_compressed_images()` / `compressed_image_path()` (T2.1과 겹침 — T2가 먼저면 거기서 같이 처리) | invoke 가능 | (T2와 통합) |
| T5.3 | `views/ClipboardView.tsx` 또는 신규 `CompressedImagesView.tsx` 에 갤러리 그리드 | Win과 동일 시각 | 300 |

**의존성**: T2.1 / T2.2 와 일부 겹침 → **T2와 묶어서 처리 권장**

---

### Track T6 · HTML Assets Inspector
**용도**: 사용자가 이전에 보고한 "Mac → Win HTML 옮길 때 텍스트만 남고 디자인 깨짐" 문제 진단 도구.

| Sub | 산출물 | 통과 기준 | 예상 LOC |
|---|---|---|---|
| T6.1 | `commands.rs` `inspect_html_assets(path)` — 자산 경로 / 누락 / 외부 링크 / inline vs external 분석 | JSON 응답 | 200 |
| T6.2 | `lib.rs` 등록 + `lib/api.ts` 래퍼 | invoke 가능 | 30 |
| T6.3 | `components/HtmlInspectorModal.tsx` 또는 `views/SettingsView.tsx` 안의 "Diagnostics" 섹션 | 결과 표시 + flagged warning | 250 |

**의존성**: 독립

---

### Track T7 · Worklog API
**용도**: 품질 프레임워크 작업 시 자동 worklog 작성. Win의 `append_worklog` 미러.

| Sub | 산출물 | 통과 기준 | 예상 LOC |
|---|---|---|---|
| T7.1 | `commands.rs` `append_worklog(date, body)` — `mockups/quality/WORKLOG/YYYY-MM-DD.md` 에 append | 파일 갱신 | 80 |
| T7.2 | 등록 + TS 래퍼 | invoke 가능 | 30 |
| T7.3 | 품질 프레임워크 디렉토리 구조 초기화: `mac_gui/share-manager/mockups/quality/{CHECKLIST.md, ADR/, WORKLOG/}` | 디렉토리 존재 + Win의 CHECKLIST 미러 (macOS 추가 항목 포함) | 250 (문서) |

**의존성**: 독립. **하지만 T1~T6 진행 중 worklog 작성에 사용되므로 일찍 시작 권장.**

---

## §3. Wave A / B / C — 권장 작업 순서

### Wave A (즉시 시작 — 의존성 없는 기반 작업)
1. **T7** 품질 프레임워크 셋업 (디렉토리 + CHECKLIST 미러) — **다른 모든 트랙의 검증 기반**
2. **T2.1~T2.3** Clipboard 노출 5개 + 폴러 wiring — **빠른 승리, Mac이 이미 80% 완료**
3. **T3.1** Watcher wiring 확인 (이미 활성일 수 있음 — 단순 확인)
4. **T1.1** Git Rust 골격 (17 커맨드) — **가장 큰 작업의 시작**

→ Wave A 완료 시점: Mac이 Git 데이터를 게시할 수 있고, 클립보드 노출 완료, 품질 프레임워크 활성

### Wave B (Wave A 진행 중 병렬, Wave A 완료 후 가속)
5. **T1.2** Mac이 자기 git-status 실제 게시 → Windows 대시보드 교차 검증
6. **T1.3** 프론트 데이터 레이어 (gitApi/gitStore/narrative)
7. **T6** HTML Inspector — **사용자 명시 요청**
8. **T4** Log Hub — 디버깅 가속

→ Wave B 완료 시점: Git 프론트 작업 가능 상태, 진단 도구 활성

### Wave C (UI 본격 구축)
9. **T1.4** L1 Dashboard
10. **T1.5** L2 Sync Timeline (가장 복잡)
11. **T1.6** L3 Inspector (5탭)
12. **T1.7** Creds UX
13. **T2.4~T2.5** Clipboard 프론트 확장
14. **T5** 압축 이미지 갤러리
15. **T8 검증** (CHECKLIST UPC 1~9 + 컴포넌트 통과 기준)

---

## §4. 의존성 그래프

```
                  ┌─ T7 (Quality Framework — 문서 인프라)
                  │
Wave A 시작 ──────┼─ T2.1~T2.3 (Clipboard 노출, Mac 80% 기반)
                  ├─ T3.1 (Watcher wiring 확인)
                  └─ T1.1 (Git Rust 골격)
                            │
                            ▼
                       T1.2 (Mac 데이터 게시 검증)
                            │
                            ▼
              ┌── T1.3 (TS 데이터 레이어) ───┐
              │                              │
              ├── T6 (HTML Inspector) 독립 ──┤
              │                              │
              └── T4 (Log Hub) 독립 ─────────┤
                                             ▼
                               ┌──── T1.4 (L1) ────┐
                               ├──── T1.5 (L2) ────┤
                               ├──── T1.6 (L3) ────┼──→ T8 (CHECKLIST 검증)
                               ├──── T1.7 (Creds) ─┤
                               ├──── T2.4~5 (Clip UI)
                               └──── T5 (Compressed)
```

병렬 처리 가능:
- T7 + T2 + T3 + T1.1 → Wave A
- T1.3 + T6 + T4 → Wave B
- T1.4 + T1.5 + T1.6 + T1.7 + T2.5 + T5 → Wave C (한 사람이 순차도 가능)

---

## §5. OS 차이 빠른 참조

| 항목 | Windows | macOS |
|---|---|---|
| keyring feature | `windows-native` | `apple-native` |
| SSH 키 경로 | `%USERPROFILE%\.ssh\id_ed25519` | `~/.ssh/id_ed25519` |
| 모노 폰트 stack | `JetBrains Mono, Consolas, "Cascadia Mono"` | `"SF Mono", Menlo, "JetBrains Mono"` |
| 공유 폴더 | `D:\Mac-Window_Share\` (NTFS) | `/Volumes/Mac-Window_Share` (SMB) |
| 빌드 | `cargo build --release` + robocopy | `cargo tauri build` (.dmg/.app) |
| 호스트 이름 | `flogi` | `chans-MacBook-Pro` |
| git PATH | `C:\Program Files\Git\cmd\git.exe` | `/usr/bin/git` (Xcode CLT) |
| Tauri 윈도우 chrome | Native frame | Traffic lights (stoplight) |
| Auto-start watcher/poller | `start_*` 명시 커맨드 + wiring | `lib.rs setup()` 훅에서 자동 |

---

## §6. 진행 추적 (실시간 갱신)

### Wave A
| Track | Sub | 상태 | 비고 |
|---|---|---|---|
| T7 | Quality framework 디렉토리 + CHECKLIST 미러 | ⬜ | T1~T6의 통과 기준 기반 |
| T2 | T2.1~T2.3 (Clipboard 5 커맨드 노출) | ⬜ | Mac 인프라 이미 있음 |
| T3 | T3.1 (Watcher wiring 확인) | ⬜ | 이미 활성일 가능성 |
| T1 | T1.1 (Git Rust 골격, 17 커맨드) | ⬜ | 가장 큰 작업 |

### Wave B
| Track | Sub | 상태 | 비고 |
|---|---|---|---|
| T1 | T1.2 (Mac git-status 게시) | ⬜ | Win 대시보드 교차 검증 |
| T1 | T1.3 (gitApi/gitStore/narrative) | ⬜ | — |
| T6 | T6.1~T6.3 (HTML Inspector) | ⬜ | 사용자 명시 요청 |
| T4 | T4.1~T4.4 (Log Hub) | ⬜ | — |

### Wave C
| Track | Sub | 상태 | 비고 |
|---|---|---|---|
| T1 | T1.4 (L1 Dashboard) | ⬜ | CHECKLIST L1-A~D |
| T1 | T1.5 (L2 Sync Timeline) | ⬜ | ADR-0002/0003/0004 |
| T1 | T1.6 (L3 Inspector) | ⬜ | ADR-0001, CHECKLIST L3-A~G |
| T1 | T1.7 (Creds UX) | ⬜ | Keychain 동의 다이얼로그 |
| T2 | T2.4~T2.5 (Clipboard UI 확장) | ⬜ | Shared + History 패널 |
| T5 | T5.1~T5.3 (압축 이미지 갤러리) | ⬜ | T2와 통합 가능 |

### 종료 단계
| Track | Sub | 상태 | 비고 |
|---|---|---|---|
| T8 | UPC 1~9 + 컴포넌트 통과 기준 전수 검증 | ⬜ | — |
| T8 | 1280/1100/900px 잘림 0 | ⬜ | ADR-0002 |
| T8 | Windows ↔ Mac 동일 verdict/action/색상 비교 | ⬜ | — |

상태 기호: ⬜ Pending · ⏳ In Progress · ✅ Done · ❌ Blocked

---

## §7. 커밋 컨벤션

Phase별 prefix:
- `mac-t1-m1: ...` (T1 Phase 1 = Git Rust 골격)
- `mac-t1-m4: ...` (T1 Phase 4 = L1 Dashboard)
- `mac-t2: ...` (T2 일괄)
- `mac-t3: ...`, `mac-t4: ...`, ... `mac-t7: ...`
- `mac-quality: ...` (CHECKLIST/ADR/WORKLOG 갱신)
- `mac-os: ...` (macOS 특화 영역 — alias / mount / permissions)

한 커밋 = 한 통과 기준이 이상적. 큰 작업은 sub-커밋 OK.

---

## §8. 검증 시퀀스

1. Wave A 완료 후: Mac에서 Tauri dev 실행, 5개 클립보드 커맨드 + 17개 Git 커맨드 호출 가능 확인
2. Wave B 완료 후: 진짜 Mac git-status 가 공유 폴더에 게시 → Windows 대시보드 교차 표시 확인
3. Wave C 완료 후:
   - L1/L2/L3 시각 비교 (Windows 빌드와 동일 스크린샷)
   - 동기화 케이스 4종 시연 (모두 동일 / Mac ahead / 양쪽 발산 / behind)
   - Inspector 5탭 색상/폰트/여백 비교
   - 1280/1100/900px 리사이즈 잘림 0
4. 스크린샷 8장 → `mac_gui/share-manager/mockups/quality/screenshots/`

---

## §9. 종료 조건 (Mac 미러 "완료" 정의)

다음이 모두 ✅ 일 때:
1. Windows-only 28 커맨드 중 미러 대상 28개 모두 Mac에서 invoke 가능
2. Mac이 자기 git-status / git-log / clipboard-history 실제 게시
3. Wave C 의 모든 UI 컴포넌트 렌더링
4. CHECKLIST UPC 1~9 ✅
5. CHECKLIST L1-A~D / L2-A~C / L3-A~G ✅
6. ADR-0001 ~ 0004 검증 항목 ✅
7. 1280 / 1100 / 900px 잘림 0
8. Windows와 같은 verdict / 같은 action / 같은 색상 / 같은 폰트 메트릭

**이후**: Stage 4 (직결 트리거) 양 OS 합쳐서 진행 — `WINDOWS_PARITY_BRIEF.md §18.9` 참조.

---

## §10. 막혔을 때

- 데이터 계약 의문 → `WINDOWS_PARITY_BRIEF.md §18.1` (스키마) / `§18.2` (API)
- Git 디자인 결정 의문 → `windows_gui/share-manager/mockups/quality/ADR/000{1..4}.md`
- 픽셀 값 의문 → Windows `style.css` 의 `/* ADR-0001..0003 */` 마커 블록 / `.gtl-*` 블록
- verdict-action 로직 의문 → Windows `app.js` 의 `computeGitNarrative()` 함수
- Clipboard 인프라 의문 → Mac `clipboard.rs` 이미 거의 동일 구조 (80%)
- Watcher 의문 → Mac `watcher.rs` 직접 참조 (Win은 `commands.rs` 안에 인라인)
- 시각 reference → Windows 빌드 실행 → 스크린샷 캡처
- Mac-only 영역 (alias / mount / permissions) 의문 → Windows에 미러 불필요, Mac 코드가 단일 정답
