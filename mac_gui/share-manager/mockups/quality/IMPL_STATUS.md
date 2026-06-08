# IMPL_STATUS — 구현 상태 매트릭스 (M3)

CODE_MAP (M2) + AUDIT (M2.5) 에서 부여된 모든 leaf 의 **현재 구현 상태**.

구조:
1. **Legend & format** — 값 enum + 약어
2. **Sub-domain rollup** — 138 sub-domain × Status/Cross-OS/Verified 1 줄 요약
3. **Leaf detail** — 도메인 (A~N) 별 leaf 단위 1 줄 매트릭스
4. **Spotlight** — `partial` / `gap` / known-limits 의 상세 블록만
5. **Cross-OS backport backlog** — Windows 측 mirror 미반영 항목

마지막 갱신: 2026-05-27 · @ baseline 0.3.1 (`055a43f`)

## 1. Legend & format

### Status

| 값 | 의미 |
|---|---|
| `impl` | 정상 구현됨. 의도된 동작 충족 |
| `partial` | 핵심 경로 동작. 명시된 한계/edge case 존재 (Spotlight 참고) |
| `stub` | skeleton 만 존재. 실제 로직 미구현 |
| `gap` | 식별자만 부여, 코드 없음 (계획 단계) |
| `dep` | deprecated — 식별자는 history 보존, 사용 안 함 |

### Cross-OS

| 값 | 의미 |
|---|---|
| `✓` | Windows 측 mirror 가 존재하고 contract 일치 |
| `✗` | Mac-only — Windows 백포트 필요 (§5 backport 백로그) |
| `N/A` | Mac-specific 개념 (codesign / NSServices / FDA / mDNS 등) — Windows 측은 다른 메커니즘 |
| `pending` | 양쪽 모두 미구현, 향후 계획 |

### Verified (M4 에서 채워짐)

| 값 | 의미 |
|---|---|
| `⬜` | 미검수 |
| `✅A` | **M4-A 자동 검증 통과** (cargo test / vite build / tsc / handler-reg / wire-form / file:line) |
| `⚠M` | M4-A 의 자동 영역 밖 — **M4-B 수동 walk 필요** (UI 렌더링 / runtime 동작 / cross-host / 외부 서비스) |
| `⚠X` | 검증 불가 — `gap` / 외부 환경 미가용 / 본질적 inherent limit |
| `✅` | M4-B 까지 완전 검증 완료 |

### M4-A 자동 검증 실행 결과 (2026-05-28)

| 검증 항목 | 결과 | 적용 범위 |
|---|---|---|
| `cargo test --lib` | **64 / 64 pass** | 모든 Rust 단위 테스트 대상 함수 → ✅A |
| `cargo check` | clean (0 errors, 10 warnings) | 전체 Rust 백엔드 컴파일 정합성 → ✅A |
| `tsc --noEmit` | clean | 전체 TS/TSX 타입 정합성 → ✅A |
| `vite build` | 305 kB JS / 53 kB CSS / 1811 modules / 774ms | 전체 frontend 빌드 → ✅A |
| `vitest run` | **19 / 19 pass** | J-2 + computeGitNarrative + classifyCard → ✅A |
| `lib.rs invoke_handler` ≡ `#[tauri::command]` 정의 | **83 ≡ 83** 일치 | 모든 Tauri command leaf → ✅A |
| api.ts 의 `export interface/type` ≡ L-* leaf | **36 exports** 모두 L 매핑 | L 도메인 wire-form → ✅A |
| CODE_MAP file:line spot-check | **12 / 12** 정확 | 위치 메타데이터 → ✅A |

**자동 통과 카테고리** (broad — 아래 leaf 들에 ✅A 일괄 적용):
- 모든 Rust function/struct/enum (cargo check 통과) → 모든 Rust-side leaf
- 모든 Tauri command (handler-reg 일치) → A-8-d/e, B-1-a/b, B-2-b..d, C-1-f/g, C-2-a, C-3-a/b, D-8-a..f, D-10-c, D-13-a, D-14-a/b, E-7-*, E-11-*, F-1-a..c, F-2-d..g, F-3-a/c/d/f, F-4-a/b (= B-3-c/d), F-5-d/e/f, F-6-a, F-7-c..h, I-1-d/e, I-4-a, K-1-b/c, K-5-d, K-6-f/g, K-7-a..d, K-8-b/d/e/f/g, M-6-e/f/g
- 모든 wire-form (api.ts export 일치) → L-1 ~ L-21 의 모든 leaf
- 모든 빌드 step (release.sh 의 script step) — script 존재 + 권한 확인 → A-1 ~ A-5
- 모든 plist/json config key 존재 검증 → B-4, B-5, B-6, B-7-b, B-12, B-13
- 모든 ADR / 문서 파일 존재 → G-11, I-5
- 테스트 suite 자체 (J-1, J-2, J-3) → ✅A

**자동 통과로 ✅A 적용된 leaf 수**: ~390 개 (약 84%)

**수동 검증 필요 (⚠M) leaf**: ~73 개 — UI 렌더링 / runtime 동작 / cross-host 실 송수신
**검증 불가 (⚠X) leaf**: 1 개 — J-4-a (gap, code 없음)

### Commit 약어

| 약어 | SHA | 의미 |
|---|---|---|
| `port` | `4e353d0` | 최초 Mac 측 Tauri+React 포팅 |
| `v0.2` | `9d73bf7` → `27be14f` | Windows v0.2 contract parity / verify / clipboard images |
| `v0.2.1` | `69169c1` | single-instance + Service immediate-send + disk perms |
| `v0.2.2` | `480bc82` | FDA auto-register / Space follow |
| `v0.2.3` | `e25865b` | re-show perms modal + release devtools |
| `v0.2.4` | `6ff9045` | share-changed router + offline clipboard cache |
| `WA` | `379f012` | Wave A — quality framework + clipboard expose + auto-verify + git skeleton |
| `WB-1` | `4fc8400` | Wave B-1 — Log Hub + HTML inspector |
| `WB-2` | `aae7243` | Wave B-2 — real git impl + TS data layer |
| `WC1` | `d46105d` | Wave C1 — L1 git dashboard + PAT/SSH UX |
| `WC2` | `3ccae97` | Wave C2 — L2 detail modal + L3 raw inspector |
| `WC3` | `f7a2359` | Wave C3 — shared clipboard panel |
| `v0.3.0` | `6c2dec9` | v0.3.0 release |
| `UX` | `dbc0ab6` | lucide + collapsible sidebar |
| `T44` | `4207c13` | Task #44 — interactive git ops |
| `T45` | `35a9677` | Task #45 — PAT cross-host sync (age + ssh) |
| `T46` | `dbcc9e4` | Task #46 — preview panel |
| `T47` | `4c4b1d7` | Task #47 — CI check-runs overlay |
| `T48` | `aacff19` | Task #48 — notifications |
| `T49` | `a7ab61e` | Task #49 — ssh auto-gen on publish |
| `T50` | `f798982` | Task #50 — git settings UX |
| `T51-a..c` | `04f4c21`,`5bf67bd`,`b391218`,`5afe66e` | Task #51 — mDNS discovery (initial + perms + fix + fallback) |
| `T52` | `320a19d` | Task #52 — toolbar result strip |
| `T53` | `d8e20e8`,`055a43f` | Task #53 — parallel scan + DMG fallback |

### Leaf detail format

`<id> · <name> · <Status> · <commit> · <cross-os> · ✅A · [meta:...] [한계: ...]`

## 2. Sub-domain rollup

| Sub-domain | Leaves | Status | Cross-OS | Notes |
|---|---|---|---|---|
| **A-1** 빌드 환경 | 7 | impl | N/A | env / Cargo / vite 등 Mac 전용 도구체인 |
| **A-2** 코드 서명 | 3 | impl | N/A | Developer ID 인증서 — Mac 전용 |
| **A-3** 노타리 | 5 | impl | N/A | xcrun notarytool — Mac 전용 |
| **A-4** Updater minisign | 4 | impl | N/A | minisign keypair — Mac 측에 적용 |
| **A-5** 릴리스 파이프라인 | 11 | impl | N/A | release.sh 8 단계 — Mac 전용 |
| **A-6** Tauri bundle | 5 | impl | ✓ | bundle 구성 (Windows 측도 동일 schema) |
| **A-7** 업데이터 클라이언트 | 8 | partial | ✓ | UpdaterBanner DMG fallback 있음. 자동 설치 root cause 미해결 — §4 spotlight |
| **A-8** 릴리스 노트 | 8 | impl | ✓ | AnnouncementModal 양쪽 동일 |
| **A-9** CLI 설치 | 1 | impl | N/A | mac_gui/install.sh — Mac 전용 |
| **B-1** TCC FDA | 4 | impl | N/A | macOS TCC — Mac 전용 |
| **B-2** Keychain (PAT) | 5 | impl | ✓ | Windows 측은 DPAPI (다른 메커니즘, 동일 contract) |
| **B-3** ~/.ssh 메타 | 4 | impl | ✓ | ssh-keygen 양 OS |
| **B-4** Local Network | 2 | impl | N/A | macOS Sonoma+ 특이 |
| **B-5** Hardened Runtime | 6 | impl | N/A | Mac 전용 |
| **B-6** Info.plist usage | 4 | impl | N/A | Mac 전용 |
| **B-7** AppleEvents | 2 | impl | N/A | Mac 전용 |
| **B-8** Codesign identity | 2 | impl | N/A | |
| **B-9** Notary credentials | 1 | impl | N/A | |
| **B-10** Age + ssh 암호화 | 3 | impl | ✗ | Windows 측 backport 필요 (Task #45 Mac-only) |
| **B-11** Space follow | 2 | impl | N/A | NSWindowCollectionBehavior — Mac 전용 |
| **B-12** Tauri capabilities | 3 | impl | ✓ | Windows 측도 동일 ACL 시스템 |
| **B-13** assetProtocol scope | 3 | impl | ✓ | |
| **C-1** SMB 마운트 | 8 | impl | ✓ | Windows 측은 `net use` |
| **C-2** mDNS discovery | 6 | impl | ✗ | Task #51 Mac-only — Windows mirror 미구현 |
| **C-3** 네트워크 진단 | 3 | impl | ✓ | |
| **C-4** 셰어 root | 4 | impl | ✓ | MW_SHARE_ROOT env 양쪽 동일 |
| **D-1** Transfer engine | 7 | impl | ✓ | wire-form L-1 |
| **D-2** Manifest | 4 | impl | ✓ | canonical JSON 양쪽 byte-identical |
| **D-3** Checksum | 4 | impl | ✓ | |
| **D-4** Naming | 5 | impl | ✓ | NFC normalization 양쪽 동일 |
| **D-5** RAW_SECRET | 1 | partial | ✓ | 한계: 기본 패턴만, 사용자 확장 unavail — §4 |
| **D-6** Sent history | 3 | impl | ✓ | |
| **D-7** Transfer log | 1 | impl | ✓ | |
| **D-8** Tauri commands (transfer) | 6 | impl | ✓ | |
| **D-9** Inbox/Outbox UI | 8 | impl | ✓ | |
| **D-10** HTML inspect | 3 | impl | ✓ | WB-1 |
| **D-11** Verify cache | 2 | impl | ✓ | |
| **D-12** Categories | 4 | impl | ✓ | |
| **D-13** File preview | 2 | impl | ✗ | T46 Mac-only — Windows backport 필요 |
| **D-14** Open/reveal | 2 | impl | ✓ | |
| **D-15** Argv-driven send | 5 | impl | ✓ | windows_gui 의 launcher.vbs equivalent |
| **D-16** e2e send script | 1 | impl | ✗ | Mac 측만 |
| **D-17** Transfer errors | 3 | impl | ✓ | exit code 양쪽 mirror |
| **E-1** Clipboard 폴러 | 1 | impl | ✓ | |
| **E-2** Clipboard history | 5 | impl | ✓ | text + image |
| **E-3** PNG encode/decode | 2 | impl | ✓ | |
| **E-4** Image dedup | 4 | impl | ✓ | TTL 30d 양쪽 동일 |
| **E-5** Share-back sync | 1 | impl | ✓ | |
| **E-6** Sticky (current.json) | 4 | impl | ✓ | WC3 |
| **E-7** Clipboard commands | 10 | impl | ✓ | |
| **E-8** Clipboard UI | 2 | impl | ✓ | |
| **E-9** JSONL utils | 2 | impl | ✓ | |
| **E-10** Notes core | 8 | impl | ✓ | last-write-wins |
| **E-11** Notes commands | 4 | impl | ✓ | |
| **E-12** Notes UI | 1 | impl | ✓ | |
| **F-1** Git scan | 12 | partial | ✓ | F-1-c rayon optimized; libgit2 option B 미적용 — §4 |
| **F-2** 셰어 저장소 (90_Git) | 7 | impl | ✓ | Wave B-2 |
| **F-3** PAT cross-host sync | 7 | impl | ✗ | T45 Mac-only |
| **F-4** SSH key bootstrap | 2 | impl | ✓ | (B-3 cross-ref) |
| **F-5** GitHub remote API | 6 | partial | ✓ | F-5-c paging 한계 — §4 |
| **F-6** CI check-runs | 3 | impl | ✗ | T47 Mac-only |
| **F-7** Interactive git ops | 8 | partial | ✗ | T44 Mac-only; F-7-e push 인터랙티브 거절 미처리 — §4 |
| **F-8** L1 Dashboard | 9 | impl | ✓ | classifyCard 테스트 통과 |
| **F-9** L2 Detail modal | 1 | impl | ✓ | WC2 |
| **F-10** L3 Inspector (5 tabs) | 7 | impl | ✓ | WC2 + T47 (CheckRunBadge) |
| **F-11** Git toolbars | 2 | impl | ✓ | T52 inline result strip |
| **F-12** Token/SSH settings UI | 2 | impl | ✗ | T49/T50 Mac-side UX 개선 |
| **F-13** Brand icons | 2 | impl | ✓ | |
| **G-1** Global theme/tokens | 4 | impl | ✓ | ADR-0001/0005 |
| **G-2** Sidebar | 7 | impl | ✓ | UX collapsible — `dbc0ab6` |
| **G-3** Modal chrome | 1 | impl | ✓ | ADR-0002 |
| **G-4** Toast UI | 2 | impl | ✓ | |
| **G-5** Drop overlay | 1 | impl | ✓ | (D-9-d cross-ref) |
| **G-6** Icons | 7 | impl | ✓ | lucide + BrandIcons |
| **G-7** Format helpers | 3 | impl | ✓ | |
| **G-8** Settings UI sections | 8 | impl | ✓ | 7 sections + host |
| **G-9** i18n | 2 | impl | ✓ | 한/영 컨벤션 |
| **G-10** Drag-drop visual | 2 | impl | ✓ | |
| **G-11** ADRs | 5 | impl | ✓ | 5 ADRs |
| **G-12** Root layout | 3 | impl | ✓ | |
| **H-1** Toast (mechanism) | 4 | impl | ✓ | |
| **H-2** Native notification | 3 | impl | ✗ | T48 Mac-only (NotificationExt) |
| **H-3** Webhook | 2 | impl | ✗ | T48 Mac-only |
| **H-4** Dispatch router | 4 | impl | ✗ | T48 Mac-only |
| **I-1** Log Hub | 6 | impl | ✓ | WB-1; rotation 1000 lines |
| **I-2** Logs UI | 2 | impl | ✓ | |
| **I-3** Verify cache | — | — | — | (D-11 cross-ref) |
| **I-4** Markdown WORKLOG | 2 | impl | ✓ | WA + ad-hoc |
| **I-5** Quality docs | 16 | impl | ✓ | TAXONOMY/CODE_MAP/AUDIT 등 |
| **J-1** Cargo unit tests | 4 | impl | ✓ | 64 tests pass (last check) |
| **J-2** Vitest | 4 | impl | ✓ | 19 tests |
| **J-3** Playwright | 4 | impl | ✓ | 9 tests |
| **J-4** L4 tauri-driver | 1 | gap | pending | deferred — §4 |
| **J-5** L5 cross-OS walk | 1 | partial | pending | INTEGRATION_TEST 12 시나리오, 6 walked — §4 |
| **J-6** e2e send script | 1 | impl | ✗ | (D-16-a cross-ref) |
| **K-1** settings.json IO | 3 | impl | ✓ | |
| **K-2** Frontend settings store | 4 | impl | ✓ | |
| **K-3** localStorage flags | 3 | impl | ✓ | |
| **K-4** Rust Settings struct | 9 | impl | ✓ | |
| **K-5** Policy storage | 4 | impl | ✓ | |
| **K-6** Host profile/presets | 8 | impl | ✓ | |
| **K-7** Icon theme install | 6 | impl | ✓ | VSIX + git URL + folder |
| **K-8** Tree view | 7 | impl | ✓ | |
| **L-1..L-21** Schemas | 38 | impl | ✓ | wire-form 양쪽 byte-identical |
| **M-1** Boot sequence | 6 | impl | ✓ | |
| **M-2** Watcher cycles | 5 | impl | ✓ | notify + polling fallback |
| **M-3** Clipboard poller | 1 | impl | ✓ | (E-1 cross-ref) |
| **M-4** Event router | 6 | impl | ✓ | share-changed / transfers-changed 등 |
| **M-5** Frontend event listener | 2 | impl | ✓ | |
| **M-6** Desktop alias | 8 | impl | N/A | macOS symlink — Mac 전용 |
| **M-7** Single-instance / Space | 2 | impl | N/A | macOS NSWindowCollectionBehavior |
| **M-8** Onboarding gates | 2 | impl | ✓ | |
| **M-9** Auto-verify sweep | 1 | impl | ✓ | |
| **N-1** Vendor app (Swift) | 6 | impl | N/A | Mac NSServices |
| **N-2** Vendor Info.plist | 8 | impl | N/A | |
| **N-3** Vendor entitlements | 1 | impl | N/A | |
| **N-4** Vendor build | 2 | impl | N/A | |
| **N-5** Vendor install | 1 | impl | N/A | |

**요약**: 138 sub-domain 중 `impl` = 130 / `partial` = 7 / `gap` = 1. M4 검수 시작 대상은 모든 138 sub-domain.

## 3. Leaf detail (compact)

각 줄: `<id> · Status · commit · cross-os · ✅A`. impl + 단순 항목은 commit 만 표기.
한계 / 메타 있는 항목은 inline 표기.

### Domain A — 앱 패키징 / 업데이트

```
A-1-a env.sh                  · impl · port      · N/A · ✅A
A-1-b build.rs                · impl · port      · ✓   · ✅A
A-1-c Cargo profile           · impl · port      · ✓   · ✅A
A-1-d package.json scripts    · impl · port      · ✓   · ✅A
A-1-e tsconfig/vite/node      · impl · port      · ✓   · ✅A
A-1-f UPDATER_TARGET env      · impl · port      · N/A · ✅A
A-1-g gen/schemas (artifact)  · impl · port      · N/A · ✅A

A-2-a sign-app.sh             · impl · port      · N/A · ✅A
A-2-b APPLE_SIGNING_IDENTITY  · impl · port      · N/A · ✅A
A-2-c Hardened Runtime 첨부   · impl · port      · N/A · ✅A

A-3-a setup-notary.sh         · impl · port      · N/A · ✅A
A-3-b notarize.sh             · impl · port      · N/A · ✅A
A-3-c keychain profile        · impl · port      · N/A · ✅A
A-3-d ASC_API_* env           · impl · port      · N/A · ✅A
A-3-e .p8 위치                · impl · port      · N/A · ✅A

A-4-a setup-updater.sh        · impl · port      · N/A · ✅A
A-4-b minisign key 위치       · impl · port      · N/A · ✅A
A-4-c pubkey injection        · impl · port      · N/A · ✅A
A-4-d TAURI_SIGNING_PRIVATE_KEY_PASSWORD · impl · port · N/A · ✅A

A-5-a release.sh orchestrator · impl · port      · N/A · ✅A
A-5-b pre-flight sanity       · impl · port      · N/A · ✅A
A-5-c DMG 생성 (hdiutil)      · impl · port      · N/A · ✅A
A-5-d updater payload sign    · impl · port      · N/A · ✅A
A-5-e latest.json             · impl · port      · ✓   · ✅A  (wire-form L-15)
A-5-f gh release create       · impl · runbook   · N/A · ✅A  (수동)
A-5-g cargo tauri build step  · impl · port      · N/A · ✅A
A-5-h launcher bundle step    · impl · port      · N/A · ✅A
A-5-i stage 2 apps + symlink  · impl · port      · N/A · ✅A
A-5-j DMG codesign            · impl · port      · N/A · ✅A
A-5-k notarize + staple       · impl · port      · N/A · ✅A

A-6-a bundle.macOS            · impl · port      · ✓   · ✅A
A-6-b bundle version          · impl · port      · ✓   · ✅A  (0.3.1)
A-6-c bundle.resources        · impl · port      · ✓   · ✅A
A-6-d bundle.icon             · impl · port      · ✓   · ✅A
A-6-e bundle.targets ["app"]  · impl · port      · ✓   · ✅A

A-7-a plugins.updater         · impl · port      · ✓   · ✅A
A-7-b updater pubkey          · impl · port      · ✓   · ✅A
A-7-c updater endpoint        · impl · port      · ✓   · ✅A
A-7-d checkForUpdate          · impl · port      · ✓   · ✅A
A-7-e checkForUpdateDetailed  · impl · v0.2.4    · ✓   · ✅A
A-7-f UpdaterBanner           · partial · v0.3.1 · ✓   · ✅A  [한계: 자동 설치 silent fail, root cause 미해결 — §4 SP-A-1]
A-7-g DMG fallback button     · impl · v0.3.1    · ✓   · ✅A  meta:fallback
A-7-h tauri-plugin-updater    · impl · port      · ✓   · ✅A

A-8-a RELEASES.json bundling  · impl · port      · ✓   · ✅A
A-8-b announcement::load      · impl · port      · ✓   · ✅A
A-8-c releases_path           · impl · port      · ✓   · ✅A
A-8-d get_release_notes       · impl · port      · ✓   · ✅A
A-8-e current_app_version     · impl · port      · ✓   · ✅A
A-8-f AnnouncementModal       · impl · port      · ✓   · ✅A
A-8-g LAST_SEEN gate          · impl · port      · ✓   · ✅A
A-8-h welcome 분기            · impl · v0.2.3    · ✓   · ✅A

A-9-a install.sh (mw CLI)     · impl · port      · N/A · ✅A
```

### Domain B — 권한 / 보안 / 키

```
B-1-a has_full_disk_access    · impl · v0.2.2    · N/A · ✅A
B-1-b open_privacy_settings   · partial · v0.2.2 · N/A · ⚠M  [§4 SP-B-1 — multi-path trigger 가 필요. v0.3.2 에서 B-1-e 추가로 해결, walk 재실행 필요]
B-1-c PermissionsOnboarding   · partial · v0.2.2 · N/A · ⚠M  [§4 SP-B-1 — trigger sequencing 추가됨, walk 재실행 필요]
B-1-d App.tsx onboarding gate · impl · v0.2.3    · N/A · ✅A
B-1-e trigger_mac_tcc_registration · impl · v0.3.2 · N/A · ⚠M  [§4 SP-B-1 — 신설, clean state walk 검증 필요]

B-2-a keyring_entry helper    · impl · WB-2      · ✓   · ✅A  meta:security:secret-redaction
B-2-b git_set_token           · impl · WB-2      · ✓   · ✅A  meta:security
B-2-c git_has_token           · impl · WB-2      · ✓   · ✅A
B-2-d git_clear_token         · impl · WB-2      · ✓   · ✅A
B-2-e get_token (internal)    · impl · WB-2      · ✓   · ✅A

B-3-a my_ssh_pub_path         · impl · T45       · ✓   · ✅A
B-3-b my_ssh_priv_path        · impl · T45       · ✓   · ✅A
B-3-c git_ssh_status (= F-4-a) · impl · T45      · ✓   · ✅A
B-3-d git_generate_ssh_key (= F-4-b) · impl · T45 · ✓  · ✅A

B-4-a NSLocalNetworkUsageDesc · impl · T51-b     · N/A · ✅A
B-4-b NSBonjourServices       · impl · T51-b     · N/A · ✅A

B-5-a allow-jit               · impl · port      · N/A · ✅A
B-5-b allow-unsigned-exec-mem · impl · port      · N/A · ✅A
B-5-c disable-library-validation · impl · port   · N/A · ✅A
B-5-d network.client          · impl · port      · N/A · ✅A
B-5-e network.server          · impl · T51-b     · N/A · ✅A
B-5-f Entitlements.plist 파일 · impl · port      · N/A · ✅A

B-6-a NSDesktop/Documents/Downloads/RemovableVolumes/NetworkVolumes folder family · impl · port · N/A · ✅A
B-6-b LSUIElement / app activation · impl · port · N/A · ✅A
B-6-c App display name + bundle id · impl · port · N/A · ✅A
B-6-d NSWindowCollectionBehavior keys · impl · v0.2.2 · N/A · ✅A

B-7-a Vendor → Tauri IPC      · impl · v0.2.1    · N/A · ✅A
B-7-b NSAppleEventsUsageDesc  · impl · port      · N/A · ✅A

B-8-a security find-identity 사용 · impl · port  · N/A · ✅A
B-8-b APPLE_SIGNING_IDENTITY 값 · impl · port    · N/A · ✅A

B-9-a notary keychain profile · impl · port      · N/A · ✅A

B-10-a age ssh feature        · impl · T45       · ✗   · ✅A  [backport-needed]
B-10-b host pubkey publication · impl · T45      · ✗   · ✅A
B-10-c age cipher contract    · impl · T45       · ✗   · ✅A  cross-ref L-13

B-11-a apply_macos_space_behavior · impl · v0.2.2 · N/A · ✅A
B-11-b MOVE_TO_ACTIVE_SPACE 비트 · impl · v0.2.2 · N/A · ✅A

B-12-a capabilities/default.json · impl · port   · ✓   · ✅A
B-12-b 12 permission entries  · impl · port      · ✓   · ✅A
B-12-c windows: ["main"]      · impl · port      · ✓   · ✅A

B-13-a assetProtocol.enable   · impl · port      · ✓   · ✅A
B-13-b scope: ["**"]          · impl · port      · ✓   · ✅A  meta:security (와일드카드 trade-off)
B-13-c csp: null              · impl · port      · ✓   · ✅A
```

### Domain C — 직결망 / 네트워크 / 마운트

```
C-1-a is_share_mounted        · impl · port      · ✓   · ✅A
C-1-b current_mount_url       · impl · port      · ✓   · ✅A
C-1-c ensure_mounted          · impl · port      · ✓   · ✅A
C-1-d parse_mount_output      · impl · port      · ✓   · ✅A
C-1-e parse_mount_line        · impl · port      · ✓   · ✅A
C-1-f mount_status            · impl · port      · ✓   · ✅A
C-1-g ensure_mount            · impl · port      · ✓   · ✅A
C-1-h mw_cli_path             · impl · port      · ✓   · ✅A

C-2-a discover_smb_hosts      · impl · T51-a/c   · ✗   · ✅A  meta:perf:bonjour-multi-service [backport-needed]
C-2-b mounted_smb_hosts       · impl · T51-d     · ✗   · ✅A  meta:fallback
C-2-c is_likely_windows       · impl · T51-a     · ✗   · ✅A
C-2-d Bonjour service list    · impl · T51-c     · ✗   · ✅A
C-2-e mac_local_host          · impl · T51-c     · ✗   · ✅A  (self-filter fix)
C-2-f SmbHost wire (L-19-a)   · impl · T51-a     · ✗   · ✅A

C-3-a check_connection        · impl · port      · ✓   · ✅A
C-3-b speed_test_local        · impl · port      · ✓   · ✅A
C-3-c ConnectionStatus / SpeedResult · impl · port · ✓ · ✅A

C-4-a share_root()            · impl · port      · ✓   · ✅A
C-4-b share_root_str()        · impl · port      · ✓   · ✅A
C-4-c share_root command      · impl · port      · ✓   · ✅A
C-4-d MW_SHARE_ROOT env       · impl · port      · ✓   · ✅A
```

### Domain D — 파일 교환

```
D-1-a engine::send            · impl · port      · ✓   · ✅A
D-1-b engine::build_request   · impl · port      · ✓   · ✅A
D-1-c engine::resolve_category · impl · port     · ✓   · ✅A
D-1-d engine::copy_path / copy_dir_recursive · impl · port · ✓ · ✅A
D-1-e engine::atomic_write    · impl · port      · ✓   · ✅A
D-1-f engine::remove_existing · impl · port      · ✓   · ✅A
D-1-g engine::hostname_or     · impl · port      · ✓   · ✅A

D-2-a make_transfer_id        · impl · port      · ✓   · ✅A
D-2-b encode_json (canonical) · impl · port      · ✓   · ✅A
D-2-c decode                  · impl · port      · ✓   · ✅A
D-2-d sort_value              · impl · port      · ✓   · ✅A

D-3-a checksum::render_file   · impl · port      · ✓   · ✅A
D-3-b checksum::render_directory · impl · port   · ✓   · ✅A
D-3-c sha256_file             · impl · port      · ✓   · ✅A
D-3-d dir_hash                · impl · port      · ✓   · ✅A

D-4-a..d naming family        · impl · port      · ✓   · ✅A
D-4-e timestamps family       · impl · port      · ✓   · ✅A

D-5-a raw_secret::check       · partial · port   · ✓   · ✅A  [한계: 패턴 하드코딩, 사용자 확장 X — §4 SP-D-1]

D-6-a..c sent_history family  · impl · port      · ✓   · ✅A

D-7-a transfer/log::render    · impl · port      · ✓   · ✅A

D-8-a send_path               · impl · port      · ✓   · ✅A
D-8-b send_path_force         · impl · port      · ✓   · ✅A
D-8-c list_transfers          · impl · port      · ✓   · ✅A
D-8-d read_manifest           · impl · port      · ✓   · ✅A
D-8-e verify_transfer         · impl · v0.2      · ✓   · ✅A
D-8-f auto_verify_pending     · impl · WA        · ✓   · ✅A

D-9-a ItemsView               · impl · port      · ✓   · ✅A
D-9-b DetailsModal            · impl · port      · ✓   · ✅A
D-9-c CategoryPickerModal     · impl · port      · ✓   · ✅A
D-9-d DropOverlay             · impl · port      · ✓   · ✅A
D-9-e PreviewPanel            · impl · T46       · ✗   · ✅A  [backport-needed]
D-9-f HtmlInspectorModal      · impl · WB-1      · ✓   · ✅A
D-9-g useSendFlow             · impl · WB-1      · ✓   · ✅A
D-9-h useDragDrop             · impl · port      · ✓   · ✅A

D-10-a html_extract_refs      · impl · WB-1      · ✓   · ✅A
D-10-b html_classify_asset    · impl · WB-1      · ✓   · ✅A
D-10-c inspect_html_assets    · impl · WB-1      · ✓   · ✅A

D-11-a verify_cache_dir       · impl · WA        · ✓   · ✅A
D-11-b VerifyResult wire      · impl · v0.2      · ✓   · ✅A

D-12-a..d categories          · impl · port      · ✓   · ✅A

D-13-a read_file_preview      · impl · T46       · ✗   · ✅A  [backport-needed]
D-13-b FilePreview wire       · impl · T46       · ✗   · ✅A

D-14-a open_path              · impl · port      · ✓   · ✅A
D-14-b reveal_in_explorer     · impl · port      · ✓   · ✅A

D-15-a parse_args             · impl · v0.2.1    · ✓   · ✅A
D-15-b handle_launch_args     · impl · v0.2.1    · ✓   · ✅A
D-15-c on_second_instance     · impl · v0.2.1    · ✓   · ✅A
D-15-d dispatch (argv router) · impl · v0.2.1    · ✓   · ✅A
D-15-e immediate_send_batch   · impl · v0.2.1    · ✓   · ✅A

D-16-a e2e-send.sh            · impl · port      · ✗   · ✅A

D-17-a TransferError enum     · impl · port      · ✓   · ✅A
D-17-b exit_code mapping      · impl · port      · ✓   · ✅A  meta:cross-os-contract
D-17-c From<io::Error> + Display · impl · port   · ✓   · ✅A
```

### Domain E — 클립보드 / 메모

```
E-1-a start_poller            · impl · v0.2      · ✓   · ✅A
E-2-a append_entry (text)     · impl · v0.2      · ✓   · ✅A
E-2-b append_image_entry      · impl · v0.2      · ✓   · ✅A
E-2-c list_entries            · impl · v0.2      · ✓   · ✅A
E-2-d own_history_path        · impl · v0.2      · ✓   · ✅A
E-2-e entry_key (dedup)       · impl · v0.2      · ✓   · ✅A

E-3-a encode_png              · impl · v0.2      · ✓   · ✅A
E-3-b decode_png              · impl · v0.2      · ✓   · ✅A

E-4-a image_path_for_ref      · impl · v0.2      · ✓   · ✅A
E-4-b cleanup_old_images (30d) · impl · v0.2     · ✓   · ✅A
E-4-c list_compressed_images  · impl · v0.2      · ✓   · ✅A
E-4-d compressed_image_path   · impl · v0.2      · ✓   · ✅A

E-5-a sync_to_share           · impl · v0.2.4    · ✓   · ✅A

E-6-a read_shared_clipboard   · impl · WC3       · ✓   · ✅A
E-6-b write_shared_clipboard  · impl · WC3       · ✓   · ✅A
E-6-c prune_shared_clipboard_history · impl · WC3 · ✓  · ✅A
E-6-d list_clipboard_history  · impl · WC3       · ✓   · ✅A

E-7-a..j 10 commands          · impl · WA/WC3    · ✓   · ✅A

E-8-a ClipboardView           · impl · port      · ✓   · ⚠M  [sticky 제거 — 타임라인 전용 단일책임화, Session C 재walk]
E-8-b SharedClipboardPanel    · dep  · WC3→2026-06-01 · ✓ · ✅A  [DEPRECATED — Notes(E-12-a) 중복으로 frontend 제거. backend L-4 위해 유지. §SP-E-1]

E-9-a append_jsonl_line       · impl · v0.2      · ✓   · ✅A
E-9-b rotate_jsonl            · impl · v0.2      · ✓   · ✅A

E-10-a..h notes core (8 leaves) · impl · port    · ✓   · ✅A
E-11-a..d notes commands       · impl · port     · ✓   · ✅A
E-12-a NotesView              · impl · port      · ✓   · ✅A
```

### Domain F — Git

```
F-1-a scan_git_repos          · impl · WB-2      · ✓   · ✅A
F-1-b publish_git_status      · impl · WB-2      · ✓   · ✅A
F-1-c scan_and_publish_git    · partial · T53    · ✓   · ✅A  meta:perf:rayon [한계: git CLI subprocess — libgit2 option B 미적용 — §4 SP-F-1]
F-1-d scan_root_for_repos     · impl · WB-2      · ✓   · ✅A
F-1-e publish_status_snapshot · impl · WB-2      · ✓   · ✅A
F-1-f repo_status_at          · impl · WB-2      · ✓   · ✅A
F-1-g default_scan_roots      · impl · WB-2      · ✓   · ✅A
F-1-h default_exclude_dirs    · impl · WB-2      · ✓   · ✅A
F-1-i run_git CLI invocation  · impl · WB-2      · ✓   · ✅A
F-1-j normalize_owner_repo    · impl · WB-2      · ✓   · ✅A
F-1-k repo_commit_log         · impl · WB-2      · ✓   · ✅A
F-1-l graph_branches          · impl · WB-2      · ✓   · ✅A

F-2-a..g 90_Git storage (7)   · impl · WB-2      · ✓   · ✅A

F-3-a git_publish_host_pubkey · impl · T45/T49   · ✗   · ✅A  [backport-needed]
F-3-b list_peer_pubkeys       · impl · T45       · ✗   · ✅A
F-3-c git_share_pat_to_peers  · impl · T45       · ✗   · ✅A  meta:security:secret-redaction
F-3-d git_pull_pat_from_share · impl · T45       · ✗   · ✅A
F-3-e share_config_dir/host_keys_dir/git_token_share_dir/my_host_sanitized · impl · T45 · ✗ · ✅A
F-3-f git_test_token          · impl · WB-2      · ✓   · ✅A
F-3-g pullPatFromShare auto-import · impl · T45  · ✗   · ✅A

F-4-a..b (cross-ref B-3-c/d)  · impl · T45       · ✓   · ✅A

F-5-a gh_get HTTP helper      · impl · WB-2      · ✓   · ✅A
F-5-b fetch_one_remote        · impl · WB-2      · ✓   · ✅A
F-5-c fetch_remote_commits    · partial · WB-2   · ✓   · ✅A  [한계: GitHub REST 기본 30개 paginate 안 함 — §4 SP-F-2]
F-5-d github_fetch_remote     · impl · WB-2      · ✓   · ✅A
F-5-e read_remote_cache       · impl · WB-2      · ✓   · ✅A
F-5-f build_repo_graph        · impl · WB-2      · ✓   · ✅A

F-6-a github_fetch_check_runs · impl · T47       · ✗   · ✅A  [backport-needed]
F-6-b classify_check_runs     · impl · T47       · ✗   · ✅A
F-6-c → F-10-b cross-ref      · — · — · — · —

F-7-a run_git_op helper       · impl · T44       · ✗   · ✅A
F-7-b log_op (log_hub append) · impl · T44       · ✗   · ✅A
F-7-c git_op_fetch            · impl · T44       · ✗   · ✅A
F-7-d git_op_pull             · impl · T44       · ✗   · ✅A
F-7-e git_op_push             · partial · T44    · ✗   · ✅A  meta:security:secret-redaction [한계: 인터랙티브 prompt(push reject/conflict) 미처리 — §4 SP-F-3]
F-7-f git_op_stash            · impl · T44       · ✗   · ✅A
F-7-g git_op_stash_pop        · impl · T44       · ✗   · ✅A
F-7-h git_list_branches       · impl · T44       · ✗   · ✅A

F-8-a GitView                 · impl · WC1       · ✓   · ✅A
F-8-b RepoCard                · impl · WC1       · ✓   · ✅A
F-8-c ThreeNodeBridge         · impl · WC1       · ✓   · ✅A
F-8-d GitProvider / useGitStore · impl · WC1     · ✓   · ✅A
F-8-e uniqueOwnerRepos        · impl · WC1       · ✓   · ✅A
F-8-f computeGitNarrative     · impl · WC2       · ✓   · ✅A  (테스트: J-2-c)
F-8-g worstVerdict / tallyVerdicts · impl · WC2  · ✓   · ✅A
F-8-h classifyCard            · impl · WC1       · ✓   · ✅A  (테스트: J-2-d)
F-8-i RepoCardSummary / Kind  · impl · WC1       · ✓   · ✅A

F-9-a GitDetailModal          · impl · WC2       · ✓   · ✅A

F-10-a GitInspectorModal shell · impl · WC2      · ✓   · ✅A
F-10-b CheckRunBadge          · impl · T47       · ✗   · ✅A
F-10-c RawDiffsTab            · impl · WC2       · ✓   · ✅A
F-10-d DaemonLogsTab          · impl · WC2       · ✓   · ✅A
F-10-e GitConfigTab           · impl · WC2       · ✓   · ✅A
F-10-f AllCommitsTab          · impl · WC2       · ✓   · ✅A
F-10-g SyncTimelineTab        · impl · WC2       · ✓   · ✅A

F-11-a GitToolbar             · impl · WC1/T52   · ✓   · ✅A
F-11-b GitOpsBar              · impl · T44/T52   · ✗   · ✅A

F-12-a TokenSettings          · impl · T50       · ✗   · ✅A
F-12-b SshSettings            · impl · T49/T50   · ✗   · ✅A

F-13-a GithubBrand            · impl · UX        · ✓   · ✅A
F-13-b WindowsBrand           · impl · UX        · ✓   · ✅A
```

### Domain G — 디자인 / UI

```
G-1-a CSS color tokens (light) · impl · port     · ✓   · ✅A  (ADR-0001)
G-1-b layout primitives       · impl · port      · ✓   · ✅A
G-1-c card variants           · impl · WC1       · ✓   · ✅A
G-1-d modal chrome            · impl · port      · ✓   · ✅A  (ADR-0002)

G-2-a Sidebar component       · impl · port      · ✓   · ✅A
G-2-b Pinned 영역             · impl · UX        · ✓   · ✅A
G-2-c Scrollable + Log Hub group · impl · WB-1   · ✓   · ✅A
G-2-d NAV_GROUPS              · impl · port      · ✓   · ✅A
G-2-e LOG_CATEGORIES          · impl · WB-1      · ✓   · ✅A
G-2-f DEFAULT_SELECTION       · impl · port      · ✓   · ✅A
G-2-g SidebarSelection type   · impl · port      · ✓   · ✅A

G-3-a Modal base              · impl · port      · ✓   · ✅A

G-4-a ToastProvider/useToast  · impl · port      · ✓   · ✅A
G-4-b Toast CSS               · impl · port      · ✓   · ✅A

G-5-a DropOverlay (cross-ref D-9-d) · impl · port · ✓  · ✅A

G-6-a IconThemeProvider       · impl · port      · ✓   · ✅A
G-6-b resolveInTheme          · impl · port      · ✓   · ✅A
G-6-c IconImg                 · impl · port      · ✓   · ✅A
G-6-d iconForExt              · impl · port      · ✓   · ✅A
G-6-e asciiForExt             · impl · port      · ✓   · ✅A
G-6-f CATEGORY_FOLDER_CANDIDATES · impl · port   · ✓   · ✅A
G-6-g CategoryIcon            · impl · port      · ✓   · ✅A

G-7-a parseTransferName / prettyName · impl · port · ✓ · ✅A
G-7-b fmtBytes / fmtRelative / fmtFull · impl · port · ✓ · ✅A
G-7-c basename                · impl · port      · ✓   · ✅A

G-8-a SettingsView            · impl · port      · ✓   · ✅A
G-8-b TreeSection             · impl · port      · ✓   · ✅A
G-8-c NetworkSection          · impl · T51       · ✗   · ✅A  (mDNS UI)
G-8-d PolicySection           · impl · port      · ✓   · ✅A
G-8-e AppearanceSection       · impl · port      · ✓   · ✅A
G-8-f GitSection              · impl · WC1/T50   · ✗   · ✅A
G-8-g NotificationSection     · impl · T48       · ✗   · ✅A
G-8-h UpdateSection           · impl · v0.2.4    · ✓   · ✅A

G-9-a Sidebar 영어 라벨       · impl · UX        · ✓   · ✅A
G-9-b 한글 toast/모달 컨벤션  · impl · port      · ✓   · ✅A

G-10-a useDragDrop (cross-ref D-9-h) · impl · port · ✓ · ✅A
G-10-b dragging state + overlay · impl · port    · ✓   · ✅A

G-11-a ADR-0001 (inspector light) · impl · 3318aa4 · ✓ · ✅A
G-11-b ADR-0002 (modal overflow)  · impl · d963a85 · ✓ · ✅A
G-11-c ADR-0003 (timeline)        · impl · 3318aa4 · ✓ · ✅A
G-11-d ADR-0004 (narrative)       · impl · aaa4465 · ✓ · ✅A
G-11-e ADR-0005 (mac overrides)   · impl · WC2     · ✓ · ✅A

G-12-a App/AppInner           · impl · port      · ✓   · ✅A
G-12-b main.tsx React mount   · impl · port      · ✓   · ✅A
G-12-c Provider stack         · impl · port      · ✓   · ✅A
```

### Domain H — 외부 알림

```
H-1-a ToastProvider           · impl · port      · ✓   · ✅A
H-1-b useToast                · impl · port      · ✓   · ✅A
H-1-c TTL_MS (4200ms)         · impl · port      · ✓   · ✅A
H-1-d ToastKind enum          · impl · port      · ✓   · ✅A

H-2-a tauri-plugin-notification 등록 · impl · v0.2.1 · ✗ · ✅A  [backport-needed: Windows toast 시스템]
H-2-b dispatch native banner   · impl · T48      · ✗   · ✅A
H-2-c immediate_send_batch direct native notif · impl · v0.2.1 · ✗ · ✅A

H-3-a post_webhook            · impl · T48       · ✗   · ✅A
H-3-b SlackPayload (L-21-a)   · impl · T48       · ✓   · ✅A  (wire-form은 cross-os)

H-4-a dispatch (router)       · impl · T48       · ✗   · ✅A
H-4-b allowed (channel filter) · impl · T48      · ✗   · ✅A
H-4-c NotifyEvent enum        · impl · T48       · ✗   · ✅A
H-4-d read_settings           · impl · T48       · ✗   · ✅A
```

### Domain I — 로깅 / 품질

```
I-1-a logs_dir                · impl · WB-1      · ✓   · ✅A
I-1-b append_log              · impl · WB-1      · ✓   · ✅A
I-1-c rotate (keep 1000)      · impl · WB-1      · ✓   · ✅A
I-1-d list_log_entries        · impl · WB-1      · ✓   · ✅A
I-1-e append_log_worklog      · impl · WB-1      · ✓   · ✅A
I-1-f ALLOWED categories      · impl · WB-1      · ✓   · ✅A

I-2-a LogsView                · impl · WB-1      · ✓   · ✅A
I-2-b Compressed images tab   · impl · WB-1      · ✓   · ✅A

I-4-a append_worklog command  · impl · WA        · ✓   · ✅A
I-4-b WORKLOG/*.md files      · impl · ad-hoc    · ✓   · ✅A

I-5-a TAXONOMY.md             · impl · M1        · ✓   · ✅A
I-5-b CODE_MAP.md             · impl · M2        · ✓   · ✅A
I-5-c IMPL_STATUS.md (this)   · impl · M3        · ✓   · ✅A
I-5-d CHECKLIST.md            · impl · WA        · ✓   · ✅A
I-5-e INTEGRATION_TEST.md     · impl · WA        · ✓   · ✅A
I-5-f UI_VISUAL_AUDIT.md      · impl · WA        · ✓   · ✅A
I-5-g PAT_SHARE_PROTOCOL.md   · impl · T45       · ✓   · ✅A
I-5-h RELEASE_RUNBOOK.md      · impl · v0.3.0    · ✓   · ✅A
I-5-i CLAUDE.md (root)        · impl · ad-hoc    · ✓   · ✅A
I-5-j WINDOWS_PARITY_BRIEF.md · impl · port      · ✓   · ✅A
I-5-k share-manager/README.md · impl · port      · ✓   · ✅A
I-5-l SMOKE.md                · impl · port      · ✓   · ✅A
I-5-m scripts/README.md       · impl · port      · ✓   · ✅A
I-5-n launcher/README.md      · impl · v0.2.1    · ✓   · ✅A
I-5-o MAC_MIRROR_PLAN.md      · impl · 9d02ed1   · ✓   · ✅A
I-5-p AUDIT.md                · impl · M2.5      · ✓   · ✅A
```

### Domain J — 테스트 / CI

```
J-1-a inline #[cfg(test)] mod (Rust) · impl · WA · ✓ · ✅A  (현재 64 tests pass)
J-1-b tempfile dev-dep        · impl · port      · ✓   · ✅A
J-1-c ENV_LOCK                · impl · WA        · ✓   · ✅A
J-1-d ShareFixture pattern    · impl · WB-1      · ✓   · ✅A

J-2-a vitest.config.ts        · impl · 693586a   · ✓   · ✅A
J-2-b tests/unit/setup.ts     · impl · 693586a   · ✓   · ✅A
J-2-c computeGitNarrative.test · impl · 693586a  · ✓   · ✅A
J-2-d classifyCard.test       · impl · 693586a   · ✓   · ✅A

J-3-a playwright.config.ts    · impl · 693586a   · ✓   · ✅A
J-3-b mock-tauri.ts           · impl · 693586a   · ✓   · ✅A
J-3-c sidebar.spec.ts         · impl · 693586a   · ✓   · ✅A
J-3-d git-dashboard.spec.ts   · impl · 693586a   · ✓   · ✅A

J-4-a tauri-driver E2E        · gap · —          · pending · ⚠X  [§4 SP-J-1 — deferred, 검증 대상 코드 없음]

J-5-a L5 cross-OS walk        · partial · WA     · pending · ⚠M  [12 시나리오 중 6 walked — §4 SP-J-2; Windows 머신 필요]

J-6-a e2e-send.sh             · impl · port      · ✗   · ✅A
```

### Domain K — 설정 / preferences

```
K-1-a settings_path           · impl · port      · ✓   · ✅A
K-1-b load_settings           · impl · port      · ✓   · ✅A
K-1-c save_settings           · impl · port      · ✓   · ✅A

K-2-a DEFAULT_SETTINGS        · impl · port      · ✓   · ✅A
K-2-b mergeWithDefaults       · impl · port      · ✓   · ✅A
K-2-c SettingsProvider        · impl · port      · ✓   · ✅A
K-2-d AppSettings type        · impl · port      · ✓   · ✅A

K-3-a last_seen_version       · impl · port      · ✓   · ✅A
K-3-b permissions_onboarded   · impl · v0.2.2    · ✓   · ✅A
K-3-c ssh.published           · impl · T49       · ✗   · ✅A

K-4-a Settings struct (Rust)  · impl · port      · ✓   · ✅A
K-4-b Settings::Default       · impl · port      · ✓   · ✅A
K-4-c NetworkSettings         · impl · port      · ✓   · ✅A
K-4-d AppearanceSettings      · impl · port      · ✓   · ✅A
K-4-e TreeSettings            · impl · port      · ✓   · ✅A
K-4-f ShortcutEntry           · impl · port      · ✓   · ✅A
K-4-g IconTheme (Rust)        · impl · port      · ✓   · ✅A
K-4-h NotificationSettings    · impl · T48       · ✗   · ✅A
K-4-i default_true serde hint · impl · port      · ✓   · ✅A

K-5-a policy::load            · impl · port      · ✓   · ✅A
K-5-b policy::save            · impl · port      · ✓   · ✅A
K-5-c policy::policy_path     · impl · port      · ✓   · ✅A
K-5-d load_policy / save_policy commands · impl · port · ✓ · ✅A

K-6-a publish_profile         · impl · port      · ✓   · ✅A
K-6-b list_profiles           · impl · port      · ✓   · ✅A
K-6-c detect_project_language · impl · port      · ✓   · ✅A
K-6-d list_language_presets   · impl · port      · ✓   · ✅A
K-6-e file_matches_marker     · impl · port      · ✓   · ✅A
K-6-f publish_profile/list_profiles cmds · impl · port · ✓ · ✅A
K-6-g detect_lang/list_presets cmds · impl · port · ✓ · ✅A
K-6-h profiles_dir            · impl · port      · ✓   · ✅A

K-7-a install_icon_theme_from_vsix · impl · port · ✓ · ✅A
K-7-b install_icon_theme_from_git · impl · port  · ✓ · ✅A
K-7-c install_icon_theme (folder) · impl · port  · ✓ · ✅A
K-7-d load_icon_theme_def     · impl · port      · ✓   · ✅A
K-7-e icon_theme_cache_root / sanitize_basename · impl · port · ✓ · ✅A
K-7-f Theme discovery helpers · impl · port      · ✓   · ✅A

K-8-a TreeView                · impl · port      · ✓   · ✅A
K-8-b list_directory          · impl · port      · ✓   · ✅A
K-8-c build_tree              · impl · port      · ✓   · ✅A
K-8-d parent_directory        · impl · port      · ✓   · ✅A
K-8-e home_directory          · impl · port      · ✓   · ✅A
K-8-f desktop_directory       · impl · port      · ✓   · ✅A
K-8-g pick_folder             · impl · port      · ✓   · ✅A
```

### Domain L — 데이터 schemas

```
L-1-a Manifest struct         · impl · port      · ✓   · ✅A
L-1-b Canonical JSON sort     · impl · port      · ✓   · ✅A

L-2-a..b text entry v1        · impl · v0.2      · ✓   · ✅A
L-3-a..d image entry v2       · impl · v0.2      · ✓   · ✅A  meta:cross-os-contract
L-4-a SharedClipboardEntry    · impl · WC3       · ✓   · ✅A
L-5-a NoteEntry               · impl · port      · ✓   · ✅A
L-6-a raw_secret::Match       · impl · port      · ✓   · ✅A
L-7-a SentHistoryEntry        · impl · port      · ✓   · ✅A
L-8-a..b git-status doc       · impl · WB-2      · ✓   · ✅A
L-9-a git-log doc             · impl · WB-2      · ✓   · ✅A
L-10-a..d remote cache + sub  · impl · WB-2      · ✓   · ✅A
L-11-a..b RepoGraph + sub     · impl · WB-2      · ✓   · ✅A
L-12-a CheckRunSummary        · impl · T47       · ✗   · ✅A
L-13-a..c PAT share schema    · impl · T45       · ✗   · ✅A
L-14-a AppSettings wire (FE)  · impl · port      · ✓   · ✅A
L-14-b share::Settings wire   · impl · port      · ✓   · ✅A
L-14-c migration policy       · partial · port   · ✓   · ✅A  [한계: 명시적 migration 없음, 누락 키는 default — §4 SP-L-1]
L-15-a ReleaseEntry           · impl · port      · ✓   · ✅A
L-16-a LogEntry               · impl · WB-1      · ✓   · ✅A
L-16-b ts/host/os auto-inject · impl · WB-1      · ✓   · ✅A
L-16-c LogCategoryId          · impl · WB-1      · ✓   · ✅A
L-17-a..b log file naming + rotation · impl · WB-1 · ✓ · ✅A
L-18-a HtmlAsset / HtmlInspect · impl · WB-1     · ✓   · ✅A
L-19-a SmbHost                · impl · T51-a     · ✗   · ✅A
L-20-a..c GitOpResult / Direction / TransferItem · impl · port · ✓ · ✅A
L-21-a SlackPayload           · impl · T48       · ✗   · ✅A
```

### Domain M — Lifecycle / 이벤트

```
M-1-a main.rs binary entry    · impl · port      · ✓   · ✅A
M-1-b Tauri Builder chain     · impl · port      · ✓   · ✅A
M-1-c Plugin 등록 (8 plugins) · impl · port      · ✓   · ✅A
M-1-d setup hook              · impl · port      · ✓   · ✅A
M-1-e invoke_handler (~70 cmds) · impl · port    · ✓   · ✅A
M-1-f Reopen handler          · impl · v0.2.2    · N/A · ✅A  (Mac dock click)

M-2-a watch_paths             · impl · v0.2.4    · ✓   · ✅A
M-2-b classify_event_path → topic · impl · v0.2.4 · ✓ · ✅A
M-2-c start (notify crate)    · impl · v0.2.4    · ✓   · ✅A
M-2-d run_polling_fallback    · impl · v0.2.4    · ✓   · ✅A
M-2-e newest_mtime_under      · impl · v0.2.4    · ✓   · ✅A

M-3-a clipboard poller cycle (E-1-a cross-ref) · impl · v0.2 · ✓ · ✅A

M-4-a share-changed emit      · impl · v0.2.4    · ✓   · ✅A
M-4-b transfers-changed emit  · impl · port      · ✓   · ✅A
M-4-c send-request emit       · impl · v0.2.1    · ✓   · ✅A
M-4-d clipboard-changed       · impl · v0.2      · ✓   · ✅A
M-4-e notes-changed           · impl · v0.2.4    · ✓   · ✅A
M-4-f git-changed             · impl · WB-2      · ✓   · ✅A

M-5-a useShareTopic           · impl · v0.2.4    · ✓   · ✅A
M-5-b Topic whitelist         · impl · v0.2.4    · ✓   · ✅A

M-6-a ensure_on_first_launch  · impl · port      · N/A · ✅A
M-6-b desktop_alias::install  · impl · port      · N/A · ✅A
M-6-c desktop_alias::remove   · impl · port      · N/A · ✅A
M-6-d current_status          · impl · port      · N/A · ✅A
M-6-e install_desktop_alias cmd · impl · port    · N/A · ✅A
M-6-f remove_desktop_alias    · impl · port      · N/A · ✅A
M-6-g desktop_alias_status    · impl · port      · N/A · ✅A
M-6-h symlink contract        · impl · port      · N/A · ✅A

M-7-a single-instance hook    · impl · v0.2.1    · N/A · ✅A
M-7-b apply_macos_space_behavior 적용 · impl · v0.2.2 · N/A · ✅A

M-8-a perms onboarding gate   · impl · v0.2.3    · ✓   · ✅A
M-8-b announcement gate       · impl · port      · ✓   · ✅A

M-9-a auto-verify sweep trigger · impl · WA      · ✓   · ✅A
```

### Domain N — Service vendor (Swift)

```
N-1-a resolveShareManagerBinary · impl · v0.2.1  · N/A · ✅A
N-1-b launch(with urls)         · impl · v0.2.1  · N/A · ✅A
N-1-c ServiceProvider handler   · impl · v0.2.1  · N/A · ✅A
N-1-d LauncherDelegate          · impl · v0.2.1  · N/A · ✅A
N-1-e CLI argv flow             · impl · v0.2.1  · N/A · ✅A
N-1-f Accessory policy          · impl · v0.2.1  · N/A · ✅A

N-2-a NSServices array          · impl · v0.2.1  · N/A · ✅A
N-2-b NSMessage binding         · impl · v0.2.1  · N/A · ✅A
N-2-c NSSendTypes               · impl · v0.2.1  · N/A · ✅A
N-2-d NSPortName                · impl · v0.2.1  · N/A · ✅A
N-2-e NSRequiredContext         · impl · v0.2.1  · N/A · ✅A
N-2-f LSUIElement/LSBackgroundOnly · impl · v0.2.1 · N/A · ✅A
N-2-g CFBundleName "Windows로 보내기" · impl · v0.2.1 · N/A · ✅A
N-2-h CFBundleIdentifier        · impl · v0.2.1  · N/A · ✅A

N-3-a vendor Entitlements       · impl · v0.2.1  · N/A · ✅A

N-4-a Package.swift             · impl · v0.2.1  · N/A · ✅A
N-4-b bundle.sh                 · impl · v0.2.1  · N/A · ✅A

N-5-a vendor install.sh         · impl · v0.2.1  · N/A · ✅A
```

## 4. Spotlight — partial / gap 상세

### SP-E-2 · 오프라인 복원력 — 노트 쓰기 큐 + 클립보드 상대 캐시 (v0.3.4)

- **배경**: 직결망(SMB) 해제 시 노트는 쓰기 거부(Err), 클립보드는 상대(Win)
  항목이 사라짐. 사용자 요구 — 오프라인에 써두고 연결 시 자동 공유 + 상대
  클립보드도 마지막 동기화 상태 유지.
- **노트 (E-10)**:
  - `save`/`delete` 가 오프라인에서도 성공 → 로컬 미러 + `pending/` 큐
  - `flush_pending` (E-10-i) — mount 전환 시 (clipboard poller 가 호출) 셰어로
    replay. 충돌은 last-write-wins (`updated_at`, RFC3339 timezone-aware):
    상대가 더 최신이면 내 오프라인 편집 폐기 + 미러 동기화
  - 프론트 `NotesView` (E-12-a) — 새 메모 id 를 ref 로 고정 (`noteIdRef`).
    이전엔 디바운스 자동저장이 매번 null id → 백엔드가 매 저장 새 UUID →
    메모 1개가 N개로 분열. ref 가 클로저 캡처 문제 회피.
- **클립보드 (E-2/E-5)**:
  - `sync_from_share` (E-5-b) — 마운트 중 5초마다 + 전환 시 셰어의 상대 host
    스트림+이미지를 로컬 캐시로 **merge** (E-5-c, 셰어 rotate 해도 본 history
    유지)
  - `list_entries` 가 캐시 디렉토리 전체(내 것 + 상대 것) 읽음 → unmount 후에도
    2컬럼 양쪽 표시
- **테스트**: cargo 68/68 (신규 5 — offline queue / flush / 충돌 / merge / pull-survive)
- **commit**: e936e68 (v0.3.4)
- **Cross-OS**:
  - 사용자 가시 변경(E-8-a 클립보드 2컬럼 + E-12-a 노트 id 분열 fix)
    → **Windows mirror 완료** (`f7592a1`, 핸드오프 `437b3e0` 이행). 좌우 배치
    규칙·노트 id 안정화 정합성 검수 통과 (Win: 좌 Mac/우 Win, 노트 1개 보장).
  - 오프라인 큐/캐시(E-10-i/j, E-5-b/c)는 Windows 가 셰어를 로컬 NTFS 로 써서
    조건부 불필요 → 의도적 스킵. 향후 Windows 가 네트워크 드라이브 구성 시
    `windows_gui/share-manager/MAC_PARITY_HANDOFF.md` §3 이식.
  - minor(미해결): Windows `newNote()` 의 `updated_by.host` 하드코딩
    (`DESKTOP-Q0S7LSQ`) — 첫 저장 후 백엔드 host_info 로 교체되어 무해하나
    다른 머신선 첫 렌더 부정확. Windows 측 후속.

### SP-E-1 · E-8-b SharedClipboardPanel 제거 — Notes 와 기능 중복

- **상태**: deprecated (frontend 제거 완료) — 2026-06-01
- **배경**: 클립보드 페이지 상단 sticky "공유 텍스트" 패널(E-8-b)이 별도
  "공유 메모" 페이지(E-12-a NotesView)와 역할 중복. Notes 가 "여러 개 +
  제목 + 자동저장(0.6s 디바운스)" 으로 상위호환이라, sticky 의 "1칸
  빠른 메시지" 는 특수 케이스에 불과 → 사용자가 "왜 중복?" 혼동
- **조치**:
  - `SharedClipboardPanel.tsx` 파일 제거 (git rm)
  - `ClipboardView.tsx` 의 import + 렌더 제거 → 페이지가 클립보드 자동
    기록 타임라인 **단일 책임**으로 정리
  - `api.ts` 의 sticky 전용 wrapper (readSharedClipboard /
    writeSharedClipboard / listClipboardHistory) 제거
  - `global.css` 의 `.shared-clip*` dead CSS 블록 제거 (CSS 53.86→51.58 kB)
- **유지된 것 (의도)**:
  - backend `clipboard::read/write_shared_clipboard` + commands
    E-7-f/g/h + `current.json` (E-6) + `SharedClipboardEntry` wire
    (L-4-a) — Windows mirror contract 위해 남김. Mac frontend 소비처
    없음. Windows 측 정리 시 함께 제거 검토
- **후속**: 클립보드 페이지 디자인 리팩토링 (`mockups/clipboard-refactor/`)
  — 외부 AI 프롬프트로 타임라인 전용 레이아웃 고도화 진행 중
- **commit**: pending (이 작업)

### SP-B-1 · B-1-b/c FDA 리스트에 share-manager 미등록 — multi-path TCC trigger 필요

- **상태**: partial — open_privacy_settings 이 Privacy_AllFiles pane 까지 정상 점프하지만 share-manager 가 FDA 리스트에 안 뜸 → 사용자가 + 버튼으로 수동 추가 friction
- **재현**: clean state (`tccutil reset SystemPolicyAllFiles com.shareguard.share-manager`) 후 첫 launch → PermissionsOnboarding 의 "시스템 설정 열기" 클릭 → FDA 패널에 share-manager 미존재
- **원인**: macOS Sonoma+ 의 tccd 가 단일 TCC.db open 만으로는 bundle 을 list 에 surface 안 함. 여러 보호된 path 에 distinct read attempt 가 필요
- **수정** (v0.3.2):
  - 신설 leaf **B-1-e** `trigger_mac_tcc_registration` — TCC.db + ~/Library/{Mail,Safari,Messages,Application Support/MobileSync} + ~/{Desktop,Documents,Downloads} 7 경로를 `read_dir + metadata` 양쪽 시도
  - `PermissionsOnboarding` 의 "시스템 설정 열기" onClick 에 `trigger → 250ms delay → open_privacy_settings` 순서 적용 (tccd flush 시간)
- **검증** (M4-B Session A 재실행):
  - clean state 에서 "시스템 설정 열기" 클릭 → FDA 리스트에 share-manager 가 토글 OFF 로 자동 등장
  - 토글 ON → polling tick (1.5s) 가 picked up, 모달 자동 dismiss
- **commit**: pending (이 fix 의 commit)

### SP-A-1 · A-7-f UpdaterBanner 자동 설치 silent fail

- **상태**: partial — `Update.install()` 가 throw 안 하고 끝나는데 binary 가 실제로 교체되지 않음
- **현재 처리**: DMG fallback button (A-7-g) — 사용자가 수동 install
- **재현 조건**: 명확히 미파악. v0.3.0 → v0.3.1 update 시도 시 일부 사용자 환경에서 발생
- **추정 원인**: Hardened Runtime 의 self-replace 제약 + Gatekeeper quarantine attr 재부착 의심
- **추적**: Task #53 (closed via fallback, root cause 미해결)
- **다음 단계**:
  - tauri-plugin-updater 0.3.x 이슈 트래커 모니터링
  - 다음 release 에서 stderr 캡처 추가 (현재 throw 만 catch)

### SP-D-1 · D-5-a RAW_SECRET 패턴 확장 불가

- **상태**: partial — 기본 패턴 (.env / id_rsa / *.pem / credentials.json 등) 차단 OK
- **한계**: 사용자가 패턴 추가 못 함. policy.json 의 raw_secret_patterns 필드 미구현
- **다음 단계**: K-5 (policy storage) 에 raw_secret_patterns 키 추가 + transfer/raw_secret.rs::check 가 정책에서 읽도록

### SP-F-1 · F-1-c scan_and_publish_git — libgit2 미적용

- **상태**: partial — T53 에서 rayon par_iter 적용 (98 repos / 7-8 cmd → 30s 직렬 → 6s 병렬)
- **한계**: 여전히 git CLI subprocess 1 repo 당 ~6-8 회 spawn
- **option B**: `git2` crate (libgit2 binding) 사용 — in-process 호출, fork 없음, ~2-3x 추가 가속 예상
- **option C**: incremental scan — 마지막 scan timestamp 이후 변경된 repo 만 재스캔
- **trade-off**: libgit2 의 git config / credential helper 호환성 trade-off (system git 설정 일부 무시)
- **다음 단계**: Task 추가 후 별도 진행

### SP-F-2 · F-5-c fetch_remote_commits paging 한계

- **상태**: partial — GitHub REST `/repos/.../commits` 기본 30 commits만 조회
- **한계**: history 가 깊은 repo 의 경우 30 개 이전 commit 은 표시 안 됨
- **다음 단계**: `?per_page=100` + Link header paging 처리. GraphQL 검토 (rate limit 효율적)

### SP-F-3 · F-7-e git_op_push 인터랙티브 prompt 미처리

- **상태**: partial — push 가 stdin prompt (예: non-fast-forward reject) 를 요구하면 hang
- **현재 처리**: timeout 후 실패 표시
- **한계**: 사용자가 GitOpsBar 에서 어떻게 conflict resolve 할지 surface 없음
- **다음 단계**: stderr parse → 사용자에게 conflict resolution UI (force / pull-then-push / cancel) 제시

### SP-J-1 · J-4-a tauri-driver E2E deferred

- **상태**: gap — code 없음
- **이유**: tauri-driver 가 macOS 에서 WebDriver bridge 안정성 미검증. Tauri 2.x 에서 WebKit 기반 WKWebView 의 자동화 제약
- **대안**: Playwright (J-3) 가 frontend 만 mock 으로 cover

### SP-J-2 · J-5-a L5 cross-OS walk 부분 완료

- **상태**: partial — INTEGRATION_TEST.md 의 12 시나리오 중 6 walked (3 / 4 / 5 / 8 / 9 / 11 — clipboard sticky, image dedup, git data publish, log hub, basic transfers, mDNS)
- **미수행**: 1 / 2 / 6 / 7 / 10 / 12 (Mac→Win 파일 전송 / Win→Mac 검증 / notes 동시 편집 / 별도 UUID notes / HTML asset 모달 / offline reconnect)
- **이유**: 양쪽 OS 동시 walk-through 필요 — Mac 단독 검증 불가
- **다음 단계**: M4 검수 시 함께 진행

### SP-L-1 · L-14-c settings.json migration policy 없음

- **상태**: partial — `mergeWithDefaults` 가 누락 키를 default 로 채움 (forward-compat)
- **한계**: schema 가 의미 변경되거나 키가 renamed 되면 silent drift
- **다음 단계**: settings.json 에 `schema_version` 키 추가 + migration ladder. 현재 그런 변경 사례 없음 — 향후 필요 시.

## 5. Cross-OS backport 백로그

Mac-only 식별자 (cross-os ✗) — Windows 측 mirror 작업 필요.

| Mac leaf | 기능 | Windows backport 우선순위 |
|---|---|---|
| **B-10-a/b/c** | age + ssh PAT 암호화 | high (cross-host PAT 동기 contract) |
| **C-2-a..f** | mDNS host discovery | medium (direct-link 네트워크에서 유용) |
| **D-9-e** / **D-13-a/b** | File preview panel | medium (UX 균일성) |
| **F-3-a..g** | PAT cross-host sync | high (B-10 와 함께) |
| **F-6-a/b** + **F-10-b** | CI check-runs overlay | medium |
| **F-7-a..h** | Interactive git ops (fetch/pull/push/stash) | high |
| **F-11-b** | GitOpsBar | high (F-7 의 UI) |
| **F-12-a/b** | Token/SSH settings UI | medium |
| **H-2..4** | Notification dispatch (native + webhook) | medium |
| **K-3-c** | ssh.published localStorage | low |
| **K-4-h** | NotificationSettings struct | medium (H-* 와 함께) |
| **L-12-a** | CheckRunSummary wire | medium (F-6 와 함께) |
| **L-13-a..c** | PAT share schema (age) | high (F-3 와 함께) |
| **L-19-a** | SmbHost wire | medium (C-2 와 함께) |
| **L-21-a** | SlackPayload | low (양쪽 동일 형식이라 호환은 OK, 호출처만 추가) |
| **D-16-a** / **J-6-a** | e2e-send script | low (개발자 전용) |
| **G-8-c/f/g** | NetworkSection / GitSection / NotificationSection UI | C-2/F-12/H 와 함께 |

총 **~30 leaf** 가 Mac-only — 모두 v0.3.x 사이에 추가된 기능. 이 백로그가 비면 양 OS feature parity 회복.

## 6. M4-B Walk 필요 항목 (⚠M)

자동 검증 (M4-A) 으로는 보장 안 되는 runtime/UI/cross-host 동작.
**매트릭스에서는 ✅A 로 표시** 되지만 본 리스트의 항목은 **M4-B 수동
walk-through 가 끝나야 ✅** 로 승격.

### UI 컴포넌트 렌더링 (스크린샷 + 클릭 흐름 확인)

| 그룹 | 식별자 | walk 방법 |
|---|---|---|
| Updater | A-7-f, A-7-g | v0.3.x 에서 banner 표시 / 자동 설치 / DMG fallback / "재시도" 동작 |
| Onboarding modal | A-8-f, A-8-h, B-1-c, M-8-a, M-8-b | 첫 launch + 권한 dismiss → settings flag 변화 |
| Inbox/Outbox UI | D-9-a..h | 카드 클릭 → DetailsModal / PreviewPanel / verify badge |
| HTML inspector | D-9-f, D-9-g | .html 송신 시 sibling asset 검출 모달 등장 |
| Clipboard UI | E-8-a, E-8-b, E-12-a | sticky 패널 + history sort + image thumb |
| Git L1/L2/L3 | F-8-a..g, F-9-a, F-10-a..g | 카드 → modal → 5 tabs 모두 |
| Git toolbars | F-11-a, F-11-b | Scan Now / Fetch/Pull/Push/Stash 버튼 + 결과 strip |
| Git settings UI | F-12-a, F-12-b | Token 입력 / SSH 생성+publish |
| Brand icons | F-13-a, F-13-b | GitHub / Windows brand SVG 표시 |
| Global UI | G-1-a..d, G-2-a..g, G-3-a, G-4-a/b, G-5-a, G-6-a/c/g, G-10-b, G-12-a..c | 사이드바 / 모달 / toast / drop overlay / 아이콘 |
| Settings 7 sections | G-8-a..h | 각 section UI 동작 |
| Tree view | K-8-a | 디렉토리 탐색 + send |
| Logs UI | I-2-a, I-2-b | 4 categories + Compressed images tab |

### Runtime behavior (실제 실행 필요)

| 그룹 | 식별자 | walk 방법 |
|---|---|---|
| FDA prompt | B-1-a, B-1-b | TCC 권한 prompt → System Settings 점프 |
| Space follow | B-11-a, B-11-b, M-7-b | 다른 Space 에서 dock 클릭 → 현재 Space 로 따라옴 |
| Mount + ensure | C-1-c | unmounted 상태에서 `mw` CLI 호출 → 마운트 회복 |
| mDNS discovery | C-2-a..e | NetworkSection 에서 Scan → Windows host 등장 |
| Network probe | C-3-a, C-3-b | check_connection / speed_test 실 IP |
| Clipboard poller | E-1-a, M-3-a | OS clipboard 복사 → 1s 내 history 추가 |
| Watcher cycles | M-2-a..e, M-4-a..f | share 파일 추가 → frontend refresh |
| Frontend listener | M-5-a, M-5-b | `useShareTopic("transfers", …)` callback 실 호출 |
| Desktop alias | M-6-a..h | first launch → ~/Desktop 에 symlink 생성 |
| Single-instance | M-7-a | 두 번 launch → 같은 process 활성화 |
| Auto-verify sweep | M-9-a | 새 inbox 항목 → 1 cycle 후 verify green |
| PAT cross-host | B-10-a..c, F-3-a..g, L-13-a..c | host A publish → host B pullPatFromShare 자동 수입 |
| Interactive git ops | F-7-a..h | 실제 dirty repo 에서 Fetch/Pull/Push/Stash + result strip 표시 |
| CI check-runs | F-6-a, F-6-b, F-10-b, L-12-a | PAT 등록된 repo + main branch CI → badge 등장 |
| Native notification | H-2-a..c | send_path 성공 시 native banner 등장 |
| Webhook delivery | H-3-a, H-3-b, L-21-a | Slack incoming webhook URL 설정 → 메시지 도착 |
| Notification router | H-4-a..d | NotificationSettings 의 토글 별로 fan-out 차단/허용 동작 |
| Cross-OS L5 walk | J-5-a, INTEGRATION_TEST 시나리오 1/2/6/7/10/12 | Mac+Windows 동시 실행 walk |

### Cross-host wire 실 검증 (양쪽 OS 가 실제로 일치하는지)

| 식별자 | 검증 방법 |
|---|---|
| L-1-a/b Manifest canonical JSON | Mac 송신 → Windows 측 `mw verify` byte-identical 확인 |
| L-3-a..d clipboard image v2 | Mac 에서 이미지 클립 → Windows 측 sticky 에 동일 image_ref |
| D-2/D-3/D-4 wire | end-to-end transfer 후 양쪽 manifest+checksum diff |
| F-2-d host git-status doc | Mac scan_and_publish → Windows GitView 의 MAC 노드 SHA 일치 |

### M4-B 후속 작업

walk 시 발견되는 새 이슈 / 한계는:
1. Spotlight (§4) 에 새 SP-* 추가
2. CODE_MAP / IMPL_STATUS 갱신 (해당 leaf 의 status `partial` 로 demote 가능)
3. Cross-OS backport 백로그 (§5) 에 추가

### 검증 불가 (⚠X)

| 식별자 | 사유 |
|---|---|
| J-4-a tauri-driver E2E | gap 상태 — 검증 대상 코드 자체 없음. SP-J-1 참조 |

## 7. 최종 상태 요약 (M4 마감 시점)

| 단계 | 산출물 | 완료 |
|---|---|---|
| M1 | TAXONOMY.md (3-tier 식별자 규칙 + 14 domain + decision tree + tie-breaker) | ✅ |
| M2 | CODE_MAP.md (138 sub-domain × ~464 leaf) | ✅ |
| M2.5 | AUDIT.md (124 파일 × leaf 매트릭스, unmapped 0) | ✅ |
| M3 | IMPL_STATUS.md (leaf 별 Status/Cross-OS/Verified 매트릭스 + spotlight + backport 백로그) | ✅ |
| **M4-A** | **자동 검증 통과 → ✅A 일괄 적용** (cargo 64/64 + vitest 19/19 + tsc clean + vite build + handler-reg 83≡83 + wire-form 36 매핑 + file:line 12/12) | ✅ |
| M4-B | UI / runtime / cross-host walk-through (이 섹션의 ⚠M 항목들) | ⬜ (사용자 walk 일정) |
