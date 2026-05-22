# SendToWindows.app

Mac → Windows 10GbE 직결 셰어로 파일을 한 번의 우클릭으로 보내는 GUI.

> 셰어 자체 (마운트 등) 운영은 `~/Library/Application Support/MacWindowShare/mw` CLI가
> 담당하고, 이 앱은 그 위에서 송신 UX만 제공한다. 시스템 전체 가이드는 셰어 안
> `00_System/00_Readme/README.md` 참고.

---

## 빌드 / 설치 / 제거

```sh
# 의존성: macOS 13+, Swift 5.10+ (Xcode 또는 CLT 둘 다 OK — IDE는 안 씀)
swift build                       # 개발 빌드
swift test                        # 단위 테스트 (목표: 100% 그린)
sh scripts/bundle-app.sh          # release 빌드 + dist/SendToWindows.app 생성
sh scripts/install.sh             # ~/Applications에 배치 + Services 등록
sh scripts/install.sh --uninstall # 제거
```

설치 후 첫 실행 안 보이면:
**시스템 설정 → 키보드 → 키보드 단축키 → 서비스 → 파일/폴더 카테고리**에서
"Windows로 보내기" 체크.

---

## 사용 (Phase 2 — 우클릭 경로)

1. Finder/ForkLift에서 파일 또는 폴더 우클릭
2. **Services → Windows로 보내기** 클릭
3. 다크 다이얼로그 등장
4. 카테고리 선택 (기본: 📄 문서)
5. **Windows로 전송** 클릭
6. 성공 다이얼로그 → 확인 → 종료

키보드: `ESC`=취소, `Enter`=전송.

도착지: `/Volumes/Mac-Window_Share/10_Exchange/10_Mac_to_Windows/20_Ready/<카테고리>/`
와 함께 manifest / sidecar / log 자동 생성.

---

## 카테고리

`Categories.swift`에 단일 source. Windows 측 §4.1과 동기화 유지.

| 키 | 한글 | 이모지 | 폴더 |
|---|---|---|---|
| documents | 문서 | 📄 | 30_Documents |
| data | 데이터 | 📊 | 20_Data |
| repos | 코드 | 💻 | 10_Repos |
| research | 리서치 | 🔬 | 40_Research |
| env | 환경설정 | ⚙ | 50_Env |
| builds | 빌드 | 🛠 | 60_Builds |
| assets | 애셋 | 🎨 | 70_Assets |
| misc | 기타 | 📦 | 90_Misc |
| **unsorted** | **미분류** | **📥** | **99_Unsorted** ← Mac 측 확장 |

`unsorted`는 Phase 3 다중 drag-drop 전송의 기본 안착지 (LLM 자동 분류 도입 전 임시).

---

## 아키텍처

```
Sources/
├ TransferCore/        ← UI 무관 순수 로직, 단위 테스트 대상 (Phase 1)
│  ├ Categories  Direction  TransferMode  TransferError  Timestamps
│  ├ Naming  RawSecret  Hashing  Manifest  Checksum  Log
│  └ Engine            ← orchestrator
└ SendToWindows/       ← GUI (Phase 2)
   ├ App.swift         ← @main, NSApplicationDelegate, Service vendor
   ├ Theme.swift       ← 컬러/타이포/레이아웃 토큰
   ├ ShareMount.swift  ← mw CLI 호출하여 마운트 보장
   └ Dialogs/
      ├ SendDialog       (전송 입력)
      ├ ResultDialog     (성공 결과)
      └ OverwriteDialog  (덮어쓰기 확인)

Tests/TransferCoreTests/   ← 79 tests (Phase 1)
Resources/Info.plist       ← .app 번들 메타 + NSServices 선언
scripts/bundle-app.sh      ← SPM → .app 번들 + ad-hoc codesign
scripts/install.sh         ← ~/Applications 설치 + Services 등록
```

---

## Phase 로드맵

- [x] **Phase 0**: SPM 스캐폴드 + Theme + Categories (8 tests)
- [x] **Phase 1**: TransferCore 순수 로직 (79 tests)
- [x] **Phase 2**: 우클릭 진입 다이얼로그 + Service 등록 (현재)
- [ ] **Phase 3**: 자체 .app 진입 — Home(3버튼) + Send(이분할 drag-drop)
- [ ] **Phase 4**: Received view (Windows→Mac 수신 트리)
- [ ] **Phase 5**: Sent view (송신 로그 트리, 로컬 jsonl 기반)
- [ ] **Phase 6**: `mw` CLI 보강 (verify / list / receive / archive)
- [ ] **Phase 7** (장기): 다중 파일 LLM 자동 분류

---

## 셰어 측 정식 위치

이 코드의 캐노니컬 source는 셰어 안:
```
{share}/00_System/20_Scripts/mac_gui/send_to_windows/
```

네트워크/셰어 단절 시 로컬 `~/Developer/send_to_windows/`에서 작업 후
복귀 시점에 셰어로 sync. (`scripts/sync-to-share.sh` 는 Phase 3에서 추가)
