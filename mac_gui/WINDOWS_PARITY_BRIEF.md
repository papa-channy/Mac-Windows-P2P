# Windows GUI — Parity Brief for Mac

**작성**: 2026-05-17 (Windows 측 구현 완료 시점)
**목적**: Windows 측에 구현된 "Mac으로 보내기" 우클릭 워크플로우를 Mac 측에도 동등하게(또는 그 이상으로) 구현하기 위한 인수인계 문서. UI 사양 / 동작 계약 / 파일 포맷 / 디렉터리 매핑까지 Mac 측이 구현 결정만 하면 되게끔 모두 명시.

> 이 문서는 **참조 명세**다. Mac 측 구현이 이 문서와 어긋나면 셰어 양쪽의 manifest/sidecar/네이밍이 깨져서 `shareguard verify`, `shareguard receive`(미구현) 같은 후속 도구가 동작하지 않는다.

---

## 0. 결론 (TL;DR)

Windows에서는 **파일/폴더를 우클릭 → "MacBook으로 보내기" → 다크 테마 다이얼로그 → 카테고리 드롭다운 → 전송**까지 한 번의 메뉴 클릭으로 끝나는 워크플로우가 동작한다. Mac 측은 같은 사용자 경험을 Finder에서 제공해야 한다 (Quick Action / Service / 자체 .app).

다이얼로그 디자인 / 카테고리 매핑 / manifest 스키마 / checksum 포맷은 **양쪽이 완전히 같은 약속**을 따라야 한다. 그래야 같은 파일이 어느 쪽에서 보내졌든 동일하게 검증/수신/아카이브 된다.

---

## 1. Windows 측 현재 상태 (Snapshot, 2026-05-17)

### 1.1 디렉터리 구조

```
D:\Mac-Window_Share\00_System\20_Scripts\windows_gui\
├ mw.ps1                          ← 마운트/연결 관리 (mac_gui/mw 의 PS7 포팅)
├ send-to-mac.ps1                 ← 전송 메인 로직 (이 문서 핵심)
├ _send-dialog.ps1                ← WPF 다이얼로그 정의 (dot-source 됨)
├ launcher.vbs                    ← wscript.exe 경유 콘솔 숨김 런처
├ install.ps1                     ← HKCU 컨텍스트 메뉴 + PATH 등록
└ icons\
   ├ send-to-mac-source.png       ← 2400×2232 원본 (SVG에서 추출)
   ├ send-to-mac.ico              ← 컨텍스트 메뉴용 (Light bg, 7 사이즈 멀티프레임)
   ├ send-to-mac.png              ← Light bg 256px 단일
   └ send-to-mac-dark.png         ← WPF 다이얼로그용 (Dark bg, 흰색 인버트)
```

### 1.2 컴포넌트 역할 (한 줄 요약)

| 파일 | 역할 | Mac 측 대응 |
|---|---|---|
| `mw.ps1` | 마운트/언마운트/status/open/doctor — mac_gui/mw 의 PowerShell 포팅 | **이미 존재**: `mac_gui/mw` |
| `send-to-mac.ps1` | 컨텍스트 메뉴에서 호출되는 메인. 다이얼로그 → 검증 → 복사 → manifest/sidecar/log | **신규 필요**: Mac에선 `send-to-windows` 류 (방향만 반대) |
| `_send-dialog.ps1` | WPF XAML 다이얼로그 2개 (카테고리 선택 / 결과) | **신규 필요**: SwiftUI / Cocoa / AppleScript 중 택일 |
| `launcher.vbs` | `wscript.exe` 통해 콘솔 안 띄우고 pwsh 실행 | **Mac 불필요**: 다른 launch 모델 (.app, Quick Action는 자체적으로 헤드리스) |
| `install.ps1` | HKCU 레지스트리에 컨텍스트 메뉴 + 아이콘 + PATH 등록 | **신규 필요**: Finder Services 등록 (`pluginkit`, `~/Library/Services/`, 또는 Automator Quick Action) |
| `icons/` | 라이트/다크 변형 + 원본 보존 | **공유 가능**: Mac도 `send-to-mac-source.png` 또는 dark variant를 .app icon 재료로 사용 가능 |

---

## 2. 사용자 입장에서의 동작 흐름 (Mac 측이 재현해야 할 것)

1. 사용자가 Finder에서 임의의 **파일 또는 폴더** 우클릭
2. 컨텍스트 메뉴에 **"Windows로 보내기"** 항목이 보임 (Windows 측은 "MacBook으로 보내기")
   - 아이콘 있어야 함 (양방향 화살표 로고 — `icons/send-to-mac-source.png` 또는 변형)
3. 클릭 → **Terminal 창 깜빡임 없이** 다이얼로그 직접 등장
4. 다이얼로그 구성:
   - 헤더: 좌측에 로고(흰색, 24×24), 가운데 타이틀 ("Windows로 보내기"), 우측 닫기 버튼(×)
   - 본문:
     - 라벨 "전송 대상" + 카드(파일/폴더 이모지 + 이름 + 크기·경로)
     - 라벨 "카테고리" + 드롭다운 (8개 항목, 이모지 + 한글 라벨, 내부 폴더코드는 노출하지 않음)
   - 푸터: 우측에 "취소" (고스트) + "Windows로 전송" (강조 #0A84FF 블루)
5. 카테고리 선택 (기본값 `documents` = 📄 문서) → "전송" 클릭
6. 다이얼로그가 **결과 다이얼로그**로 교체:
   - 헤더에 ✓ 성공 뱃지 (그린 #30D158) + "전송 완료" 텍스트
   - 카드: 파일명 / 카테고리(한글 라벨) / SHA-256
   - 푸터: "확인" 단일 버튼
7. 사용자가 "확인" 누르면 닫힘

### 2.1 키보드 단축키
- `ESC` = 닫기/취소
- `Enter` = 전송 (기본 버튼이 강조 버튼)

### 2.2 윈도우 동작
- **타이틀바 없음** (커스텀 chrome)
- 헤더바를 마우스로 드래그하면 윈도우 이동
- 라운드 코너 (14px outer, 7~8px inner)
- 드롭섀도우 (검정 28px blur, opacity 0.55)
- Topmost: True (다른 창 위로 떠야 함)
- Center on screen

---

## 3. 비주얼 사양 (다이얼로그)

### 3.1 컬러 토큰 (정확히 일치시킬 것 — 양쪽 디자인 통일)

```text
Surface         #1B1B22   본문 배경
Surface2        #26262E   입력/카드 배경
SurfaceLow      #13131A   헤더/푸터 배경
TextPri         #F0F0F5   주요 텍스트
TextSec         #9090A0   보조 텍스트
Accent          #0A84FF   강조 (Send 버튼) — iOS 시스템 블루
AccentHi        #369AFF   강조 hover
Border1         #33333D   카드/입력 테두리
Danger          #FF453A   닫기 버튼 hover
Success         #30D158   결과 다이얼로그 성공 뱃지
```

### 3.2 타이포

```text
Font family   "Segoe UI, Malgun Gothic"  → Mac에선 "SF Pro Text, Apple SD Gothic Neo, -apple-system"
Title          14pt SemiBold
Body           13pt Regular
Caption        11pt SemiBold (uppercase 느낌은 굵기로 표현, transform은 안 씀)
Mono (해시)    10~11pt Consolas / SF Mono
```

### 3.3 사이즈/패딩

- 다이얼로그 너비: 500~520px (높이는 콘텐츠에 맞춰 auto)
- 헤더/푸터 높이: 약 50px
- 본문 패딩: 26px 좌우, 18~22px 상하
- 카드 패딩: 14~16px 좌우, 12~14px 상하
- 카드 코너: 8px
- 버튼: padding 22×11, 코너 7px

### 3.4 카테고리 드롭다운 — 표시 형식

```text
📄   문서
📊   데이터
💻   코드
🔬   리서치
⚙    환경설정
🛠   빌드
🎨   애셋
📦   기타
```

**원칙**: 사용자 노출 텍스트에는 **내부 폴더 코드(`30_Documents` 등)를 절대 보이지 않는다.** 셰어 내부 구조는 추후 커스텀 파일 탐색기로 관리.

---

## 4. 데이터 계약 (이 부분이 핵심, 양쪽이 100% 일치해야 함)

### 4.1 카테고리 매핑 (정규형)

| 키 (영문 lower) | 한글 라벨 | 이모지 | 폴더 코드 |
|---|---|---|---|
| `documents` | 문서 | 📄 | `30_Documents` |
| `data` | 데이터 | 📊 | `20_Data` |
| `repos` | 코드 | 💻 | `10_Repos` |
| `research` | 리서치 | 🔬 | `40_Research` |
| `env` | 환경설정 | ⚙ | `50_Env` |
| `builds` | 빌드 | 🛠 | `60_Builds` |
| `assets` | 애셋 | 🎨 | `70_Assets` |
| `misc` | 기타 | 📦 | `90_Misc` |
| `unclassified` | 미분류 | ❔ | `99_Unclassified` |

기본 선택: **`documents`**

**멀티파일 일괄 전송**: 2개 이상의 파일/폴더를 한 번에 드롭하면 카테고리 선택 다이얼로그를 건너뛰고 모두 `unclassified` (미분류)로 자동 전송. 단일 항목 드롭만 카테고리 다이얼로그 표시.

### 4.2 방향 매핑

- Mac이 보내는 경우 → `10_Exchange/10_Mac_to_Windows/20_Ready/<폴더코드>/`
- Windows가 보내는 경우 → `10_Exchange/20_Windows_to_Mac/20_Ready/<폴더코드>/`

### 4.3 네이밍 규칙

```text
<YYYY-MM-DD>__<category-key>__<basename>__v<NN><ext>
```

예시:
- `2026-05-17__documents__sg-gui-test_한글파일명__v01.txt`
- `2026-05-17__documents__추가 개발 서류 완성본__v01` (폴더는 ext 없음)

규칙:
- `category-key`는 영문 소문자 키 (`documents`/`data`/…) — 한글 라벨 아님
- `basename`은 원본 파일/폴더 이름의 확장자 제외 부분 그대로 (한글/공백 허용)
- 폴더 전송 시 ext 없음
- 버전은 기본 `v01`. 이미 있으면 사용자에게 덮어쓰기 확인 (다이얼로그) 또는 v02로 bump (구현 선택)

### 4.4 SHA-256 산정 규칙

**파일 전송**: 도착본을 그대로 SHA-256

**폴더 전송**: 폴더 내부의 모든 파일에 대해 개별 SHA-256을 구하고, "`<relative-path>\0<sha256>\n`" 형식 라인을 정해진 순서(`Get-ChildItem -Recurse -File` 순서와 동일하게 Mac에서는 `find` 또는 `walk` 결과의 lexicographic 순서)로 이어 붙인 바이트열의 SHA-256 = **dir-hash**

```
combined = SHA-256( concat( "<rel1>\0<sha1>\n", "<rel2>\0<sha2>\n", ... ) )
```

이 정의를 어기면 양쪽 디렉터리 해시가 불일치한다. Windows 측 구현(`send-to-mac.ps1` line ~138–151) 참고.

### 4.5 Manifest JSON 스키마

경로: `00_System/30_Manifests/<direction>/<transfer-id>.json`

`<transfer-id>` 형식:
```
<YYYY-MM-DDTHHmmss±ZZZZ>__<source>__<target>__<category>__<batch-name>__v<NN>
```
(`±ZZZZ`는 콜론 없는 타임존, 예: `+0900`)

스키마 (현재 phase-1 shim 기준 — `shareguard send` 정식 구현 시 SHAREGUARD_SPEC.md §5 v1 풀스키마로 진화):

```json
{
  "schema_version": 1,
  "tool": "send-to-windows.<lang> (phase-1 shim)",
  "tool_version": "0.1.0",
  "transfer_id": "2026-05-17T212055+0900__mac__windows__documents__report__v01",
  "created_at": "2026-05-17T21:20:55+09:00",
  "direction": "mac_to_windows",
  "category": "documents",
  "batch_name": "report",
  "version": 1,
  "source": {
    "host": "MAC-31401A",
    "user": "chan",
    "path": "/Users/chan/Desktop/report.html"
  },
  "destination": {
    "share_path": "10_Exchange/10_Mac_to_Windows/20_Ready/30_Documents/",
    "primary_file": "2026-05-17__documents__report__v01.html"
  },
  "mode": "file",
  "files": [
    {
      "path": "2026-05-17__documents__report__v01.html",
      "size_bytes": 18185,
      "sha256": "f241b64ecb58c8ee...",
      "mtime": "2026-05-17T21:20:55+09:00"
    }
  ],
  "totals": { "files_included": 1, "bytes_out": 18185 },
  "state": "ready"
}
```

폴더 모드 (`mode: "directory"`)는 files 배열에 모든 내부 파일 엔트리 + totals에 합계.

### 4.6 Checksum sidecar

경로: `00_System/50_Checksums/<direction>/<transfer-id>.sha256`

포맷 (`shasum -a 256` / `sha256sum -c` 호환, **헥스 두 칸 공백 파일명**):

```text
f241b64ecb58c8ee34c43d83720deb5775db9c54f27a17fd58cd4069edc04c34  2026-05-17__documents__report__v01.html
```

폴더 모드:
```text
<sha>  <folder>/<rel-path-1>
<sha>  <folder>/<rel-path-2>
...
<dir-hash>  <folder>  # combined dir-hash
```

마지막 줄의 `# combined dir-hash` 코멘트는 사람용 표식. 도구는 일반 라인으로 처리(`#` 시작 라인은 shareguard verify가 skip).

### 4.7 Log

경로: `00_System/40_Logs/<direction>/<transfer-id>.log`

현재 phase-1 shim은 3줄(plain text):
```text
[2026-05-17T21:20:55.0319495+09:00] context-menu send: <abs-src> -> <abs-dst>
[2026-05-17T21:20:55.0319495+09:00] mode=file  hash=<full-sha>  payload=<n> bytes
[2026-05-17T21:20:55.0319495+09:00] state=ready transfer_id=<transfer-id>
```

`shareguard send` 정식판은 JSONL (SHAREGUARD_SPEC.md §9 참고). phase-1 shim 끼리는 plain text로 OK.

---

## 5. 검증 / 차단 규칙

### 5.1 RAW_SECRET 차단 (필수)

다음 패턴에 매칭되는 파일은 **무조건 차단**(다이얼로그 에러 표시 → exit 11):

```text
*.pem
*.key
*.p12
*.mobileprovision
.env  (exact)
.env.production
.env.local
.env.development
service-account*.json
```

대소문자 무시 매칭. 차단 메시지 예시:
```
BLOCKED by RAW_SECRET rule (matched: .env (exact)).

Use .env.example / 1Password / Doppler instead.
```

(SHAREGUARD_SPEC.md §3.1 RAW_SECRET 룰과 동일 — 정식 `shareguard check` 구현 후엔 그 쪽으로 위임)

### 5.2 덮어쓰기 처리

도착지에 동명 파일/폴더 이미 있으면:
- GUI: "이미 존재합니다 — 덮어쓰기?" YesNo 다이얼로그
- 폴더 덮어쓰기 시: 기존 폴더 재귀 삭제 후 새로 복사

### 5.3 Exit codes (정식 SHAREGUARD_SPEC §1.4 따름)

| Code | 의미 |
|---|---|
| 0 | OK |
| 11 | RAW_SECRET 등 블록 |
| 20 | I/O 에러 |
| 64 | usage / 잘못된 입력 |

---

## 6. 콘솔 숨기기 (UX 결정적)

**Windows 방식**: `wscript.exe → launcher.vbs → pwsh.exe -File send-to-mac.ps1`
- 레지스트리에 등록된 명령이 `wscript.exe`로 시작 → wscript는 콘솔 없는 호스트
- launcher.vbs가 `WScript.Shell.Run cmd, 0, False`로 pwsh를 **window 0=hidden**으로 실행
- 사용자에겐 PowerShell 창 깜빡임 일체 없음

**Mac 방식 선택지**:
1. **Quick Action (Automator/Shortcuts)**: Run AppleScript 또는 Run Shell Script. 기본적으로 헤드리스.
2. **Service**: `~/Library/Services/<name>.workflow` — Finder 우클릭 메뉴 "Services" 하위에 노출. Quick Action과 사실상 동일.
3. **.app 번들**: 자체 `.app` 만들고 Finder의 "Open With" 또는 사용자 지정 컨텍스트 메뉴(서드파티 툴 필요).

권장: **Quick Action**. 우클릭 메뉴에 직접 노출되고 헤드리스이며 .applescript 또는 Shortcuts로 작성 가능.

### 6.1 Mac 다이얼로그 구현 옵션

| 옵션 | 장점 | 단점 |
|---|---|---|
| **SwiftUI 앱** (별도 .app) | Windows WPF와 동등 수준의 디자인 가능, 다크 테마 자유 | Swift 빌드 환경 필요, Mac 배포 절차 |
| **AppleScript dialog** | 즉시 사용 가능 | 디자인 자유도 거의 없음, "윈도우 네이티브한 디자인" 회피 목적과 충돌 |
| **Cocoa NSAlert + NSPopUpButton** | 별도 빌드 없음(osascript), 어느 정도 디자인 가능 | 다크 테마 강제는 가능하지만 Windows WPF만큼 자유롭지 않음 |
| **Web view (WKWebView in .app)** | HTML/CSS로 동일 디자인 픽셀 단위 재현 가능 | .app 빌드 필요, JS<->Swift 브리지 |

**추천**: SwiftUI 별도 .app. mac_gui/`MacWindowShare.applescript` (이미 존재) 와 별도로 `SendToWindows.app` 만들기. Quick Action이 그 .app을 호출(인자로 선택된 파일 경로 전달).

---

## 7. Mac 측 구현 체크리스트

- [ ] Finder Services / Quick Action 등록 — 파일/폴더 우클릭 메뉴 "Windows로 보내기"
- [ ] 다크 테마 다이얼로그 (위 §3 사양 그대로)
- [ ] 카테고리 드롭다운 (§4.1 정확히, 폴더코드 노출 X)
- [ ] 파일 vs 폴더 분기 처리
- [ ] RAW_SECRET 차단 (§5.1)
- [ ] 네이밍 규칙 (§4.3)
- [ ] 도착지 경로 (§4.2 — Mac 측은 `10_Mac_to_Windows`)
- [ ] SHA-256 계산 (파일: 단순, 폴더: §4.4 dir-hash)
- [ ] Manifest JSON 생성 (§4.5)
- [ ] Checksum sidecar (§4.6)
- [ ] Log 생성 (§4.7)
- [ ] 결과 다이얼로그 (§2.6)
- [ ] 콘솔/터미널 안 띄우기 (§6)
- [ ] ESC=취소 / Enter=전송 키 바인딩
- [ ] 헤더 드래그로 윈도우 이동
- [ ] 셰어 마운트 확인 (마운트 안 돼있으면 `mw mount` 자동 호출 — mac_gui/mw 이미 존재)

---

## 8. 참조용 — Windows 구현 정확한 파일 경로

(Mac 구현 시 의문점이 생기면 이 파일들을 셰어에서 직접 열어보면 됨)

```
00_System/20_Scripts/windows_gui/send-to-mac.ps1
  → 메인 비즈니스 로직. RAW_SECRET 체크, 네이밍, 파일/폴더 분기,
    manifest/sidecar/log 생성을 모두 여기서 한다. 약 220줄.

00_System/20_Scripts/windows_gui/_send-dialog.ps1
  → WPF XAML 2개 (Show-CategoryDialog, Show-ResultDialog).
    Mac SwiftUI 구현 시 색상/레이아웃 시각적 참조용.

00_System/20_Scripts/windows_gui/install.ps1
  → 컨텍스트 메뉴 등록 패턴 (Windows는 HKCU, Mac은 다른 mechanism이지만
    "어떤 메뉴 텍스트 + 어떤 아이콘 + 어떤 명령" 매핑은 동일하게 가야 함).

00_System/20_Scripts/windows_gui/launcher.vbs
  → 콘솔 숨김 launch 패턴 (Mac에선 불필요, 참조만).

00_System/20_Scripts/common_cli/SHAREGUARD_SPEC.md
  → 정식 shareguard CLI 명세. phase-1 shim은 그쪽 §5 manifest 스키마의
    부분집합을 따른다. 정식 구현 시 양쪽 모두 이 스펙으로 이행.
```

---

## 9. 미해결 결정 사항 (Mac 측 결정 필요)

1. **다이얼로그 구현 기술**: SwiftUI / Cocoa / Web view 중 선택
2. **.app 번들 ID**: 예 `com.shareguard.sendtowindows`
3. **Quick Action 표시명**: "Windows로 보내기" / "MacBook → Windows 전송" 등
4. **Quick Action 아이콘**: `send-to-mac-source.png` 재사용 vs Mac 전용 변형
5. **덮어쓰기 다이얼로그 디자인**: Windows는 시스템 MessageBox 사용 중. Mac도 같은 톤의 커스텀 다이얼로그 만들지 또는 NSAlert
6. **버전 자동 bump (v02, v03...)** vs **덮어쓰기 확인** 정책 — 현재 Windows는 후자

---

## 10. 동기화 신호 (양쪽 합의 완료 후)

이 문서 기반으로 Mac 측 구현이 끝나면:
1. Mac이 셰어의 `10_Exchange/10_Mac_to_Windows/20_Ready/30_Documents/` 에 테스트 파일 한 개 우클릭 송신
2. Windows 측에서 자동 검증:
   - 파일 존재
   - manifest JSON 스키마 일치
   - checksum sidecar 포맷 일치
   - SHA-256 매치
   - `shareguard verify` exit 0
3. 양쪽이 OK면 Mac→Win, Win→Mac 둘 다 한 시스템으로 동작 확정

---

## 부록 A — Windows 현재 다이얼로그 스크린샷 묘사

(이미지 첨부 불가하므로 ASCII로)

```
┌──────────────────────────────────────────────┐
│  [logo]  MacBook으로 보내기              [✕] │  ← 헤더 #13131A
├──────────────────────────────────────────────┤
│                                              │
│  전송 대상                                   │  ← Caption #9090A0
│  ┌─────────────────────────────────────────┐ │
│  │ 📄  sg-gui-test_한글파일명.txt          │ │  ← 카드 #26262E
│  │     186 bytes  ·  D:\Sample\sg-gui-...  │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  카테고리                                    │
│  ┌─────────────────────────────────────────┐ │
│  │ 📄   문서                            ▾ │ │  ← ComboBox
│  └─────────────────────────────────────────┘ │
│                                              │
├──────────────────────────────────────────────┤
│                      [ 취소 ] [ MacBook으로 │  ← 푸터
│                                   전송 ]    │
└──────────────────────────────────────────────┘
   배경 #1B1B22, 라운드 14px, 드롭섀도우
```

결과 다이얼로그:

```
┌──────────────────────────────────────────────┐
│  [✓]  전송 완료                              │  ← Success #30D158
│       MacBook이 공유폴더에서 받을 수 있어요  │
├──────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐ │
│  │ 파일명                                  │ │
│  │ 2026-05-17__documents__sg-gui-test...   │ │
│  │ 카테고리                                │ │
│  │ 📄 문서                                 │ │
│  │ SHA-256                                 │ │
│  │ f241b64ecb58c8ee...                     │ │
│  └─────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│                              [    확인    ] │
└──────────────────────────────────────────────┘
```

---

---

## 11. 공유 정책 & 호스트 프로필 (v2 contract)

양쪽이 **같은 파일을 읽고/쓰는** 단일 진실 소스. 셰어 안에 위치하므로 어느 쪽이 바꿔도 즉시 반영.

### 11.1 `00_System/10_Config/global/policy.json`

```json
{
  "schema_version": 1,
  "network_mode": "closed",     // "closed" | "open"
  "secrets": {
    "closed_network_allows": true,
    "always_blocked_patterns": [
      "service-account*.json", "*.p12", "*.pfx",
      "*.mobileprovision", "id_rsa", "id_ed25519"
    ]
  },
  "language_detection": {
    "enabled": true,
    "markers": {
      "rust":   ["Cargo.toml"],
      "go":     ["go.mod"],
      "node":   ["package.json", "pnpm-workspace.yaml", "yarn.lock", "package-lock.json"],
      "python": ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "poetry.lock"],
      "java":   ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle"],
      "dotnet": ["*.csproj", "*.fsproj", "*.sln"],
      "swift":  ["Package.swift", "*.xcodeproj"],
      "ruby":   ["Gemfile"],
      "elixir": ["mix.exs"],
      "deno":   ["deno.json", "deno.jsonc"]
    },
    "git_marker_dirs": [".git", ".hg", ".svn"]
  },
  "line_endings": {
    "annotate_in_manifest": true,
    "preferred_for_text": "lf"
  },
  "filename_compat": {
    "enforce_windows_invalid_chars": true,
    "normalize_unicode": "nfc",
    "case_sensitivity_warning": true
  }
}
```

**중요**: `network_mode = "closed"` 일 때만 `.env`, `*.pem`, `*.key`, API 키 등이 통과. SSH 키 / 인증서 / 모바일 프로비저닝(`always_blocked_patterns`)은 어느 모드든 차단.

### 11.2 시크릿 정책 파일

`00_System/10_Config/ignore_rules/_secrets_policy/`
- `closed-network.shareignore` — 닫힘 모드에서도 차단할 패턴 (서명/인증서/SSH 키 등)
- `open-network.shareignore` — 열림 모드 차단 패턴 (광범위: .env, *.pem 등 전부)

송신 도구가 `policy.network_mode` 읽고 해당 파일의 패턴으로 RAW_SECRET 검사.

### 11.3 언어 프리셋

`00_System/10_Config/ignore_rules/_language_presets/`

| 파일 | 내용 |
|---|---|
| `rust.shareignore` | `target/`, `**/*.rs.bk`, `*.pdb`, … |
| `go.shareignore` | `*.exe`, `vendor/`, `*.test`, … |
| `node.shareignore` | `node_modules/`, `.next/`, `dist/`, `coverage/`, … |
| `python.shareignore` | `__pycache__/`, `.venv/`, `*.egg-info/`, `.pytest_cache/`, … |
| `java.shareignore` | `target/`, `build/`, `.gradle/`, `*.class`, … |
| `dotnet.shareignore` | `bin/`, `obj/`, `*.user`, `.vs/`, … |
| `swift.shareignore` | `.build/`, `.swiftpm/`, `DerivedData/`, … |
| `generic.shareignore` | `.DS_Store`, `Thumbs.db`, `*.swp`, … (항상 적용) |

**적용 알고리즘** (송신 시):
1. 소스가 폴더면 depth 2까지 스캔
2. policy.json `language_detection.markers` 의 패턴과 매치되는 파일 발견 → 해당 언어 detected
3. detected 언어들의 `*.shareignore` + `generic.shareignore` + `_secrets_policy/<mode>-network.shareignore` 를 모두 합쳐 ignore 규칙으로 사용
4. 결과: `manifest.policy_applied.detected_languages` 에 기록

현재 phase-1 shim 은 **감지만 하고 enforcement는 안 함** (모든 파일 복사됨). 정식 enforcement는 `shareguard send` Rust 구현에서. 두 측 모두 같은 규칙 셋을 합의했으므로 도구만 따라오면 됨.

### 11.4 호스트 프로필 게시

각 호스트가 자기 프로필을 `00_System/10_Config/profiles/<host>.profile.json` 에 게시. 양쪽이 서로 봄.

**스키마 (v1)**:
```json
{
  "schema_version": 1,
  "host": "DESKTOP-Q0S7LSQ",
  "host_id": "DESKTOP-Q0S7LSQ",
  "os": "windows",            // "windows" | "macos" | "linux"
  "os_version": "11",
  "arch": "x86_64",            // "x86_64" | "aarch64"
  "user": "chan",
  "published_at": "2026-05-20T22:30:00+09:00",
  "tools": {
    "share_manager": "0.1.0"
  },
  "capabilities": [
    "wpf-dialogs",
    "vscode-icon-themes",
    "policy-aware-send",
    "language-detection"
  ]
}
```

**Mac 측**: `<mac-hostname>.profile.json` 파일명. 동일 스키마. `os: "macos"`, `tools` 에 `send_to_windows: ...` 등 자기 도구 버전 명시.

### 11.5 Manifest 확장 (v1.1)

기존 manifest 스키마에 다음 필드 추가:

```json
{
  "...": "...",
  "policy_applied": {
    "network_mode": "closed",
    "block_patterns": 9,
    "detected_languages": ["rust", "node"],
    "has_git": true
  },
  "line_endings_summary": {     // optional, 권장
    "lf": 12,
    "crlf": 3,
    "mixed": 1,
    "binary": 24
  }
}
```

`files[]` 엔트리에 per-file `line_endings: "lf"|"crlf"|"mixed"|"binary"` 도 권장 (annotate only — 변환 X).

### 11.6 CRLF 정책

**바이트 변환은 절대 안 함** (SHA-256 깨짐). 송신 도구는 텍스트 파일을 sniff 해서 manifest에 정보만 기록. 수신측에서 필요하면 정규화 도구 별도 실행.

검출 휴리스틱:
- NUL 바이트 포함 → `binary`
- CR(0x0D) 없음, LF(0x0A) 있음 → `lf`
- CRLF 만 있음 → `crlf`
- LF + CRLF 섞임 → `mixed`

### 11.7 Mac 측 구현 체크리스트 (v2 contract)

- [ ] `send-to-windows` 도구가 시작 시 `policy.json` 로드
- [ ] `network_mode` 에 따라 `_secrets_policy/{closed,open}-network.shareignore` 패턴으로 RAW_SECRET 검사
- [ ] 폴더 전송 시 markers 로 언어 감지 → manifest `policy_applied.detected_languages` 에 기록
- [ ] `.git` 디렉터리 발견 시 `has_git: true`
- [ ] 시작 시 자기 호스트 프로필 `profiles/<host>.profile.json` 게시
- [ ] (선택) 텍스트 파일 line-endings 감지 후 manifest 에 기록

---

---

## 12. 공유 메모 (`00_System/60_Notes/`)

Evernote 스타일의 호스트 간 공유 메모장. 양쪽이 같은 메모를 편집, 마지막 저장이 winner.

### 12.1 디렉터리

```
00_System/60_Notes/
└── <note-id>.json          ← 메모 1개 = 1 파일
```

`<note-id>` 형식: `note-<uuid-simple>` (32자 hex, 하이픈 없이). 새 메모 생성 시 UUIDv4 simple로 부여.

### 12.2 메모 JSON 스키마 (v1)

```json
{
  "schema_version": 1,
  "id": "note-7d9a8b3c4e1f2a5b6c7d8e9f0a1b2c3d",
  "title": "회의 메모 - 2026-05-20",
  "body": "마크다운 또는 plain text. 길이 제한 없음.",
  "created_at": "2026-05-20T22:00:00+09:00",
  "updated_at": "2026-05-21T01:23:45+09:00",
  "updated_by": {
    "host": "DESKTOP-Q0S7LSQ",
    "os": "windows"
  }
}
```

**갱신 규칙**:
- `created_at` 은 처음 생성된 호스트가 박은 값 그대로 유지 (재기록 X)
- `updated_at`, `updated_by` 는 매 save 시 덮어씀
- `body` 는 plain text (마크다운 렌더링은 클라이언트가 알아서)
- `title` 이 비어있어도 OK — UI에서 "(제목 없음)" 으로 표시

### 12.3 동시 편집 충돌 정책 (현재)

- **last-write-wins**: 두 호스트가 동시 수정 → 더 늦은 `updated_at` 이 디스크에 남음
- 충돌 감지/머지는 v1 비스코프. 양쪽 동시 편집은 운영자가 회피
- 향후 (v2): pre-save 비교, 충돌 시 `<id>.<host>.conflict.json` 으로 분기 저장 가능

### 12.4 자동 저장 디바운스

UI는 입력 정지 후 **600ms 디바운스**로 저장 호출. 너무 빠른 저장은 SMB 트래픽 + 파일시스템 이벤트 폭주. Mac UI도 같은 디바운스 권장.

### 12.5 삭제

`delete_note(id)` → 해당 `<id>.json` 파일 즉시 삭제. 휴지통 없음. 양쪽 모두 즉시 사라짐 (파일 watcher 이벤트로 갱신).

### 12.6 Mac 측 구현 체크리스트 (메모)

- [ ] `list_notes()` → 디렉터리 스캔, body는 snippet(160자)으로 잘라서 반환
- [ ] `get_note(id)` → 단일 JSON 읽기
- [ ] `save_note(id, title, body)` → id 없으면 신규 UUID 부여, `created_at` 보존, `updated_*` 갱신
- [ ] `delete_note(id)` → 파일 삭제
- [ ] 600ms 디바운스로 자동저장
- [ ] 파일 watcher 받으면 list 새로고침 (별도 §14)

---

## 13. 공유 클립보드 (`00_System/70_Clipboard/`)

**모델**: 양쪽이 자기 OS 클립보드를 자동 기록 → 통합 타임라인 → 클릭 한 번으로 내 OS 클립보드에 복사. 송수신 모델 아님.

### 13.1 디렉터리

```
00_System/70_Clipboard/
├── <hostname>.history.jsonl   ← Windows host's clip history
└── <hostname>.history.jsonl   ← Mac host's clip history
```

`<hostname>` 은 영숫자 + `-_` 만 남긴 sanitized 호스트명 (Windows: `COMPUTERNAME`, Mac: `scutil --get LocalHostName` 또는 `hostname` 결과).

### 13.2 JSONL 한 줄 스키마

```json
{"ts":"2026-05-21T01:23:45+09:00","host":"chans-MacBook-Pro","os":"macos","content":"https://github.com/...","kind":"text","len":42}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `ts` | string (RFC3339 + tz) | 기록 시점 |
| `host` | string | 원본 호스트명 (sanitize 안 한 값) |
| `os` | `"windows"` \| `"macos"` \| `"linux"` | 호스트 OS |
| `content` | string | 클립보드 텍스트 (UTF-8) |
| `kind` | `"text"` | v1은 텍스트만. 향후 `"image"`, `"file-ref"` 등 |
| `len` | int | content 의 unicode codepoint 수 (truncate 판단용) |

### 13.3 자동 기록 알고리즘 (양쪽 동일)

```text
loop:
  sleep 1.5s
  text = read_os_clipboard_text()
  if text empty: continue
  if text == last_known: continue
  if text.codepoints > 32000:
    text = take_first(32000) + "\n…(truncated)"
  append_line_to(<own_host>.history.jsonl, entry)
  rotate(<own_host>.history.jsonl, max_lines=200)
  last_known = text
```

**중요**:
- 자기 호스트 파일에만 append. 다른 호스트 파일은 절대 건드리지 말 것.
- 200줄 회전 (오래된 줄 잘라냄, 파일 끝 200줄만 유지).
- empty / 동일값 skip → 불필요한 중복 방지.
- 32K 코드포인트 초과 시 truncate + 마커.

### 13.4 OS 클립보드 접근

| OS | 권장 방법 |
|---|---|
| **Windows** | `tauri-plugin-clipboard-manager` (Rust) — 내부적으로 `arboard` 크레이트 사용. 모든 스레드에서 호출 가능. |
| **macOS** | `NSPasteboard.general.string(forType: .string)` (Swift) — `changeCount` 폴링으로 변경 감지 가능 (효율적). |

Mac 측은 `changeCount` 활용 가능하면 1.5초 폴링 대신 changeCount 변경 시점에만 read → 더 가볍게 구현 가능. JSONL append 시점은 동일.

### 13.5 통합 타임라인 읽기

```text
list_clipboard_entries(limit=200):
  all = []
  for f in glob("70_Clipboard/*.history.jsonl"):
    for line in read_lines(f):
      if not line.strip(): skip
      all.append(parse_json(line))
  sort all by ts desc
  return all[:limit]
```

UI는 모든 호스트의 항목을 하나의 시간순 리스트로 보여줌. OS 배지 (`Win` 파랑 / `Mac` 초록) 로 출처 구분.

### 13.6 클릭 → 내 OS 클립보드로 복사

행 클릭 시 그 entry의 `content` 를 자기 OS 클립보드에 write. 그 즉시 자기 폴러가 변경 감지 → 자기 history 에 새 entry append. **이 자체 피드백 1회는 의도된 동작** (사용자가 "재복사" 신호로 받아들임).

### 13.7 비-노이즈 정책

- 빈 텍스트: append 안 함
- 직전 값과 동일: append 안 함
- ≥32K chars 길이: truncate

### 13.9 이미지 클립보드 (`kind: "image"`) — 구현됨 (Windows)

텍스트와 **별도 채널**로 이미지도 자동 기록. 폴러가 매 틱마다 텍스트와 이미지를 각각 읽고, 각자 직전 해시와 비교해 변경 시에만 기록.

**저장 구조**:
```
00_System/70_Clipboard/
├── <hostname>.history.jsonl    ← text + image 엔트리 혼재
└── images/
    └── <sha256>.png             ← 인코딩된 PNG (sha256 = PNG 바이트 해시, dedup)
```

**이미지 엔트리 JSONL 스키마 (v2 — 양쪽 동일)**:
```json
{
  "ts": "2026-05-22T17:49:05+09:00",
  "host": "DESKTOP-Q0S7LSQ",
  "os": "windows",
  "kind": "image",
  "image_ref": "ca1e8cf6...9f34.png",
  "width": 480,
  "height": 320,
  "size_bytes": 5016,
  "content": "📷 image (480×320, 4 KB)",
  "len": 0
}
```
- `size_bytes` (구 `bytes` 폐기), `content`(v1 호환 라벨, `×` = U+00D7), `len: 0` 필수.
- Windows 2026-05-22 정렬 완료.

**기록 알고리즘** (양쪽 동일):
```text
img = read_os_clipboard_image()   # RGBA raw + width + height
if img present and not empty:
  raw_hash = sha256(rgba_bytes)
  if raw_hash != last_image_hash:
    # downscale longest edge to policy.clipboard.image_max_dimension (default 2560)
    scaled = downscale(img, max_dim) if longest_edge > max_dim else img
    png = encode_png(scaled, best_compression)
    sha = sha256(png_bytes)
    write images/<sha>.png  (skip if exists — dedup)
    append jsonl { kind:"image", image_ref:"<sha>.png", width, height, bytes }
    last_image_hash = raw_hash
```

**표시**: 통합 타임라인에서 이미지 엔트리는 썸네일로 (asset 프로토콜 / convertFileSrc로 `images/<image_ref>` 로드). 최대 320×180 박스.

**클릭 → 복사**: `copy_image_to_os_clipboard(image_ref)` → PNG 디코드 → RGBA → OS 클립보드에 이미지로 write.

**보관/압축 정책** (`policy.json` → `clipboard`):
```json
"clipboard": {
  "image_retention_days": 30,
  "image_max_dimension": 2560,
  "image_total_cap_mb": 300
}
```
- 신선: PNG 무손실, 최대 2560px 다운스케일, sha256 dedup
- **30일 경과 → 이미지 파일 삭제** (JSONL 엔트리는 tombstone로 남아 "🖼 만료됨" 표시)
- **총량 300MB 캡** → 초과 시 오래된 것부터 제거 (나이 무관)
- sweep: 폴러 시작 시 1회 + 6시간마다

**OS별 이미지 접근**:
| OS | 읽기 | 쓰기 |
|---|---|---|
| Windows | `clipboard().read_image()` (arboard, RGBA) | `clipboard().write_image(&Image)` |
| macOS | `NSPasteboard.general.data(forType: .png)` 또는 `.tiff` → RGBA 변환 | `NSPasteboard` 에 PNG/TIFF write |

**Mac 측 체크리스트 (이미지)**:
- [ ] 폴러에 이미지 브랜치 추가 (텍스트와 별도 last-hash 추적)
- [ ] RGBA → PNG 인코딩, 최대 2560px 다운스케일, sha256 dedup
- [ ] `images/<sha>.png` 저장 + jsonl `kind:image` append
- [ ] 타임라인 썸네일 렌더 (PNG 파일을 자기 share root 경유 표시)
- [ ] 클릭 → PNG 디코드 → NSPasteboard 에 이미지 write
- [ ] 30일 삭제 + 300MB 캡 sweep (양쪽이 sweep 하면 같은 파일 정리 — race 무해)

> **주의**: Windows가 만든 이미지 파일을 Mac이 읽을 때 경로는 자기 share root 기준 (`/Volumes/Mac-Window_Share/00_System/70_Clipboard/images/<ref>`). 같은 물리 폴더이므로 그대로 읽힘. 호스트별 절대경로를 JSONL에 박지 말 것 — `image_ref`(파일명)만 저장.

### 13.8 Mac 측 구현 체크리스트 (클립보드)

- [ ] 백그라운드 폴러 시작 (앱 launch 직후)
- [ ] `changeCount` 또는 1.5초 polling 으로 변경 감지
- [ ] 자기 호스트의 `<hostname>.history.jsonl` 에 append
- [ ] 200줄 회전 자동
- [ ] 32K codepoint 초과 truncate
- [ ] `list_clipboard_entries(limit)` 명령 — 모든 호스트 jsonl 머지
- [ ] `copy_to_os_clipboard(text)` 명령 — `NSPasteboard.setString`
- [ ] `clear_own_clipboard_history()` 명령 — 자기 jsonl만 삭제 (다른 호스트 거 보존)

---

## 14. 파일 시스템 watcher (`share-changed` 이벤트)

**폴링 X, watcher O**. 변경 발생 시점에만 UI 갱신.

### 14.1 Windows 구현 (참고)

Rust `notify` 크레이트 (`ReadDirectoryChangesW` 래퍼). 별도 thread에서 watch:

```text
watch_paths:
  - share/10_Exchange/           (recursive)
  - share/00_System/70_Clipboard/  (recursive)
  - share/00_System/60_Notes/    (recursive)
  - share/00_System/10_Config/profiles/
debounce: 400ms per topic
emit "share-changed" → frontend with payload { topic, path }
```

### 14.2 Mac 구현 권장

`FSEvents` API 또는 Swift의 `DispatchSource.makeFileSystemObjectSource`. 동일한 watch_paths 셋 + 동일 topic 분류:

| 경로 패턴 | topic |
|---|---|
| `.../10_Exchange/...` | `transfers` |
| `.../70_Clipboard/...` | `clipboard` |
| `.../60_Notes/...` | `notes` |
| `.../profiles/...` | `profiles` |

### 14.3 이벤트 페이로드

```json
{"topic": "transfers", "path": "/Volumes/Mac-Window_Share/10_Exchange/20_Windows_to_Mac/20_Ready/30_Documents/2026-05-21__documents__foo__v01.txt"}
```

### 14.4 프론트엔드 처리

| topic | 해야할 행동 |
|---|---|
| `transfers` | 받기/보낸 것/받은 기록 전체 카운트 + 항목 리스트 새로고침 |
| `clipboard` | 클립보드 타임라인 새로고침 (현재 패널 보고있는 경우만 즉시 그림) |
| `notes` | 메모 리스트 새로고침 (현재 편집 중 메모는 본인이 저장 중이라면 충돌 주의 — 13초 cooldown 권장) |
| `profiles` | 설정 패널 보고있을 때만 게시된 프로필 리스트 새로고침 |

### 14.5 디바운스

토픽당 400ms. 한 번의 사용자 액션(예: shareguard send) 이 여러 파일을 동시에 만들 수 있어서 (manifest + checksum + log + 본체 = 4개) 한 번에 묶음. Mac 측도 동일 디바운스 권장.

### 14.6 SMB 마운트에서의 한계

- **Windows 측**: 셰어가 로컬 NTFS — `ReadDirectoryChangesW` 정상 동작. Mac이 SMB로 write 해도 NTFS 레벨에서 이벤트 잡힘.
- **Mac 측**: 셰어가 SMB mount — `FSEvents` 가 SMB 마운트에서 동작 안 할 수 있음 (Apple 문서 참고). 대안: `kqueue`, 또는 그래도 안 되면 5~10초 폴링 fallback.

Mac 측에서 watcher 신뢰성이 떨어진다면 폴링 fallback으로 자동 전환 권장 (실패 감지 + 운영자에게 한 줄 노티).

### 14.7 Mac 측 구현 체크리스트 (watcher)

- [ ] 4개 watch 경로 등록
- [ ] 토픽별 400ms 디바운스
- [ ] `share-changed` 이벤트 emit (Tauri 또는 Mac native IPC, frontend가 받을 수 있게)
- [ ] SMB watcher 동작 안 할 시 폴링 fallback (간격 5~10초)

---

## 15. 자동 갱신 정책 종합

| 시그널 | 대응 | 주기 |
|---|---|---|
| 다른 호스트가 셰어에 파일 추가/수정/삭제 | watcher 이벤트 → 토픽별 갱신 | 이벤트 즉시 (≤400ms 디바운스) |
| 자기 OS 클립보드 변경 | 폴러 → 자기 history jsonl append | 1.5초 |
| watcher 실패 (SMB 등) | 30초 fallback 폴링 (silent) | 30s |
| 사용자가 새로고침 버튼 누름 | refreshAll() | 즉시 |

폴링 첫번째 옵션 아님. Watcher 가 메인 메커니즘.

---

## 16. 무결성 검증 & transfer_id (v0.2)

### 16.1 list_transfers → transfer_id

`list_transfers(direction, state)` 진입 시 해당 direction의 `30_Manifests/<dir>/`를 1회 스캔해 **`destination.primary_file` → `transfer_id`** 인덱스를 만든 뒤, 각 항목의 파일명(`name`)으로 lookup 해 `TransferItem.transfer_id`(Option)를 채운다. 매니페스트 없으면 None.

### 16.2 verify_transfer(transfer_id) → VerifyResult

```json
{
  "transfer_id": "...", "direction": "mac_to_windows", "mode": "file|directory|batch",
  "ok": true, "checked": 5, "mismatches": 0, "missing": 0,
  "files": [{ "path": "...", "expected": "<sha>", "actual": "<sha>", "ok": true, "error": null }]
}
```
- `30_Manifests/<dir>/<id>.json` 양방향 탐색 → 읽기.
- 각 `files[]` 엔트리: `abs = share_root / destination.share_path / entry.path`.
- `abs`가 **파일** → SHA-256 재계산. **디렉터리** → §4.4 dir-hash 재계산. → `entry.sha256`와 비교.
- `ok = mismatches==0 && missing==0`. 누락은 `missing`, 불일치는 `mismatches`.

### 16.3 §4.4 dir-hash — 양쪽 바이트 단위 일치 필수 ⚠️

cross-host 검증이 false-mismatch 안 나려면 **반드시** 동일:
1. 파일만 (디렉터리 skip)
2. **숨김 파일 skip** — rel 경로의 어느 component든 `.`로 시작하면 제외 (`.git/`, `.DS_Store`)
3. rel 경로: `\` → `/` 치환 후 **NFC 정규화** (한글 NFD↔NFC)
4. rel 기준 lexicographic 정렬
5. `combined = SHA256( Σ rel.bytes + 0x00 + file_sha.bytes + 0x0A )`

Windows는 `unicode-normalization` crate `.nfc()` 사용. **검증됨**: Mac이 쓴 batch 매니페스트의 폴더 dir-hash(`3af8b4...`)와 Windows 재계산값 일치 (2026-05-22).

### 16.4 frontend

DetailsModal: `transfer_id` 있으면 **`🔍 검증`** 버튼 노출 → `verify_transfer` → 결과 카드. ok→`✓ 무결성 OK (N개)`, !ok→불일치/누락 파일 최대 5개.

---

## 17. 로그 허브 + 수신 자동검증 + 이미지 압축 보관 (v0.3, Windows 구현)

### 17.1 `00_System/80_Logs/` 신규 폴더

```
00_System/80_Logs/
├── send.jsonl              ← 송신 로그 (send_ok / send_fail)
├── recv.jsonl              ← 수신 로그 (verify_ok)
├── error.jsonl             ← 오류 로그 (send_fail / verify_fail / verify_error)
├── worklog.jsonl           ← 작업 로그 (어시스턴트가 개선/수정 시 append)
├── verify/<transfer_id>.json   ← 검증 결과 캐시 (배지용)
└── compressed-images/<sha>.jpg ← 30일 경과 후 압축 보관된 클립보드 이미지
```

JSONL 공통: `{ ts, host, os, event, ... }`. `send_ok`(source/category/transfer_id), `send_fail`(stderr/exit), `verify_ok`(transfer_id/checked/direction), `verify_fail`(mismatches/missing). worklog: `{ summary, detail }`.

### 17.2 수신 시 자동 무결성 검증

- `integrity.auto_verify_on_receive`(기본 true): watcher `transfers` 이벤트 + 앱 시작 시 `auto_verify_pending` 실행.
- `auto_verify_pending`: verify 캐시 없는 `mac→windows` 매니페스트만 검증 → `verify/<tid>.json` 캐시 + recv/error 로그.
- `list_transfers`가 `verify_status`("ok"|"mismatch"|null)를 캐시에서 채움 → 항목에 ✓/✗ 배지.
- 수동 🔍 버튼은 `integrity.show_manual_button`(기본 true)로 표시/숨김.
- **각 OS 역할**: 송신 시 매니페스트+SHA baseline 작성, 수신 시 재계산 검증. Windows는 mac→win 수신 검증; Mac은 win→mac 수신 검증해야 대칭.

### 17.3 이미지 압축 보관 (삭제 대신)

`policy.json`→`clipboard`: `image_retention_action`("compress"|"delete"), `compress_quality`(60), `compress_max_dimension`(1280). 30일 경과 PNG → compress면 JPEG로 다운스케일하여 `80_Logs/compressed-images/`로 이동 후 원본 삭제.

### 17.4 사이드바 "로그" 허브

`받은 기록` 제거 → 접이식 **로그** 그룹(기본 닫힘): 송신/수신/오류/압축이미지/작업로그 5개. 압축이미지는 그리드 썸네일, 나머지는 시간순 리스트.

### 17.6 송신 시 HTML 의존성 사전 검사

단일 `.html`을 보낼 때 외부 로컬 에셋(CSS/JS/이미지)에 의존하면, 그 파일만 보내봐야 **디자인이 깨진 채 도착**(SHA는 정상, 에셋이 안 따라옴). 우리 네이밍 규칙이 형제 파일을 리네임해서 단순 추가 전송도 `href` 링크가 안 맞음.

- `inspect_html_assets(path) -> { is_html, has_inline_style, parent_dir, assets:[{reference, kind, exists}] }`: html을 스캔해 `href=`/`src=`/`url()`의 **로컬 상대경로** 참조만 수집 (절대 URL/data:/앵커 제외).
- 송신 직전 게이트: 참조가 있으면 모달로 경고 + 3선택: **폴더째 보내기**(html 경로를 부모 폴더로 치환 → 디렉터리 전송, 내부 파일명 보존돼 링크 유지) / **파일만 보내기** / **취소**.
- **검증됨** (2026-05-22): 깨진 계약서 html에서 `contract.css → MISSING` 정확 검출, 인라인 스타일 없음 인지.

### 17.5 Mac 체크리스트 (v0.3)

- [ ] `80_Logs/` 동일 구조 + verify 캐시 + compressed-images
- [ ] win→mac 수신 자동검증 + 배지 + settings 토글 2종
- [ ] 이미지 retention action=compress (JPEG)
- [ ] 사이드바 로그 허브(기본 닫힘) 5개
- [ ] 송신 시 HTML 의존성 검사 + 폴더째/파일만/취소 게이트 (§17.6)

---

## 18. Git 상태 대시보드 (3-way repo sync) — 단계별, Windows 선구현

직결망으로 두 머신의 git 레포 상태(원격 / Mac-로컬 / Win-로컬)를 비교해 머지충돌·잘못된 상태 작업을 사전 발견하는 대시보드. v1 = 니즈 1~6, 이후 7(머지충돌 예측)·8(룰베이스 복구)은 고도화.

### 18.1 셰어 디렉터리 + 스냅샷 (Stage 1)
```
00_System/90_Git/<sanitized-host>.git-status.json
```
각 OS가 자기 로컬 레포를 스캔해 게시 (프로필 게시 패턴과 동일). 스키마:
```json
{ "schema_version":1, "host":"DESKTOP-Q0S7LSQ", "os":"windows", "scanned_at":"RFC3339",
  "repos":[{
    "owner_repo":"papa-channy/Mac-Windows-P2P",  // origin URL → owner/repo 정규화 (없으면 null)
    "path":"D:\\dev\\Mac-Windows-P2P", "branch":"main", "head":"<sha40>",
    "upstream":"origin/main",            // 없으면 null
    "dirty":0, "dirty_files":[],         // git status --porcelain 라인
    "unpushed":0, "ahead":0, "behind":0, // rev-list --left-right --count @{u}...HEAD
    "stash":0, "remote_url":"https://github.com/...",
    "last_commit":{"sha","msg","date"} }] }
```
- **스캔**: 전체 디스크 walk(시스템/`node_modules`/`target`/`.git` 등 제외, 설정 `git.exclude_dirs`), `.git` 보유 폴더 = 레포. 각 레포는 `git -C` 셸아웃으로 위 필드 추출.
- **게시 토큰 금지**: 스냅샷엔 메타데이터만. 자격증명은 키체인만(§18.3).
- **watcher**: `90_Git` 변경 시 `share-changed` 토픽 `"git"` emit.
- **Mac 미러**: `<mac-host>.git-status.json` 동일 스키마로 게시. `os:"macos"`. 드라이브 walk 대신 `~`(+추가 루트) walk.

### 18.2 대시보드 (Stage 1: 2-way 로컬 → Stage 3: 3-way)
`owner_repo` 기준 양쪽 스냅샷 병합. 레포별로 호스트 행(OS배지·브랜치·HEAD·dirty/미푸시/뒤처짐 플래그). HEAD가 호스트마다 다르거나 dirty/미푸시 있으면 "⚠ 불일치", 전부 같고 깨끗하면 "✓ 동기화됨". Stage 3에서 원격 컬럼 추가.

### 18.3 자격증명 (Stage 2) — PAT + SSH, **OS 키체인 전용**
- **PAT**(fine-grained, 읽기전용): GitHub API(레포목록/PR/원격브랜치/compare). Windows=Credential Manager, Mac=Keychain (`keyring` crate, service `mac-window-git`). settings.json·셰어에 절대 미저장.
- **SSH 키**(ed25519): `git fetch`로 원격 객체 확보(정밀 ahead/behind, 후일 머지예측). 공개키는 사용자가 GitHub에 등록.
- Settings에 "Git" 섹션: PAT 입력(마스킹)+검증(`GET /user`), SSH 공개키 표시.

### 18.4 원격 인지 (Stage 3)
`GET /user/repos`(owner+org) 레포목록 → 로컬 클론과 `owner_repo` 매칭. `GET /repos/{o}/{r}/branches`,`/pulls`. 푸시된 SHA는 `compare` API로 정확 ahead/behind. **미푸시 커밋은 origin에 없어 Mac↔Win 정밀 diff 불가 → "발산 위험(미푸시 N)"으로만 표기.**

### 18.5 직결 트리거 (Stage 4)
백그라운드 reachability 폴러(peer TCP 445/share 경로). down→up 전이 시 자기 스냅샷 증분 재게시(mtime 변경 + 원격 SHA 변경 레포만) + `"git"` 토픽. 각 OS self-refresh.

### 18.6 Mac 체크리스트
- [ ] `90_Git/<host>.git-status.json` 동일 스키마 게시 (`os:"macos"`)
- [ ] 로컬 스캔(~ + 추가 루트), git CLI 메타데이터
- [ ] PAT/SSH 키체인 등록 UI + API(레포목록/PR/compare)
- [ ] 직결 up 트리거 폴러 + 증분 재게시

---

## 부록 B — 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-17 | 초안. Windows 측 phase-1 shim 완료 기준. |
| 2026-05-17 | 멀티파일 → `unclassified` 자동분류 추가. |
| 2026-05-20 | v2 contract: 공유 정책 (policy.json), 언어 프리셋, 호스트 프로필, 닫힘/열림 네트워크 시크릿 정책, line-ending annotation 추가. |
| 2026-05-21 | §12 공유 메모, §13 클립보드 자동기록 모델, §14 파일 watcher, §15 자동 갱신 정책 추가. |
| 2026-05-22 | §13.9 이미지 스키마 v2 정렬(size_bytes/content/len), §16 verify_transfer + transfer_id + dir-hash 호환 계약 추가. Windows v0.2 parity 완료. |
| 2026-05-22 | §17 로그 허브(80_Logs), 수신 자동검증 + ✓/✗ 배지 + integrity 설정, 이미지 압축 보관(compress action), 클립보드 썸네일 깜빡임 수정. Windows v0.3. |
| 2026-05-23 | §18 Git 상태 대시보드 계약 추가 (Stage1: 90_Git 스냅샷 + 로컬 스캔 + 2-way 대시보드, Windows 선구현). 사이드바 영어화(In/Out/카테고리/Notes/Refresh 등). |
