# Cross-OS Integration Test — v0.3.0

양 머신을 동시에 띄우고 셰어 마운트 후 매 시나리오를 순차 진행.
12개 cross-OS flow 가 전부 Pass 해야 v0.3.0 ship 가능.

## 사전 준비

- [ ] **Mac**: `share-manager.app` 실행, 셰어 `/Volumes/Mac-Window_Share` 마운트
- [ ] **Windows**: `share-manager.exe` 실행, 셰어 UNC 또는 드라이브 매핑
- [ ] 양쪽 모두 사이드바 status bar 에 `(셰어 OK)` 표시 확인
- [ ] (PAT 테스트 9 위해) GitHub PAT 한 개 준비: `repo` + `read:org` 스코프

각 행: **Pass** / **Fail** / **Skip** 체크 + **Observed** 메모.

---

## 1. 파일 전송 Mac → Windows

**Steps**
1. Mac Finder 에서 임의 파일 (`~/Downloads/test.txt` 등) 우클릭
2. Services → "Windows로 보내기"
3. CategoryPicker 모달에서 `documents` 선택 → "Windows로 전송"

**Expected**
- Mac 측 toast "Windows로 1개 항목 전송 완료"
- Windows L1 Inbox 가 share-changed event 받고 2초 내 새 transfer 행 표시

**Verify**
- Windows 측: `%share%\10_From-Mac\documents\<transfer_id>\manifest.json` 열어서
  Mac 측 `~/Library/Application Support/MacWindowShare/logs/sent.jsonl` 의
  동일 `transfer_id` 와 비교 (`sha256_combined`, `size_total` 모두 일치)
- 양쪽 모두 🔍 검증 버튼 클릭 → `verify_transfer` 가 OK 반환

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 2. 파일 전송 Windows → Mac

**Steps**
1. Windows GUI 에 임의 파일 드래그
2. CategoryPicker 에서 `data` 선택 → 전송

**Expected**
- Mac Inbox 에 transfer 행 2초 내 표시
- Mac 측 `auto_verify_pending` 가 마운트 시점에 자동 실행 → 행이 녹색 (✓ 검증됨)

**Verify**
- `cat ~/Library/Application\ Support/MacWindowShare/logs/received.jsonl` 의
  최신 행이 Windows 측 outbox entry 와 같은 `transfer_id`
- Mac 측 `<share>/00_System/80_Logs/verify/<transfer_id>.json` 가 자동 생성됨
- 매니페스트 dir-hash 재계산 일치

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 3. Shared clipboard sticky-note round-trip (§13.1)

**Steps**
1. Mac ClipboardView 상단 sticky 패널 → "메시지 작성" 클릭
2. "hello from mac" 입력 → "저장 + 게시"
3. Windows 측 ClipboardView 의 동일 패널 응시 (1.5s 대기)
4. Windows 측에서도 "hello from win" 으로 덮어쓰기 → Mac 응시

**Expected**
- 각 방향 모두 1.5초 내 반대편 sticky 패널이 새 메시지로 갱신
- `from.os` 가 메시지를 쓴 OS 와 일치 ("macos" / "windows")

**Verify**
- `<share>/00_System/70_Clipboard/current.json` 의 `content` + `from.os` 가
  마지막으로 저장한 호스트 정보와 일치
- `<share>/00_System/70_Clipboard/history/` 에 시간별 .json 누적 (가장 최근 = 50개 cap)

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 4. Streaming clipboard timeline — NSPasteboard → jsonl (§13.2)

**Steps**
1. Mac 에서 임의 5개 텍스트를 2초 간격으로 OS 클립보드에 복사
   (Cmd-C 5번, 각 다른 문자열)
2. 그다음 Cmd-Ctrl-Shift-4 로 화면 일부 → 클립보드에 PNG 복사
3. ClipboardView 의 streaming timeline 응시

**Expected**
- 1.5초 내 5개 텍스트 행 + 1개 이미지 thumbnail 추가
- 이미지 행: `kind: "image"`, `len: 0`, `image_ref` = `<sha256>.png`

**Verify**
- `tail -n 6 <share>/00_System/70_Clipboard/<MAC_HOSTNAME>.history.jsonl`
  에서 6개 행 확인
- `ls <share>/00_System/70_Clipboard/images/` 에 새 `<sha>.png` 존재
- Windows 측 timeline 에서도 6개 행 표시 + 이미지 thumbnail asset 프로토콜로 로드

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 5. 이미지 클립보드 dedup

**Steps**
1. 동일 PNG 파일을 양쪽에서 동일 바이트로 OS 클립보드에 복사
   (예: Mac 에서 한 번 캡처한 PNG 를 Windows 머신에 전송 후 양쪽 같은 파일 복사)

**Expected**
- `<share>/00_System/70_Clipboard/images/` 디렉토리에 PNG 가 **1개만**
- 양쪽 jsonl 에 별도 행이지만 동일 `image_ref` 참조

**Verify**
```
ls <share>/00_System/70_Clipboard/images/ | wc -l   # 변화 없음
grep image_ref <MAC>.history.jsonl <WIN>.history.jsonl | tail -2  # 같은 ref
```

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 6. Notes — last-write-wins (§12.3)

**Steps**
1. Mac 에서 새 노트 "race" 생성 → 본문 "mac edit" 입력 → 저장
2. 600ms 이내 (사람 손으로는 어려움, 4초 정도) Windows 에서 동일 노트 열고 "win edit" 으로 본문 변경 → 저장

**Expected**
- 양쪽 모두 1.5초 내 본문이 마지막에 저장한 호스트 ("win edit") 로 수렴
- `.conflict.json` 파일 생성 없음 (v1 정책)

**Verify**
- `<share>/00_System/60_Notes/note-<id>.json` 의 `body` = "win edit",
  `updated_by.os` = "windows"
- `ls <share>/00_System/60_Notes/` 에 `*.conflict.json` 없음

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 7. Notes — 동시 create

**Steps**
1. 양쪽에서 "New note" 버튼을 1초 안에 동시 클릭

**Expected**
- 서로 다른 UUID 두 노트 파일 생성
- 양쪽 list 에 두 노트 모두 표시, 정렬 stable

**Verify**
- `ls <share>/00_System/60_Notes/*.json | wc -l` 가 기대 수치 +2
- 두 파일의 `id` 가 다름

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 8. Git data publish Mac → Windows L1 (§18.1, 18.4)

**Steps**
1. Mac 에서 사이드바 "🌿 Git" 클릭 → GitView 열기
2. 툴바 "🔍 지금 스캔" 클릭
3. 진행 (수 분 걸릴 수 있음) → toast "N개 레포 스캔·게시 완료"
4. Windows 측 GitView 응시

**Expected**
- Mac 측: 스캔된 N개 레포 카드 표시, 각 카드 3-node bridge 의 MAC 노드 활성
- Windows 측: 같은 레포 카드에 MAC 노드 SHA 표시 (1.5초 내 share-changed event)

**Verify**
- `<share>/00_System/90_Git/<sanitized-mac-host>.git-status.json` 생성됨,
  `repos[].head` 값이 `git -C <repo> rev-parse HEAD` 와 일치
- `<share>/00_System/90_Git/<sanitized-mac-host>.git-log.json` 도 생성,
  `logs[<owner_repo>][<branch>]` 에 commit 노드 배열

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 9. GitHub PAT round-trip (§18.3)

**Steps**
1. Mac Settings → Git → PAT 입력 → "저장 + 검증"
2. Touch ID / 키체인 dialog 통과 → 녹색 "✅ <login> · org: …" 표시
3. (해당 시) Windows 측 Settings → Git owner 캐시 확인
4. Mac Settings → Git → "삭제" 클릭 → 키체인 항목 제거

**Expected**
- 저장 시 Keychain dialog 1회 (그 후 "Always Allow" 가능)
- `git_has_token()` true → false 로 전환

**Verify**
- 저장 후: `security find-generic-password -s mac-window-git -a github-pat -w`
  실행하면 token 반환 (수동 확인 — 출력 paste 금지)
- 삭제 후: 위 명령이 "specified item could not be found" 반환

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 10. HTML asset pre-flight 모달 (T6)

**Steps**
1. 임의 폴더에 `index.html` + sibling `style.css` 준비
2. Mac 에 `index.html` 만 드래그 (폴더 전체 X)
3. `HtmlInspectorModal` 자동 표시

**Expected**
- 모달이 sibling `style.css` 를 발견 + 표시
- "그대로 보내기" / "폴더째 보내기" / "취소" 선택지 표시
- "폴더째 보내기" 선택 시 부모 디렉토리 전체가 한 manifest 로 전송됨

**Verify**
- Windows 측 manifest 에 두 파일 (.html + .css) 모두 포함됨
- 양쪽 🔍 검증 OK

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 11. Log Hub cross-OS sync (T4)

**Steps**
1. Mac 에서 임의 send 1회 (시나리오 1 재사용 가능)
2. Windows 에서 임의 send 1회
3. 양쪽 Log Hub → Sent / Received / Errors / Compressed images / Worklog 5개 sub-item 순회

**Expected**
- 각 카테고리의 jsonl row 수가 양쪽에서 일치 (실시간 read)
- "Compressed images" sub-item 클릭 시 gallery 표시 (30일 경과된 이미지 있을 때만 — 신규 셰어면 empty state 정상)

**Verify**
- `wc -l <share>/00_System/80_Logs/{send,recv,error,worklog}.jsonl` 의 결과가
  양쪽 view 의 행 수와 일치

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 12. Offline → reconnect (v0.2.4 유지 검증)

**Steps**
1. Mac 실행 상태에서 셰어 강제 unmount: `diskutil unmount /Volumes/Mac-Window_Share`
2. 3개 텍스트를 OS 클립보드에 차례로 복사 (5초 간격)
3. 다시 마운트: `mount_smbfs //user@host/share /Volumes/Mac-Window_Share` 또는 Finder Go → Connect to Server
4. ClipboardView 응시 5초

**Expected**
- Unmount 동안 ClipboardView 의 streaming timeline 에는 3개 행이 보임
  (로컬 캐시 사용)
- Remount 후 5초 내 셰어의 jsonl 에 3개 행 push (backlog drain)
- Notes view 는 unmount 동안 readonly, save 버튼 disabled

**Verify**
- Unmount 중: `~/Library/Application Support/MacWindowShare/cache/clipboard/<host>.history.jsonl`
  에 3행 누적
- Remount 후: `tail -n 3 <share>/00_System/70_Clipboard/<host>.history.jsonl`
  에 3행 동기화됨
- Windows 측에서도 1.5초 내 3행 보임

**Result**: ☐ Pass  ☐ Fail  ☐ Skip
**Observed**:

---

## 종합 판정

- [ ] 12 시나리오 모두 Pass → Phase 3 진행 가능
- [ ] Fail 있음 → 행 번호 + Observed 노트 paste → 패치 후 재시도

Fail 시 패치 정책:
- behavioural 패치 = 별도 commit, **version bump commit 이전**에 land
- cosmetic 패치 = bump commit **이후** fix-up commit (재 bump 없음, 필요시 0.3.1 로 미룸)
