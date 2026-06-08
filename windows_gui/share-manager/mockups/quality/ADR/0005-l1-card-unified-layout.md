# ADR-0005: L1 Card Unified Layout (verdict별 분기 컴포넌트 제거)

**상태**: Accepted (2026-05-24)

## 컨텍스트

L1 Dashboard 카드를 보면 verdict 별로 layout이 다르게 그려져 디자인이 깨졌다 (Image #1 참조):

- **충돌 임박 카드**: 카드 전체가 핑크 배경 + 좌측 두꺼운 빨간 stripe + 카드 안에 추가 `git-card-conflict` div (큰 핑크 영역) → 카드 크기가 다른 카드와 다르고 3-node bridge가 카드 밖으로 잘림
- **발산/동기화 카드**: 깔끔한 흰 배경, 작은 chip, 3-node bridge 잘 들어감

근본 원인:
1. `app.js:1592` — `${s.kind === 'conflict' ? '<div class="git-card-stripe"></div>' : ''}` (verdict별 div 추가)
2. `app.js:1610~1614` — `${s.overlaps.length ? <div class="git-card-conflict">...` (conflict-only div)
3. `style.css:1002 / 1041 / 1271 / 1322 / 1918` — conflict-only 규칙들이 카드 padding / margin / 추가 영역 size 변경

사용자 요청 (한 줄): "상황별 다르게 카드내 컴포넌트 배치를 처리하지 말고 모두 동일하게 처리".

## 결정

L1 카드를 **단일 layout** 로 통일:

```
┌─────────────────────────────────────┐
│ Repo-name             [verdict-chip]│  ← header (grid 1fr auto)
│ 🕒 방금 전 스캔                       │  ← meta row
│ ┌─────────────────────────────────┐ │
│ │  🍎  ─ ─  🐙  ─ ─  🪟  ›        │ │  ← bridge box (surface-2)
│ │ MAC      ORIGIN     WIN          │ │
│ │ Clean   a17c448   18 dirty       │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 변경 사항
1. **`git-card-stripe` div 제거** — 좌측 stripe 자체 폐지 (chip 으로 verdict 표시 충분)
2. **`git-card-conflict` div 제거** — overlap 정보는 chip + L2 detail Inspector 에 위임
3. **모든 카드 = 같은 클래스** `.git-card` 만 사용. verdict 차이는 `.git-card-badge-*` chip 색만
4. **카드 배경** 항상 `var(--surface)` 흰색
5. **카드 padding** 항상 `18px 20px`, gap `14px`, border-radius `14px`
6. **bridge box** 카드 안 inner box (`var(--surface-2)` 배경, border, radius 12)
7. **노드 아이콘 크기** 30→44px (큰 사이즈, 가독성 향상)
8. **카드 높이** 자연스럽게 일정 (bridge box 가 자연 폭 결정 → 모든 카드 동일)

### Hero metric row 도 mockup 양식으로 정돈
- 3 카드 그리드 (3-Node 동기화 / 발산 가능 / 충돌 위험)
- icon tile 38×38, value 26px font-weight 800
- mockup 의 dashboard-v2.html `.metric` 양식 적용

### 페이지 헤더 아이콘 교체
- `index.html:172` `<h2>🌿 Git 현황</h2>` → Lucide **git-branch** SVG (color: `#1F883D`)

## 결과

- 충돌 / 발산 / 동기화 / 미커밋 / 단일호스트 — **5개 verdict 모두 동일 layout** 으로 렌더링
- 카드 크기 일정, bridge 잘림 0
- 디버깅 / 유지보수 단순화 (verdict별 분기 코드 제거)
- Mac 미러 시에도 같은 양식 적용 가능 (분기 없음 → React 구현 단순)

## 영향 받는 파일

- `windows_gui/share-manager/src/index.html` — h2 leaf → git-branch SVG
- `windows_gui/share-manager/src/app.js` `renderGitL1Card()` — stripe / conflict div 제거
- `windows_gui/share-manager/src/style.css` 맨 끝에 "ADR-0005 unified" 마커 블록 추가:
  - `.git-card-stripe { display: none !important }` (예방용)
  - `.git-card-conflict { display: none !important }` (예방용)
  - `.git-card` flex column 통일
  - `.git-card-bridge` surface-2 inner box
  - `.gn-icon` 44×44
  - `.git-card-badge-*` chip 색상 통일 (GitHub-light palette)
  - `.git-hero-card` metric 양식

## 검증

- [ ] 충돌 카드와 발산 카드 같은 높이 / 같은 padding / 같은 bridge 위치
- [ ] 카드 배경 모두 흰색
- [ ] 좌측 stripe 0
- [ ] bridge box surface-2 inner box로 표시
- [ ] node icon 44×44, led 점 우하단
- [ ] header 의 git-branch 아이콘 emerald(#1F883D)
- [ ] hero metric 3개 카드 동일 높이, icon tile 38×38
