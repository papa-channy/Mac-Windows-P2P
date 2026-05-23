# ADR-0002: Layer 2 모달 헤더 오버플로 영구 해결

**상태**: Accepted (2026-05-24)
**컨텍스트**: Layer 2 모달 헤더의 Inspector 버튼 + close X가 **여러 차례 수정 시도에도 계속 잘림** (스크린샷 image 13, image 15). 긴 브랜치명 (예: `autopilot/justfile-sync`)이 select 너비를 키워 헤더 오른쪽 컨트롤을 viewport 밖으로 밀어냄.

이전 시도들이 부분적으로만 작동한 이유:
1. `flex` + `flex-shrink: 0` 만으로는 컨텐츠가 컨테이너 너비를 초과하면 그냥 overflow.
2. `min-width: 0` 을 title에 안 줘서 title이 안 줄어듦.
3. 모달 자체가 viewport 너비를 넘기는데 외부 clip이 일어남.

## 결정

### 1. 모달 너비 계약 (Width Contract)
- `width: min(1280px, 96vw)` — 변경 없음
- `margin: 0 auto` + 부모 flex centering으로 viewport 안에 위치 보장
- `overflow: hidden` on modal-window (둥근 모서리 유지)
- **헤더 자체에 overflow:hidden 적용** (자식 컨트롤이 절대 모달 밖으로 못 나감)

### 2. 헤더 레이아웃 = CSS Grid (Flex 아님)
```css
.git-detail-window .modal-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 12px;
  align-items: center;
  padding: 16px 22px;
  overflow: hidden;          /* 안전망 */
}
```
- 컬럼 1 (제목): `minmax(0, 1fr)` — `min-width: 0` 효과로 제목이 가장 먼저 줄어듦
- 컬럼 2 (브랜치 select): `auto` + 자체 `max-width: 200px`
- 컬럼 3 (Inspector 버튼): `auto`, `white-space: nowrap`, `flex-shrink: 0` 불필요(grid auto는 안 줄어듦)
- 컬럼 4 (close X): `auto`, 고정 32×32

### 3. 제목 ellipsis
```css
.git-detail-window .modal-header h3 {
  min-width: 0;          /* grid minmax(0,1fr)이 이미 0으로 가능하게 함 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### 4. 브랜치 select 폭 제한 + 자체 ellipsis
```css
.git-detail-window #git-detail-branch {
  max-width: 200px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
```
- 긴 옵션이 dropdown 열렸을 때는 자연 폭으로 표시 (브라우저 기본)
- 닫힌 상태에서는 capped width 안에서 ellipsis

### 5. 작은 viewport 검증
- **800px viewport에서도 4개 컨트롤 모두 보임** 을 통과 기준으로
- 750px 미만에서는 어쩔 수 없지만, 우리 데스크탑 앱은 보통 800px+

### 6. 회귀 방지
- CSS에 `!important` 사용 (modal 베이스 클래스 덮어쓰기 보장)
- 통과 기준: image 15 같은 잘림 0건

## 결과
- viewport 안에서 컨트롤 4개 모두 보임
- 긴 브랜치명도 200px 안에서 잘림 (마우스 hover로 풀 텍스트 가능, title attribute)
- 제목이 우선 줄어듦 (브랜치명은 항상 보임)

## 영향 받는 파일
- `windows_gui/share-manager/src/style.css` — Layer 2 modal 헤더 블록 재작성, `!important` 추가
- `index.html` — `<select>` 에 `title` attribute 추가 (호버 시 full 브랜치명)

## 검증
체크리스트 L2-A ✅ 통과 조건:
- 1280px viewport: 모든 컨트롤 보임, 잘림 0
- 1100px viewport: 동일
- 900px viewport: 동일
- 가장 긴 브랜치명 (`feature/very-long-branch-name-for-testing`) 도 dropdown 닫힌 상태에서 200px 안에서 ellipsis
