# Git UI Component Quality Checklist

share-manager 의 Git 관련 모든 UI 컴포넌트를 하나씩 점검해 완성도를 끌어올리기 위한 체크리스트. 각 컴포넌트마다 통과 기준(Pass Criteria)을 명시하고, 통과 시 ✅ / 보류 ⏳ / 미통과 ❌ 표시.

> 이 문서는 Mac 측이 동일 컨트랙트로 미러 구현할 때 참조 기준이 된다. 모든 결정은 `ADR/` 디렉터리에, 일별 작업은 `WORKLOG/`에 기록.

> **Mac 측 사본**: Windows 측 `windows_gui/share-manager/mockups/quality/CHECKLIST.md` 의 verbatim 사본 + 하단 §10 macOS-specific 항목 추가. UI 의미·픽셀 값·통과 기준은 양 OS 동일.

---

## 공통 통과 기준 (Universal Pass Criteria, UPC)

모든 컴포넌트가 **UPC-1~9** 를 통과해야 함.

| 코드 | 기준 | 검사 방법 |
|---|---|---|
| UPC-1 | 텍스트 잘림 없음 (모달 안, 라벨, 칩) | 실제 데이터로 가장 긴 케이스 확인 |
| UPC-2 | 라이트 테마 일관성 (app 전체 라이트인데 혼자 다크 아님) | 시각 확인 |
| UPC-3 | 아이콘은 Lucide 또는 브랜드 SVG, 이모지 금지 | grep 0 |
| UPC-4 | Mac=Apple logo · Win=Windows logo · GitHub=Octicon github | 시각 확인 |
| UPC-5 | 여백 16/20/24px 그리드 — 셋 중 하나 | spacing 측정 |
| UPC-6 | 호버 상태 정의됨 (cursor, bg, border) | 호버 테스트 |
| UPC-7 | mono 폰트 (JetBrains/Fira/SF Mono/Consolas) — SHA·파일경로·코드 | 폰트 패밀리 확인 |
| UPC-8 | 색상 4.5:1 이상 컨트라스트 (텍스트:배경) | 디자인 토큰 확인 |
| UPC-9 | 모달은 viewport 안에 100% 표시 (오버플로 잘림 ❌) | 다양한 너비에서 |

---

## Layer 1 — Dashboard (Repo 목록)

### L1-A. 페이지 헤더
- 제목 "Git 현황" + 서브타이틀 + 액션 버튼들 (지금 스캔 · 원격 동기화 · 다시 읽기)
- **통과 기준**:
  - 제목 16~18px / 700 weight
  - 서브타이틀에 디버그 텍스트 없음 ("Overview→Focus→Debug" 같은 메타 jargon 금지)
  - 액션 버튼 3개 일관 스타일 (primary 1 + ghost 2)
  - 우측 정렬, 최소 1100px width에서 줄바꿈 없음
- **상태**: ⏳

### L1-B. Hero stats (3 카드)
- 전체 / 동기화 / 충돌 위험 3개 카드
- **통과 기준**:
  - 숫자 32px 이상, weight 800
  - 라벨 / 숫자 / 서브캡션 / 우측 아이콘 배지의 4-area 레이아웃
  - 충돌>0 시 카드 좌측 stripe 또는 soft red glow
  - hover시 살짝 translate
- **상태**: ⏳

### L1-C. Repo Card
- 한 레포 카드 전체 (가장 자주 보는 컴포넌트)
- **하위 요소**:
  - L1-C1. 상태 배지 (synced/diverged/dirty/conflict/partial)
  - L1-C2. 카드 제목 (owner/repo, monospace)
  - L1-C3. 카드 메타 (scan 시각, clock 아이콘)
  - L1-C4. **3-node Bridge** (Mac · Origin · Win)
  - L1-C5. 충돌 배너 (있을 때만)
- **통과 기준**:
  - 카드 padding 22/24
  - 카드 hover시 border + shadow 살짝 강조 (cursor:pointer)
  - 상태 배지 아이콘 + 텍스트 짝 (check-circle-2 / alert-triangle / shield-alert / circle-dot)
  - 카드 좌측 stripe: conflict 시 3px 빨강
- **상태**: ⏳

#### L1-C4. 3-node Bridge (개별 검증)
- **통과 기준**:
  - Mac 노드 = **Apple logo** (실제 사과 로고, monitor 아님)
  - Origin 노드 = **GitHub octocat** (filled)
  - Win 노드 = **Windows 4-pane** (filled, #00A4EF 청색)
  - 3 노드 동일 크기 동그라미 (38×38)
  - 각 노드 LED (우하단 작은 dot, online=emerald)
  - 노드 사이 dashed 라인 연결
  - 우측에 chevron-right (호버시 색 강조)
  - 노드 라벨 (MAC / ORIGIN / WIN) 동일 스타일 (font-weight 800, 9.5px, letter-spacing 0.08em)
  - 노드 하단 third 라인: dirty 개수 / SHA / "Clean" / "없음"
- **상태**: ⏳

### L1-D. 빈 상태 (스캔 전)
- 스캔 안 했을 때의 안내 카드
- **통과 기준**:
  - 큰 아이콘 + 제목 + 힌트 + "지금 스캔" CTA
  - 중앙 정렬
- **상태**: ⏳

---

## Layer 2 — Repo Detail (Swimlanes)

### L2-A. 모달 헤더
- 제목 + 브랜치 select + Inspector 버튼 + close X
- **통과 기준** (이 항목 여러 번 실패했음, 엄격):
  - 모달 width: 1280px (최소) / 96vw 중 작은 값
  - 모달은 **항상 viewport 안에 100% 표시**
  - 헤더는 grid `minmax(0, 1fr) auto auto auto`
  - 제목 ellipsis (긴 owner/repo 잘림 처리)
  - 브랜치 select max-width 200px, 자체 ellipsis
  - Inspector 버튼 + close X 절대 자르지 않음 (오버플로 검증 필수)
  - 헤더 padding 18/24
  - 800px viewport에서도 모든 컨트롤 보임
- **상태**: ❌ (반복 실패) → ADR-0002 적용 필요

### L2-B. 상태 칩 + 충돌 알림
- 헤더 아래 "발산" / "충돌 임박" 칩 + N개 파일 동시 수정 중 칩
- **통과 기준**:
  - 칩 padding 6/14, font-size 12.5px, icon 14px
  - synced=emerald / diverged·dirty=amber / conflict=rose
- **상태**: ⏳

### L2-C. 3 Swimlanes
- Mac · Origin · Win 3 컬럼
- **하위 요소**:
  - L2-C1. 레인 헤더 (icon tile + 제목 + host·sha + 태그)
  - L2-C2. WIP 섹션 (dirty 파일)
  - L2-C3. 미푸시 커밋 섹션
  - L2-C4. Stash 섹션
  - L2-C5. Origin tip card (가운데 lane 전용)
  - L2-C6. PR 목록 (Origin lane만)
- **공통 통과 기준**:
  - 레인 카드 padding: head 18/20, body 22/20
  - 섹션 간 margin 20px+
  - 파일 행: file-code (정상) / file-warning (충돌) 아이콘
  - 충돌 파일은 rose bg + bold name + "CONFLICT" 라벨
  - 빈 상태 행 ("변경 없음", check-circle-2 아이콘)
- **상태**: ⏳

#### L2-C1. 레인 헤더
- **통과 기준**:
  - 아이콘 타일 36×36, 둥근 사각
  - Mac=Apple / Origin=GitHub / Win=Windows 브랜드 아이콘
  - 제목 14px / 700, 색상은 lane color (mac=blue / win=teal / origin=violet)
  - 서브: "host · sha" 형식 (mono, 11px)
  - ahead/behind 태그 (arrow + 숫자)
- **상태**: ⏳

#### L2-C5. Origin tip card
- **통과 기준**:
  - 큰 보라 dot (14px) + 카드
  - 카드에 SHA(보라색 mono) + 메시지(굵음)
  - 보라 글로우 그림자
  - 중앙 정렬, 충분한 상단 여백
- **상태**: ⏳

### L2-D. 하단 Connector Bar
- Mac (icon) ↑↓ | Origin | ↑↓ Win (icon)
- **통과 기준**:
  - 카드형 배경, padding 18/26
  - 칩 스타일: up=mac blue / down=amber / eq=emerald check
  - gap 22px
- **상태**: ⏳

---

## Layer 3 — Raw Inspector

### L3-A. 페이지 헤더 (Back · Breadcrumb · Close)
- **통과 기준**:
  - **앱 라이트 테마와 일관** (현재 다크 → 변경 필요, ADR-0001)
  - Back 버튼 + repo 경로 + Inspector 라벨 + close X
  - 충분한 좌우 padding (16/24)
  - 폰트: repo 부분 mono, "Inspector" 부분 sans
- **상태**: ❌ (다크임)

### L3-B. 사이드바 (DATA CATEGORIES)
- 5개 탭 (Raw Diffs · Daemon Logs · Git Config · All Commits · Sync Timeline)
- **통과 기준**:
  - **라이트 테마** (ADR-0001)
  - 라벨 "DATA CATEGORIES" caps + spaced + muted
  - 각 탭: icon + 텍스트, padding 11/14
  - active: light blue tint bg + left stripe (sky-500)
  - hover: surface-2 bg
- **상태**: ❌ (다크임)

### L3-C. 콘텐츠 — Raw Diffs
- 파일별 diff 카드
- **통과 기준**:
  - 카드 헤더: file-code 아이콘 + 파일명(mono)
  - 카드 본문: GitHub light 스타일 diff
    - +: rgba(green, 0.10) bg + #1F883D text
    - -: rgba(red, 0.10) bg + #CF222E text
    - @@: #57606A text + cyan bg 띠
    - context: #1F2328 text
  - line-height 1.65, padding 18/24
  - 카드 간 gap 22px
- **상태**: ❌ (다크임)

### L3-D. 콘텐츠 — Daemon Logs
- 로그 행
- **통과 기준**:
  - 4-column grid: ts(11px mono muted) / level pill(11px / 800) / category pill / message
  - level pills: SUCCESS=emerald / ERROR=rose / INFO=sky / WARN=amber
  - 카테고리 pills: violet
  - 행 hover: surface-2
  - tail: "_ waiting for new logs..." mono muted, pulse
- **상태**: ❌ (다크임) 

### L3-E. 콘텐츠 — Git Config
- .git/config 파일 내용
- **통과 기준**:
  - 경로 헤더: settings 아이콘 + mono 경로
  - 본문: mono, line-height 1.85, 라이트 코드 bg (#F6F8FA 같은 GitHub 라이트)
- **상태**: ❌ (다크임)

### L3-F. 콘텐츠 — All Commits
- 커밋 테이블
- **통과 기준**:
  - 컬럼: SHA(mono, sky) / Message / Branch / Author / Date
  - 헤더: caps + spaced + 작은 폰트
  - 행 hover: surface-2
  - 날짜 wrap 없음 (whitespace nowrap)
- **상태**: ❌ (다크임 + 날짜 컬럼 줄바꿈 발생)

### L3-G. 콘텐츠 — Sync Timeline (★ 가장 부족)
- 3-소스 가로 타임라인 SVG
- **통과 기준** (이 항목 여러 번 부족했음):
  - **라이트 테마**
  - 레인 라벨 영역 충분 (170px+) — "chans-MacBook-Pro" 같은 긴 호스트명 잘리지 않음
  - SVG가 inspector body width를 충분히 활용 (작게 쪼그라들지 않음)
  - 레인 배경: violet(remote) / blue(mac) / teal(win) soft tint
  - 점: solid 컬러, 라벨 옆 자기 색
  - 공통 조상 표시: 노란 점선 vertical + "⊥ 공통 조상 sha" 라벨
  - tip pill 라벨이 잘리지 않음 (mono SHA 포함)
  - 가로 스크롤 필요 시 깔끔 (스크롤바 가시성)
  - 아래에 LCA / 점 / 라인 의미를 설명하는 작은 레전드
- **상태**: ❌

---

## 우선순위 & 단계 (Phase Plan)

### Phase 1 — 시급 (지금 작업)
1. **ADR-0001**: Inspector 라이트 테마로 통일 → L3-A~G 전체 적용
2. **ADR-0002**: 모달 헤더 오버플로 영구 해결 → L2-A 통과
3. **ADR-0003**: Sync Timeline 재설계 → L3-G 통과

### Phase 2 — 다음
4. L1-C4 3-node Bridge 디테일 다듬기
5. L2-C 스윔레인 빈 상태 / 일관성

### Phase 3 — 마감
6. UPC 1~9 전수 검증
7. Mac 미러용 디자인 토큰 export

---

## 진행 표 (Phase 1)

| ID | 컴포넌트 | 상태 | ADR | 비고 |
|---|---|---|---|---|
| L3-A | Inspector 헤더 | ⏳ pending verify | 0001 | 라이트 적용 — 시각 확인 필요 |
| L3-B | Inspector 사이드바 | ⏳ pending verify | 0001 | 라이트 적용 — 활성 탭 sky stripe |
| L3-C | Raw Diffs | ⏳ pending verify | 0001 | GitHub 라이트 mode (`#1F883D`/`#CF222E`/`#0969DA`) |
| L3-D | Daemon Logs | ⏳ pending verify | 0001 | 4-col grid, semantic pills |
| L3-E | Git Config | ⏳ pending verify | 0001 | `#F6F8FA` 코드 베이스 |
| L3-F | All Commits | ⏳ pending verify | 0001 | nowrap 추가, hover surface-2 |
| L3-G | Sync Timeline | ⏳ pending verify | 0001, 0003 | 220px 라벨 영역, 86px 레인높이, 브랜드 아이콘 SVG inline, legend 하단 |
| L2-A | 모달 헤더 | ⏳ pending verify | 0002 | grid `minmax(0,1fr) auto auto auto` + `display:contents` controls, branch select `max-width:200px` + title tooltip |


---

## §10. macOS-specific 추가 항목

Mac 측 한정 OS 차이. 이 행들은 `mac_gui/` 만 검증 대상. 자세한 결정 근거는 `ADR/0005-mac-os-overrides.md`.

| ID | 항목 | 통과 기준 | 비고 |
|---|---|---|---|
| MAC-1 | 모노 폰트 stack 일관성 | `"SF Mono", Menlo, "JetBrains Mono", Consolas, monospace` — global.css + Inspector + Diff | SF Mono 는 macOS 기본 (no install) |
| MAC-2 | Traffic-lights chrome | 윈도우 좌상단 ●●● 노출. Tauri `decorations: true`, custom titlebar 없음 | NSWindow 기본 |
| MAC-3 | Keychain 통합 | `keyring = { features = ["apple-native"] }` — token CRUD 시 macOS Keychain dialog 노출 + Touch ID 통과 | Windows credential manager 대신 |
| MAC-4 | SSH 키 경로 | `~/.ssh/id_ed25519` (USERPROFILE 아님) | git_ssh_status, git_generate_ssh_key |
| MAC-5 | 셰어 마운트 | `/Volumes/Mac-Window_Share` (SMB) + `mw` CLI helper | mount.rs::current_mount_url 참조 |
| MAC-6 | 단일 인스턴스 + Space follow | tauri-plugin-single-instance + NSWindowCollectionBehaviorMoveToActiveSpace | v0.2.1/0.2.2 에서 이미 적용 |
| MAC-7 | Full Disk Access onboarding | 첫 launch 시 PermissionsOnboarding 모달 + open_privacy_settings 자동 안내 + has_full_disk_access 폴링 | v0.2.2/0.2.3 적용 |
| MAC-8 | Notarized Developer ID 서명 | release.sh 파이프라인 (signed + stapled + DMG + updater minisign) | v0.1.0~v0.2.4 매 릴리스 |
