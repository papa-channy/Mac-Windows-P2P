# ADR-0003: Sync Timeline 그래프 재설계

**상태**: Accepted (2026-05-24)
**컨텍스트**: Layer 3 Inspector의 Sync Timeline 탭 (이미지 21)이 완성도 부족:
- "chans-MacBook-Pro" 라벨 잘림 ("chans-MacBook-P"로 표시)
- 그래프가 inspector body width를 충분히 활용 못함 (상단 1/3 만 차지)
- 다크 테마 (ADR-0001로 라이트로 통일됨)
- 시각적 디자인이 프로토타입 같음 (호스트 라벨 / 점 / 선이 빈약)
- 하단에 정체불명의 흰 띠 (스크롤바 잔재)

## 결정

### 1. 레이아웃 — 라이트, 풀폭
- 라이트 테마 (ADR-0001 따름)
- inspector body width의 95%+ 활용 (불필요한 좌우 여백 제거)
- 그래프는 세로로도 충분히 호흡 (각 레인 80px+ 높이)

### 2. 레인 라벨 영역 = 200px 고정
- 가장 긴 호스트명 ("chans-MacBook-Pro" ≈ 16자) + 아이콘 + 여백을 위해 **200px** 확보 (이전 150 → 200)
- 아이콘: 24×24 lucide 또는 브랜드 SVG
- 라벨 텍스트: 13.5px / 700 weight / mono
- 호스트명 너무 길면 ellipsis (max-width 165px)

### 3. 그래프 영역
- 점 간격: 동적 — 그래프 너비 / (commit 수 - 1)로 계산, 최소 32px / 최대 56px
- 점 크기: 8px (일반), 10px (tip), 12px (LCA, 노란 ring)
- 선: 점 색의 0.4 opacity, 2.5px stroke
- 모든-소스-공유 커밋: 세로 점선 spine (회색 0.4 opacity)
- LCA: 양쪽 amber 점선 vertical + 위쪽 label "⊥ 공통 조상 sha"

### 4. Tip 라벨 (pill)
- 우측에 자기 라벨 표시
- 형식: `[icon] origin/main · 7chars` (mono SHA 포함)
- 한 줄에 다 안 들어가면 위로 살짝 띄움
- 다크 fill + 흰 텍스트 (가독성)

### 5. 색
- Remote: violet (`#6E40C9`)
- Mac: blue (`#2563EB`)
- Win: teal (`#0F766E`)
- LCA: amber (`#D4A72C`)
- 공통 share spine: gray-400 (`#9CA3AF`)
- 라벨 영역 bg: `var(--surface-low)` 옅게
- 그래프 영역 bg: `var(--surface)` 흰색

### 6. 가로 스크롤
- 그래프 폭이 컨테이너 폭 초과 시: 부드러운 가로 스크롤
- 스크롤바: thin (8px), trough surface-2, thumb text-dim
- 좌우 fade gradient로 스크롤 가능함 표시

### 7. 레전드 (하단)
- 작은 도움말 행: 점·LCA·spine·tip 의미를 한 줄로
- text-dim, 11px, 좌측 정렬

### 8. 다중 브랜치 / 미커밋 케이스
- 그래프는 현재 브랜치 기준
- 미커밋 변경은 별도 표시 안 함 (Layer 2 swimlanes에 이미 있음)
- WIP 노드는 Sync Timeline엔 표시 안 함 (deferred — 추후 확장)

## 결과
- 라벨 잘림 0 (200px 라벨 영역 보장)
- 그래프가 inspector body 영역 거의 다 사용
- 라이트로 일관성 유지
- 스크롤도 자연스럽고 가시성 있음

## 영향 받는 파일
- `windows_gui/share-manager/src/app.js` — `gitTimelineSVG()` 재작성
- `windows_gui/share-manager/src/style.css` — `.gi-tl-*` 전체 라이트 재정의

## 검증
체크리스트 L3-G ✅ 통과 조건:
- "chans-MacBook-Pro" 잘림 없이 풀로 표시
- 그래프가 inspector body 폭의 90%+ 사용
- LCA / tip pills / dots 모두 가독성 4.5:1+
- 가로 스크롤 시 매끄러움
