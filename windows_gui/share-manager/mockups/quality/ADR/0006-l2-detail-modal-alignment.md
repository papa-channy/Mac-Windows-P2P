# ADR-0006: L2 Detail Modal — mockup detail-v2 양식 정렬

**상태**: Accepted (2026-05-24)

## 컨텍스트

L1 카드는 ADR-0005로 mockup dashboard-v2 양식 적용 완료. 하지만 L2 detail modal 은 mockup detail-v2.html 양식과 차이가 큼:

| mockup detail-v2 | 현재 L2 (image #7) |
|---|---|
| 헤더 아래 **큰 verdict chip + 진단문** ("Win이 origin보다 2 커밋 앞섬 · Mac은 깨끗하고 동기화됨 · Win에서 push 권장") | 작은 chip 한 줄만 ("발산"), 진단문 없음 |
| 두 lane 사이에 절대위치 **connector chip** ("동기화" / "Win ↑ 2") | connector chip 없음 |
| Origin lane 가운데 **commit card** (점 + sha + msg + author + PR 알약) | 가운데 컴포넌트 있지만 PR 알약 등 일부 누락 |
| 푸터 = **메타정보 + 액션 버튼** (방금 전 스캔 · 50 커밋 분석 · 공통 조상 + 전체 커밋 / DAG / Sync) | 푸터 = "Mac · 동기화 · Origin · 동기화 · Win" 옛 양식 (호스트 연결 시각화 중복) |

핵심 문제: L2 detail이 mockup 양식과 어긋나 있어 한눈에 "무엇이/왜/어떻게" 파악이 어려움.

## 결정

L2 detail modal 을 mockup detail-v2.html 의 4-zone 구조로 정렬:

```
┌────────────────────────────────────────────────────────────┐
│ Repo-name              [main ▼] [Inspector] [×]             │  ← modal-head (이미 OK)
├────────────────────────────────────────────────────────────┤
│  ⚠ 발산  Win이 origin보다 2 커밋 앞섬 · Mac은 깨끗...        │  ← verdict-row (대형 chip + 진단문)
│                                                              │
│  ┌─────────┐  ─ ─[동기화]─ ─  ┌──────────┐  ─ ─[Win↑2]─ ─  ┌─────────┐
│  │ macOS   │                  │  GitHub  │                  │ Windows  │
│  │ 로컬    │                  │  Origin  │                  │ 로컬     │
│  │         │                  │ ● sha    │                  │          │
│  │ WIP 0   │                  │ msg      │                  │ WIP 2    │
│  │         │                  │ author   │                  │ ● file   │
│  │         │                  │ [#49 PR] │                  │ ● file   │
│  └─────────┘                  └──────────┘                  └─────────┘
├────────────────────────────────────────────────────────────┤
│ 🕒 방금 전 스캔 · 📜 50 커밋 분석 · ⊥ 공통 조상 a17c448      │
│                       [전체 커밋] [DAG] [Sync 실행]          │
└────────────────────────────────────────────────────────────┘
```

### 변경 사항

#### 1. Verdict row (modal-summary 영역 재설계)
- 큰 chip (`.git-l2-verdict-chip`) — verdict kind 따라 색상 (synced/diverged/conflict)
- 우측에 진단문 — `vTitle` (굵게) + `vDesc` (해설)
- 진단문 생성 규칙은 `computeGitNarrative` 와 동일한 verdict-action 매핑 사용:

| 상태 | vTitle | vDesc (action 포함) |
|---|---|---|
| `dirtyOverlap` | 충돌 임박 | 양쪽에서 같은 파일 수정 중 · 머지 전 정리 필요 |
| `macA && winA` | 양쪽 발산 · Mac ↑N / Win ↑M | 양쪽 미푸시 — 통합 결정 후 한쪽씩 push |
| `macA only` | Mac이 origin보다 N커밋 앞섬 | Mac에서 push 후 Win에서 pull 권장 |
| `winA only` | Win이 origin보다 N커밋 앞섬 | Mac은 깨끗하고 동기화됨 · Win에서 push 권장 |
| `macB \|\| winB` | 뒤처짐 · {hosts} pull 필요 | {hosts}에서 git pull 권장 |
| `macD \|\| winD` | 미커밋 변경 X개 | 로컬 변경 커밋 후 push 권장 |
| 그 외 | 동기화됨 | 모든 호스트가 origin과 일치 |

#### 2. Connector chip (lane 사이 절대 위치)
- 3-column grid 안에 absolute-positioned chip 2개:
  - `c1` (Mac ↔ Origin): 좌측 33.3% 위치
  - `c2` (Origin ↔ Win): 우측 66.6% 위치
- chip type:
  - 양쪽 sync → `{ type: 'synced', text: '동기화' }`
  - ahead → `{ type: 'diverged', text: 'Mac ↑ N' }` 또는 `'Win ↑ N'`
  - behind → `'Mac ↓ N'` 또는 `'Win ↓ N'`

#### 3. Footer 교체 (gitConnectorBar 제거 → meta+actions)
- 좌측: 메타정보 3 항목 (방금 전 스캔 시각 / N 커밋 분석 / 공통 조상 sha)
- 우측: 액션 버튼 3 (전체 커밋 보기 / DAG 보기 / Sync 실행)
- 기존 `.git-l2-connbar` 클래스는 CSS에서 `display: none` 처리하거나 제거
- 호스트 연결 상태는 verdict chip + 진단문 + connector chip 3 곳에서 표현되므로 푸터 중복 표현 제거

## 영향 받는 파일

- `windows_gui/share-manager/src/app.js`:
  - `renderGitL2Lanes` 안의 `$gitDetailSummary` 부분 — 큰 verdict chip + 진단문
  - `renderGitL2Lanes` 안의 `$gitDetailBody` 부분 — connector chip 추가 + 푸터 교체
  - `gitConnectorBar()` 함수 제거 (또는 미사용)
  - 새 헬퍼: `gitL2VerdictRow(...)`, `gitL2Connector(...)`, `gitL2Footer(...)`
- `windows_gui/share-manager/src/style.css`:
  - 새 ADR-0006 마커 블록 추가
  - `.git-l2-verdict-row`, `.git-l2-verdict-chip`, `.git-l2-verdict-text`
  - `.git-l2-shell`을 `position: relative` 로 + `.git-l2-connector` 절대 위치
  - `.git-l2-footer`, `.git-l2-footer-meta`, `.git-l2-footer-actions`
  - 기존 `.git-l2-connbar { display: none !important }` (legacy)

## 검증

L2 detail modal 열어서:
- [ ] 헤더 아래 큰 chip + 진단문 보임 (image #8 verdict row와 일치)
- [ ] lane 사이 connector chip 2개 표시 ("동기화" / "Win ↑ N")
- [ ] 푸터 = 메타 + 액션 버튼 (호스트 연결 시각화 제거됨)
- [ ] 1280 / 1100 / 900px 모든 폭에서 잘림 0
- [ ] 4 verdict 케이스 시연 (동기화 / 발산 / 양쪽 발산 / 충돌 임박) — chip 색 + 진단문 정확
