# ADR-0001: Raw Inspector를 라이트 테마로 통일

**상태**: Accepted (2026-05-24)
**컨텍스트**: Layer 1·Layer 2는 앱 전체 라이트 테마 (white surfaces, dark text). Layer 3 Raw Inspector만 다크 (#0F1115 bg, light text) — React 목업이 그렇게 그려졌고 "터미널 raw" 느낌을 살리려다 보니 그대로 옮겨짐.

**문제**: 사용자가 직접 지적 — "왜 라이트 테마 기반으로 모든 페이지 설계중인데 상세 페이지만 다크 테마인지 모르겠어". 한 앱 안에서 테마가 갑자기 바뀌는 건 인지적으로 거슬리고 일관성을 깨뜨림.

## 결정
**Layer 3 Inspector 전체를 라이트 테마로 통일**한다. 단, 코드/로그/diff 같은 **모노스페이스 콘텐츠 영역**은 GitHub 라이트 모드 스타일 (`#F6F8FA` 베이스, 미세한 색 띠) 을 차용해 "이건 raw 데이터" 시각 신호는 유지한다.

### 매핑
| 영역 | 이전 (다크) | 새로 (라이트) |
|---|---|---|
| Inspector window bg | `#0F1115` | `var(--surface)` (`#FFFFFF`) |
| Header | `#15161B` | `var(--surface-low)` (`#F8F8FA`) |
| Sidebar | `#15161B` | `var(--surface-low)` |
| Tab active | rgba(56,189,248,0.14) | rgba(10,132,255,0.10) + left sky stripe |
| Tab hover | `#22232A` | `var(--surface-2)` |
| 텍스트 본문 | `#E4E4EA` | `var(--text-pri)` (`#1B1B22`) |
| 텍스트 보조 | `#9CA3AF` | `var(--text-sec)` |
| 다이프 +라인 | `#4ADE80` on rgba(74,222,128,0.13) | `#1F883D` on rgba(31,136,61,0.12) |
| 다이프 -라인 | `#FCA5A5` on rgba(248,113,113,0.13) | `#CF222E` on rgba(207,34,46,0.10) |
| 다이프 @@ hunk | `#38BDF8` on rgba(56,189,248,0.08) | `#0969DA` on rgba(9,105,218,0.08) |
| 코드 bg (config/diff pre) | `#15161B` | `#F6F8FA` (GitHub 라이트 코드 베이스) |
| 코드 텍스트 | `#D4D4D8` | `#1F2328` |
| Sync Timeline lane bg | rgba(white, 0.04) | rgba(110,64,201,0.06) (remote) · rgba(37,99,235,0.06) (mac) · rgba(15,118,110,0.06) (win) |
| LCA 노란 띠 | `#FBBF24` text | `#9a6700` text + amber line |

### 코드 영역의 작은 다크 액센트 (선택적)
다이프나 config 영역은 라이트 베이스 + 미묘한 색 띠로 처리 — GitHub diff 라이트 모드와 동일. 별도 다크 액센트 없음. 깔끔한 한 테마.

### 로그 영역
- 카드: white bg + border + shadow-sm
- pill: semantic 컬러 (SUCCESS=emerald, ERROR=rose, INFO=sky, WARN=amber, WORKLOG=violet)
- 행 hover: surface-2

## 결과
- 사용자 인지 부담↓ — 어디서나 같은 톤
- diff/config 가독성 ↑ (라이트 모드는 일반 작업 환경에서 더 자연스러움)
- Mac 미러도 동일 적용 가능

## 영향 받는 파일
- `windows_gui/share-manager/src/style.css` — Layer 3 다크 블록 전체 라이트로 재작성
- 별도 코드 변경 없음 (CSS만)

## 검증
체크리스트 L3-A ~ L3-G 모두 ✅ 통과해야 ADR 완료.
