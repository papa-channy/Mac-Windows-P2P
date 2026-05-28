# Taxonomy — 코드 식별자 규칙

3-tier 식별자로 모든 기능 / UI / 로직 unit 을 추적. 한 번 부여하면
바뀌지 않는다 (이후 commit / Task / ADR / IMPL_STATUS 가 모두 이
식별자를 참조). 새 unit 이 생기면 같은 tier 내에서 다음 비어있는
번호 / 글자를 사용. 한 unit 이 deprecate 되면 식별자는 남기고
IMPL_STATUS 에서 `deprecated` 마크 — 재사용 금지 (history 보존).

## 식별자 형식

```
<UPPER>-<NUMBER>-<lower>
   ↑       ↑       ↑
   │       │       └── 하위: 로우 레벨 로직 unit (a..z, 필요 시 aa..zz)
   │       └────────── 중간: sub-domain / 페이지 / 모듈 (1..99)
   └────────────────── 상위: 대분류 (A..Z)
```

예시:
- `B-1-a` — 권한 (B) · macOS TCC FDA (1) · has_full_disk_access probe (a)
- `F-3-c` — Git (F) · PAT credential (3) · age cross-host encrypt 호출 (c)
- `G-2`   — 디자인 (G) · 사이드바 (2) · 그룹 자체 (leaf 가 아닌 sub-domain)
- `K-1-b` — 설정 (K) · settings.json 스키마 (1) · `notification.channels` 키 (b)
- `L-3-a` — 스키마 (L) · clipboard v2 image entry (3) · `kind:"image"` discriminator (a)
- `M-2-c` — Lifecycle (M) · watcher (2) · share-changed → topic fan-out 라우터 (c)
- `N-1-a` — Vendor (N) · SendToWindowsLauncher.app · NSSendableTypes 선언 (a)

식별자 단위:
- **leaf** = `<UPPER>-<NUMBER>-<lower>` — 한 함수 / 한 컴포넌트 / 한 contract / 한 commit-sized 로직
- **group** = `<UPPER>-<NUMBER>` — 같은 sub-domain 의 leaf 묶음 — 페이지 단위, 모듈 단위
- **domain** = `<UPPER>` — 같은 대분류의 sub-domain 묶음

문서 / 커밋 메시지 / Task / 코드 코멘트에서 식별자 단독 사용 OK
(`"B-1-c 권한 onboarding 모달 dismiss 후 재호출 fix"`).

## 상위 그룹 (대분류)

14 개. 한 번 정해진 글자는 바꾸지 않는다 (history 안정성). 새 도메인
필요 시 `O`, `P` 처럼 다음 글자 사용.

| 코드 | 도메인 | 다루는 범위 | 신호 패턴 (이 안에 들어가는 단서) |
|---|---|---|---|
| **A** | 앱 패키징 / 빌드 / 업데이트 / 릴리스 | Cargo / Vite 빌드, codesign, notarize, minisign, DMG, latest.json, Tauri updater, gh release, RELEASES.json, version bump 규약 | `mac_gui/scripts/*.sh`, `src-tauri/tauri.conf.json` bundle 영역, `releases` workflow |
| **B** | 권한 / 보안 / 키 관리 | TCC (FDA, Desktop/Documents/Downloads), Hardened Runtime entitlements, Info.plist usage descriptions, Keychain (PAT + paircode + SSH 메타), Local Network, AppleEvents, FileVault 가정 | `Entitlements.plist`, `Info.macos.plist`, `commands::has_*_access`, `keychain` crate 사용처 |
| **C** | 직결망 / 네트워크 / 마운트 | SMB 마운트 (mount.rs), mDNS browse (discovery.rs), ping / TCP probe, mounted_smb_hosts, 직결망 IP 자동 추적, 셰어 root 검증, network-changed 감지 | `mount.rs`, `discovery.rs`, `*::ping_*`, `_smb._tcp` 등 Bonjour service name |
| **D** | 파일 교환 / Transfer engine | send_path, auto_verify_pending, RAW_SECRET 블록, CategoryPickerModal, ItemsView, DropOverlay, Inbox/Outbox flow, 검증 cache, HTML 인스펙터 pre-flight | `commands::send_path`, `commands::auto_verify_*`, `transfers/*` view, `pending/`, `outbox/`, `inbox/` |
| **E** | 클립보드 / 공유 메모 | NSPasteboard 폴러, 이미지 dedup (sha256), current.json sticky, history.jsonl streaming, 30일 TTL, notes (60_Notes), v1.x conflict 정책 | `clipboard.rs`, `notes.rs`, `ClipboardView.tsx`, `NotesView.tsx` |
| **F** | Git 대시보드 / Git ops | scan_and_publish_git, list_git_status, build_repo_graph, github_fetch_remote, GitView L1/L2/L3, Sync Timeline, CI check-runs overlay, PAT cross-host sync (age), interactive git ops, SSH key bootstrap, GitOpsBar | `git.rs`, `views/git/*`, `components/git/*`, `lib/gitStore.tsx`, `90_Git/` |
| **G** | 디자인 / UI / UX / 접근성 / i18n | 사이드바, 모달 chrome, RepoCard 3-node bridge, 카드/배지 set, lucide + BrandIcons, 색 토큰 (§18.7), 한/영 라벨, 키보드 shortcut, drag-drop visual, ADR-0001..0005 | `src/styles/*`, `src/components/{Sidebar,*Modal}.tsx`, ADR 파일, `BrandIcons.tsx` |
| **H** | 외부 알림 / user-facing 통신 채널 | toast (in-app), native macOS notification, Slack/Discord webhook payload, **사용자가 보거나 외부로 나가는** 메시지만. (내부 이벤트 라우팅 ≠ H — M 참조) | `notify.rs` 의 outbound 부분, `useToast`, `NotificationSection.tsx` |
| **I** | 로깅 / 진단 / 품질 프레임워크 | log_hub (80_Logs/*.jsonl), verify cache, ADR/0001..0005 (디자인 결정은 G), CHECKLIST, INTEGRATION_TEST, UI_VISUAL_AUDIT, PAT_SHARE_PROTOCOL, WORKLOG, RELEASE_RUNBOOK, **이 TAXONOMY 파일 자체** | `log_hub.rs`, `mockups/quality/*.md`, `LogsView.tsx` |
| **J** | 자동화 테스트 / CI 인프라 | cargo test (L1), Vitest unit (L2), Playwright E2E (L3), tauri-driver E2E (L4 미구현), L5 walk-through 시나리오, mock-tauri fixture, `vitest.config.ts`, `playwright.config.ts` | `tests/`, `*.test.tsx`, `playwright.config.ts`, `Cargo.toml` `[dev-dependencies]` |
| **K** | 설정 / 환경 / 사용자 preferences | `settings.json` 단일 truth, 기본값 / merge / migrate, localStorage 키 (onboarded, last_seen_version, …), runtime feature flags, host profile, share root override | `share.rs::Settings*`, `lib/settingsStore.tsx`, `window.localStorage.*` 직접 사용처 |
| **L** | 데이터 스키마 / 파일 contract / 버전 마이그레이션 | `manifest.json` 형식, `current.json` 형식, `history.jsonl` 행, clipboard v1→v2 migration, image entry schema (§clip v2), `image_ref`/sha256 규약, RAW_SECRET 헤더 형식, settings.json schema 버전, jsonl rotation 규약 | `share.rs` 의 struct (manifest/transfer/clipboard 등), `WINDOWS_PARITY_BRIEF.md` §13.x, migration 함수 |
| **M** | 앱 lifecycle / 백그라운드 / 이벤트 라우팅 | watcher cycles (clipboard poller, share watcher, git-token watcher), share-changed event 라우터, transfers-changed/clipboard-changed/git-changed emit, single-instance reopen, Space follow, app boot sequence, daemon-ish 작업 | `watcher.rs`, `main.rs` 의 setup/event_loop, `commands::*` 의 `app.emit_*` 호출 site |
| **N** | Service vendor (Swift) / Finder integration | `send-to-windows-launcher/` 전체 — Swift Service vendor, NSSendableTypes, NSServices info.plist, IPC into share-manager (URL scheme / open file), `bundle.sh` Swift 빌드 + sign | `send-to-windows-launcher/**`, `mac_gui/scripts/.../bundle.sh`, NSServices keys in vendor's Info.plist |

미래 확장 예정 글자: `O`(예: 클라우드 / 원격 백업), `P`(예: 모바일 컴패니언), `Q`(예: AI 어시스턴트) — 비워둠.

## 도메인 boundary — decision tree

같은 표면적 기능이 여러 도메인에 걸칠 때 어디에 식별자를 둘지
결정하는 **순차 질문**:

```
1. 파일이 build pipeline (sh / Cargo.toml / 시그니처) 인가?
   YES → A
   NO  → 2

2. 보안 모델 / 권한 정책 / 키 저장 위치 자체를 결정하는가?
   YES → B
   NO  → 3

3. 네트워크 / 마운트 / discovery 가 핵심 책임인가?
   YES → C
   NO  → 4

4. 파일 송수신 / 검증 / inbox·outbox 흐름의 일부인가?
   YES → D
   NO  → 5

5. 클립보드 또는 공유 메모 의 일부인가?
   YES → E
   NO  → 6

6. Git 대시보드 / git ops / GitHub API 의 일부인가?
   YES → F
   NO  → 7

7. 사용자에게 보이는 UI / CSS / 색 / 라벨 / 단축키 인가?
   YES → G
   NO  → 8

8. 사용자에게 표시되거나 외부 서비스로 나가는 알림인가?
   YES → H
   NO  → 9

9. 로그 / 검증 cache / 품질 문서 / ADR 인가?
   YES → I
   NO  → 10

10. 테스트 코드 / CI 환경 / 픽스처 인가?
    YES → J
    NO  → 11

11. settings.json / localStorage / preference / onboarding flag 인가?
    YES → K
    NO  → 12

12. 파일 형식 / wire contract / schema 진화 / 버전 마이그레이션 인가?
    YES → L
    NO  → 13

13. watcher / event router / single-instance / boot sequence / 백그라운드
    cycle 인가?
    YES → M
    NO  → 14

14. SendToWindowsLauncher.app 영역 (Swift, Finder Services) 인가?
    YES → N
    NO  → 새 도메인 후보 — 사용자와 합의 후 O+ 할당
```

먼저 매치되는 답을 택한다 (순서가 곧 우선순위). 이 우선순위는
"구체적인 보안/네트워크 책임 > 일반적인 UI/lifecycle" 흐름.

## tie-breaker — 같은 unit 이 두 도메인에 걸칠 때

decision tree 가 두 곳에서 모두 YES 가 날 만한 헷갈리는 예시:

| 케이스 | 1차 (식별자 주소) | 2차 (cross-ref) | 이유 |
|---|---|---|---|
| codesign 명령 자체 | **A** (빌드 step) | B (어떤 identity?) | 빌드 pipeline 의 행위 |
| `Entitlements.plist` 의 한 key (예: `network.server`) | **B** (권한 모델) | A (빌드 시 attach) | 권한 결정 → 빌드는 단지 박는 곳 |
| `Info.macos.plist` 의 `NSLocalNetworkUsageDescription` | **B-6-x** | C (왜 필요? = mDNS) | usage description 은 권한 prompt |
| share-changed event 발행 (Rust → Webview) | **M-2-?** | C, F | 라우팅 / 이벤트 시스템 자체 |
| share-changed 의 GitView 측 핸들러 (자동 refresh) | **F-?-?** | M | 핸들러는 도메인 로직 |
| PAT 키 chain 저장 | **B-2-?** | F (소비자) | 저장 메커니즘 |
| PAT 의 age 암호화 cross-host sync | **F-3-?** | B (소비) | git 도메인의 sync 정책 |
| ssh 키 생성 (`ssh-keygen`) | **F-4-?** | B (~/.ssh, 권한 모델) | git 도메인의 onboarding |
| onboarding 모달 UI | **G-?-?** | B (어떤 권한 표시?), K (dismiss flag) | UI 자체 |
| `permissions_onboarded` localStorage 키 | **K-2-?** | G | preference flag |
| `manifest.json` 형식 정의 | **L-1-?** | D (생성/소비) | schema contract |
| `manifest.json` 을 생성하는 `commands::send_path` 한 줄 | **D-?-?** | L | 행위는 D, 형식은 L |
| toast 호출 1 회 | (현장 leaf, 보통 D/E/F/...) | H (메커니즘) | 호출은 도메인, 토스트 시스템 자체는 H-1 |
| 토스트 컴포넌트 자체 | **H-1-?** | G (CSS) | 알림 시스템 |
| 토스트의 색 / 위치 / 폰트 | **G-?-?** | H | 비주얼 토큰 |
| Slack webhook payload 형식 | **L-?-?** | H (전송 메커니즘) | wire format |
| Slack webhook POST 함수 | **H-3-?** | L | 전송 행위 |
| `cargo test` 한 test 파일 | **J-1-?** | (테스트 대상 도메인) | 테스트 자체 |
| 테스트 대상 production 함수 | (테스트 대상 도메인) | J | 본체 |
| `release.sh` 의 한 step (예: 노타리) | **A-?-?** | B (notary credential) | 빌드 흐름 |
| `setup-notary.sh` | **A-?-?** | B | 빌드 환경 준비 |
| `bundle.sh` (Swift vendor) | **N-?-?** | A | vendor 의 자체 빌드 |
| `RELEASES.json` 의 스키마 | **L-?-?** | A | wire 형식 |
| `RELEASES.json` 에 entry 추가하는 release 절차 | **A-?-?** | L | 빌드 절차 |
| `AnnouncementModal` (릴리스 노트 표시) | **G-?-?** | K (`last_seen_version`), A | UI |
| `last_seen_version` 키 | **K-?-?** | A | preference flag |

규칙: **wire format / 파일 schema 는 L, 그것을 생성/소비하는 행위는 도메인.**
**메커니즘 (토스트, 웹훅, 빌드 step) 은 H/A 등, 그것을 호출하는
한 줄은 호출 도메인.**

## 중간 분류 (sub-domain) — 숫자

각 대분류 안에서 1 부터 sequential. 의미상 함께 묶이는 leaf 들이
같은 숫자를 공유 — sub-domain 이 곧 그 도메인의 "페이지" 또는
"모듈" 단위.

예 (B 권한 도메인):
- B-1  macOS TCC (FDA + 폴더별)
- B-2  Keychain — PAT 저장
- B-3  Keychain — paircode / SSH 메타 분리 저장
- B-4  Local Network (mDNS / multicast)
- B-5  Hardened Runtime entitlements
- B-6  Info.plist usage descriptions
- B-7  AppleEvents (Finder Service vendor 권한 모델)
- B-8  Codesign identity 관리 (env.sh, sign-app.sh)
- B-9  Notary credentials (keychain profile)

번호 부여 원칙:
- 가까운 sub-domain 끼리 인접 번호 (B-2, B-3 = Keychain 관련)
- 한 번 부여한 번호 재사용 금지
- 1-9 가 cardinal sub-domain, 10+ 는 후속 추가
- gap 허용 — 새 sub-domain 이 어떤 그룹에 속하면 그 그룹 끝에 추가

## 하위 분류 (leaf) — 소문자 알파벳

각 sub-domain 안에서 a 부터 sequential. 한 leaf = 한 atomic 구현
unit. 다음 중 정확히 하나에 매핑:

**leaf 가 될 수 있는 것 (atomic unit)**:
- 한 Tauri command (`#[tauri::command] pub async fn …`)
- 한 React 컴포넌트 (`function Foo() {...}` export 단위)
- 한 데이터 contract (한 파일 형식, 한 schema 버전)
- 한 settings.json 의 한 키 path (예: `notification.channels[].url`)
- 한 빌드 step (release.sh 의 한 logical step)
- 한 cross-cutting 로직 (예: share-changed event 라우터)
- 한 React hook (`useGitStore` 의 한 selector / mutation 묶음)
- 한 Rust module-level 함수 그룹 (예: `clipboard::dedup_image_*` 묶음)
- 한 CSS 토큰 집합 (예: `--accent-*` 변수 family)
- 한 ADR 문서

**leaf 가 되면 안 되는 것**:
- 한 줄 conditional (예: `if foo { … }`)
- 단일 import / re-export
- 단순 wrapper (위임만 하는 함수)
- 일회용 헬퍼 (호출 site 1 곳)
- private util (도메인 의미 없음)

**leaf 의 크기 가이드** (heuristic — 정확한 한계 아님):
- 너무 작음: ≤ 5 LoC AND 호출 site 1 곳 → 상위 leaf 에 흡수
- 너무 큼: > 200 LoC OR 여러 책임 → sub-domain 으로 승격 (번호 신설)
- 적당: 한 commit 의 본체 diff 가 자연스럽게 그 leaf 한 단위에 닿는 크기

예 (B-1 TCC FDA):
- B-1-a  `commands::has_full_disk_access()` — Tauri probe
- B-1-b  `commands::open_privacy_settings(pane?)` — System Settings 점프
- B-1-c  `components/PermissionsOnboarding.tsx` — 첫 launch 모달
- B-1-d  `Info.macos.plist` NSDesktopFolderUsageDescription (외 6개 폴더 키 — 같은 family 라 한 leaf)
- B-1-e  localStorage 의 `share-manager.permissions_onboarded` 키 (실제로는 K-? cross-ref)

aa..zz 확장: a-z (26) 초과 시 aa, ab, … 사용. 단 한 sub-domain 이
26 leaf 를 넘으면 sub-domain 분할 고려 (B-1 → B-1 + B-2).

## 식별자 부여 / 변경 / 폐기 규칙

1. **신규 부여**:
   - 새 leaf → 해당 sub-domain 안 마지막 leaf 의 다음 글자
   - 새 sub-domain → 도메인 안 마지막 번호 + 1
   - 새 도메인 → 다음 비어있는 글자 (O, P, …) — 합의 필요
2. **변경 금지** — 한 번 부여된 식별자는 reassign 안 함. 코드가 옮겨가도
   식별자는 그 로직의 영혼 — 새 위치에서 동일 식별자 유지.
3. **폐기 (deprecated)** — leaf 가 사라지면 IMPL_STATUS 에 `deprecated`
   마크 + 폐기 commit / 사유. 식별자 자체는 재사용 금지 (그 자리는
   history 보존).
4. **분할 (split)** — 한 leaf 가 너무 커져서 2 개로 쪼개지면:
   - 원래 식별자는 "umbrella, deprecated" 마크
   - sub-domain 의 다음 글자 2 개 신규 부여 (예: `X-1-a` → `X-1-l`, `X-1-m`)
   - 또는 sub-domain 으로 승격 (별도 번호)
5. **병합 (merge)** — 2 개 leaf 가 하나로 합쳐지면:
   - 둘 중 먼저 부여된 식별자 유지
   - 나머지 deprecated, IMPL_STATUS 에 "merged into X-Y-z" 메모
6. **이동 (move)** — 도메인 boundary 가 잘못 잡혀 도메인 변경 필요 시:
   - 원래 식별자 deprecated + "moved to <new>" 메모
   - 새 도메인에서 신규 식별자 부여
   - **사용자 합의 필수** (history 손상 큰 동작)

## 횡단 (cross-cutting) 케이스 처리

한 unit 이 여러 도메인에 걸칠 때:
- **1 차 소속** 에 식별자 부여. 1차 소속은 decision tree 가 결정.
- 다른 도메인의 IMPL_STATUS 에는 `← see <식별자>` cross-reference.
- cross-ref 는 **양방향**: A 가 B 를 참조하면 B 의 IMPL_STATUS 에도 A 가
  소비자로 등장해야.

예: `git_op_push` (Tauri command) = **F-7-c** (Git ops).
- F-7-c IMPL_STATUS: `Notifies via H-2-a (toast) and H-3-b (webhook)`
- H-2-a IMPL_STATUS: `Triggered by F-7-c, F-7-d, D-1-?, ...`

## 메타 라벨 (식별자 X, 식별자에 attach 하는 태그)

도메인이 되기에 부족하지만 추적 가치는 있는 cross-cutting 속성. IMPL_STATUS
의 한 leaf 에 메타 라벨로 표시:

- `perf:rayon` — rayon parallel 최적화 적용
- `perf:cache` — 결과 cache 사용
- `perf:debounce` — debounce / throttle 적용
- `a11y:keyboard` — 키보드 only 흐름 지원
- `a11y:screen-reader` — VoiceOver 라벨 명시
- `cross-os` — Windows 측 mirror 존재 (어떤 식별자?) 또는 mirror 필요
- `security:secret-redaction` — 비밀 마스킹 적용
- `security:auth` — 외부 인증 자원 사용
- `experimental` — 정식 contract 아님, 변경 가능
- `deprecated` — 폐기됨 (사유 + commit 첨부)

## 파일 / 심볼 패턴 — 자동 매핑 힌트

새 leaf 부여 시 헷갈리면 파일 경로로 1 차 분류:

| 경로 패턴 | 1 차 도메인 |
|---|---|
| `mac_gui/scripts/*.sh` | A |
| `src-tauri/Entitlements.plist`, `Info.macos.plist` | B |
| `src-tauri/src/{mount,discovery,net}.rs` | C |
| `src-tauri/src/{commands.rs(send_path/auto_verify*),share.rs(transfer 부분)}` | D |
| `src-tauri/src/{clipboard,notes}.rs`, `src/components/{Clipboard,Notes}*.tsx` | E |
| `src-tauri/src/git.rs`, `src/{views,components,lib}/git*` | F |
| `src/styles/**`, `src/components/{Sidebar,Modal,Drop,Toast}*.tsx`, ADR | G |
| `src-tauri/src/notify.rs` (외부 channel 부분), `useToast.tsx`, `NotificationSection.tsx` | H |
| `src-tauri/src/log_hub.rs`, `mockups/quality/**.md`, `src/views/LogsView.tsx` | I |
| `tests/**`, `*.test.*`, `*.config.ts` (테스트), `Cargo.toml` `[dev-dependencies]` | J |
| `share.rs` Settings 구조, `lib/settingsStore.tsx`, `localStorage` 직접 접근처 | K |
| `share.rs` schema 구조 (Manifest, Transfer, ClipboardEntry 등), `WINDOWS_PARITY_BRIEF.md` §13.x | L |
| `src-tauri/src/{main.rs(setup/event_loop), watcher.rs}`, `app.emit_*` 발행 site | M |
| `send-to-windows-launcher/**`, `bundle.sh` | N |

같은 파일 안에 여러 도메인이 섞일 수 있다 (예: `share.rs` 가 K + L 둘 다
포함). 그땐 심볼 단위로 쪼개서 부여.

## 문서 / 파일 구조

이 taxonomy 가 다스리는 산출물:
- `mockups/quality/TAXONOMY.md` — 이 파일 (규칙 자체)
- `mockups/quality/CODE_MAP.md` — 모든 식별자 트리 (M2)
- `mockups/quality/IMPL_STATUS.md` — 식별자 ↔ 구현 상태 매트릭스 (M3)
- 커밋 메시지 — `<도메인>-<번호>: ...` 또는 본문에 `[B-1-a]` 인용
- ADR — 결정 사항이 어느 식별자 묶음을 다루는지 헤더에 명시
- IMPL_STATUS 의 leaf 마다: 상태, commit hash, ADR ref, Task #, cross-ref,
  메타 라벨, 알려진 한계, 다음 단계, Verified 여부

## CODE_MAP 항목 형식 (M2 선행 정의)

각 leaf 는 CODE_MAP.md 에 다음 한 줄 (또는 짧은 블록):

```
F-7-c · git_op_push
  file:    src-tauri/src/git.rs:482
  kind:    tauri-command
  consumes: F-3-a (PAT), B-2-a (Keychain read)
  emits:    H-2-a (toast), M-2-? (transfers-changed)
  meta:    cross-os, security:secret-redaction
```

## IMPL_STATUS 항목 형식 (M3 선행 정의)

각 leaf 는 IMPL_STATUS.md 에 다음 블록:

```
### F-7-c · git_op_push
- Status: implemented | partial | stub | deprecated
- Commit: 4fc8400
- ADR: ADR-0003 (timeline graph) — partial
- Task: #45 (closed)
- Verified: ⬜ (M4 에서 채움) | ✅ <date> <verifier>
- Known limits:
  - 인터랙티브 prompt (push 거절) 미처리
- Next:
  - Windows mirror — 식별자 미부여
- Cross-OS: needed (pending)
```

## 합의 후 다음 단계

이 규칙이 사용자 OK 받으면:
- **M2** — CODE_MAP.md 작성 (모든 식별자 부여, 트리, 위 형식)
- **M3** — IMPL_STATUS.md 작성 (각 식별자 상태 + 메타)
- **M4** — 코드별 검수 + Verified 마크
