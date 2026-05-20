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

## 부록 B — 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-17 | 초안. Windows 측 phase-1 shim 완료 기준. |
| 2026-05-17 | 멀티파일 → `unclassified` 자동분류 추가. |
| 2026-05-20 | v2 contract: 공유 정책 (policy.json), 언어 프리셋, 호스트 프로필, 닫힘/열림 네트워크 시크릿 정책, line-ending annotation 추가. |
