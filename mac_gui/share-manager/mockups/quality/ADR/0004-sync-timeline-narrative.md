# ADR-0004: Sync Timeline — Narrative + Status Summary 추가

**상태**: Accepted (2026-05-24)
**컨텍스트**: ADR-0003 적용 후 그래프는 깔끔히 라이트로 그려졌고 잘림도 해결됨 (image 22). 하지만:
1. 상단 다크 띠가 남아있음 (`.gi-timeline` 잔여 다크 bg)
2. 그래프 자체는 정확하지만 **"무슨 일이 일어났고 뭘 해야 하는지"** 가 안 보임 — 점만 보일 뿐 narrative 없음
3. tip pill "chans-MacBook-Pro HEAD · ma..." 우측 잘림
4. 점에 마우스 올려야만 정보를 볼 수 있는 게 한계

사용자 요청: "현재 상태에 대해 더 깔끔하면서도 구체적으로 안내하는 방식".

## 결정

Sync Timeline 탭을 **3-panel 구조**로 재구성:

### Panel 1 — Status Summary (현재 상태)
가장 위. 한 줄 verdict + 호스트별 한 줄 + 권장 액션.
- **Verdict 한 줄**: 색·아이콘 + 진단 메시지
  - `✓ 동기화됨 · 3 호스트 모두 일치`
  - `⚠ 발산 · Mac이 origin보다 1커밋 앞섬`
  - `⚠ 양쪽 모두 미푸시 · 충돌 가능성`
  - `↓ 뒤처짐 · Mac/Win 모두 pull 필요`
- **호스트 행 3개** (Remote/Mac/Win): 아이콘 + 이름 + sha(mono) + ahead/behind + 메타
- **권장 액션 chip**: `💡 권장: Mac에서 git push 후 Win에서 git pull`

### Panel 2 — Visual Graph (3-소스 타임라인)
ADR-0003 그대로. 단 다크 잔재 제거.
- Tip pill 우측 잘림 해결 (padding 240 → 320, xStep 52 → 44로 빽빽이)
- 점 클릭 가능 — Panel 3 업데이트

### Panel 3 — Selected Commit (선택된 커밋 상세)
그래프 아래 카드. 점 클릭 시 그 커밋의 정보 표시.
- 기본 상태: LCA가 자동 선택 (있으면)
- 표시: SHA(mono, large) + 메시지(굵음) + 저자 + 날짜 + 어느 소스에 있는지 chip
- 빈 상태: "위 그래프의 점을 클릭하면 상세 정보가 여기에 표시돼요"

## 권장 액션 규칙 (verdict → action)

| 상태 | Verdict | Action |
|---|---|---|
| 모두 동일 | ✓ 동기화됨 | "이미 동기화됨 — 추가 작업 필요 없음" |
| Mac만 ahead | ⚠ Mac 앞섬 | "Mac에서 `git push` 후 Win에서 `git pull`" |
| Win만 ahead | ⚠ Win 앞섬 | "Win에서 `git push` 후 Mac에서 `git pull`" |
| 양쪽 ahead | ⚠ 양쪽 발산 | "양쪽 모두 미푸시 — Resolver로 통합 후 push" |
| 한쪽만 behind | ↓ 뒤처짐 | "{host}에서 `git pull`" |
| 양쪽 behind | ↓ 양쪽 뒤처짐 | "양쪽 모두 `git pull`" |
| Win 없음 | ⏳ 단일 호스트 | "Win에서 스캔 필요" |
| dirty 겹침 | 🚨 충돌 임박 | "Resolver로 파일 단위 결정" |

## 결과
- 그래프는 시각, Status Summary는 텍스트 — 둘 다 동시에 보임
- Mac 미러도 동일 narrative 구조 사용
- 한 화면에서 "무엇이 / 왜 / 어떻게" 모두 답함

## 영향 받는 파일
- `app.js` `renderGITimeline` 재작성 — 3 panel HTML
- `app.js` `gitTimelineSVG` — 우측 padding 더, 점 click 핸들러
- `style.css` — `.gtl-*` 신규 클래스 + `.gi-timeline` 다크 bg 제거

## 검증
L3-G 통과 조건:
- 다크 띠 없음 (상단)
- Status Summary 3-host 행 표시 정확
- 권장 액션 규칙대로 출력
- 점 클릭 시 Panel 3 업데이트
- Tip pill 잘림 없음
