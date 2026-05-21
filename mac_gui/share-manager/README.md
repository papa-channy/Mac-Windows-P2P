# share-manager (Mac)

Mac 측 GUI. Windows 측 `windows_gui/share-manager/` 의 Tauri v2 구조와 동일하게
짜여 있으며, 프론트엔드만 React/Vite 기반이라는 차이가 있다. 양쪽 백엔드는 같은
manifest / sidecar / log 포맷을 생산하므로, 어느 한 쪽에서 만든 전송 산출물이
다른 쪽에서 그대로 검증된다.

원본 reference 는 `sample/send_to_windows/` (Swift). TransferCore 로직은
`src-tauri/src/transfer/` 로 1:1 포팅됐다 — 16개 unit test 가 SHA-256/네이밍/
RAW_SECRET/manifest sorted-key 직렬화를 핀 박아둠.

## 디렉터리

```
share-manager/
├── package.json            ← React + Vite + Tauri CLI 의존성
├── vite.config.ts          ← Tauri dev URL (5173) + safari14 target
├── tsconfig.json
├── index.html
├── src/                    ← React SPA
│   ├── main.tsx
│   ├── App.tsx
│   ├── lib/api.ts          ← invoke() wrapper, 백엔드 contract
│   ├── components/
│   ├── views/              ← Transfers / Notes / Clipboard / Settings
│   └── styles/global.css
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    ├── icons/              (Windows 측 아이콘 임시 재사용; 추후 Mac 전용으로)
    └── src/
        ├── main.rs / lib.rs
        ├── commands.rs     ← Tauri command surface
        ├── share.rs        ← Direction/State/Category — Windows 와 동일
        ├── transfer/       ← Swift TransferCore 포트
        ├── mount.rs        ← ShareMount.swift 포트
        ├── policy.rs       ← policy.json / 프로필 / 언어 감지
        ├── notes.rs        ← 60_Notes
        ├── clipboard.rs    ← 70_Clipboard (NSPasteboard 1.5s polling)
        └── watcher.rs      ← FSEvents + SMB polling fallback (§14.6)
```

## 개발

```sh
# 의존성 (한 번)
npm install
cargo install tauri-cli --version '^2'

# 개발 (Vite + Tauri 동시) — ad-hoc 서명, Hardened Runtime 안 켜짐
cargo tauri dev

# 단위 테스트 (TransferCore)
(cd src-tauri && cargo test)

# 로컬 release 빌드 (서명 없음) — 깜빡 ad-hoc 으로 떨어짐
cargo tauri build --bundles app
```

## 배포 (Developer ID + Notarization)

`mac_gui/scripts/` 에 정식 배포 파이프라인이 들어 있어. 한 줄 요약:

```sh
sh mac_gui/scripts/setup-notary.sh   # 한 번만 — app-specific password 등록
sh mac_gui/scripts/release.sh        # 전체 빌드 → 서명 → DMG → 노타라이즈 → staple
# 결과: mac_gui/dist/mac-window-share-<버전>.dmg
```

자세한 흐름은 `mac_gui/scripts/` 의 각 스크립트 헤더 주석 참조.

## 호출 진입점

- **GUI 직접 실행**: `~/Applications/share-manager.app` 더블클릭 → React UI
- **우클릭 송신**: Finder 우클릭 → Services → "Windows로 보내기" → Swift
  `SendToWindowsLauncher.app` 이 선택된 파일 경로들을 모아서
  `share-manager --send <path> [--send <path> ...]` 로 spawn → React 가
  `send-request` 이벤트 받아 다이얼로그 표시

## 비-구현 (다음 단계)

- Send 다이얼로그 (현재 React 측 views 미구현 — Sidebar/Transfers/Notes/Clipboard/Settings 만 스켈레톤)
- Drag-drop 송신 (Phase 3 batch)
- Sent view (sent.jsonl 파일은 `transfer::sent_history` 가 이미 채움)
- 다크 테마 토큰 외 디자인 시스템 마무리

## Windows 측과의 contract

- 카테고리 키 / 폴더 매핑 — `src-tauri/src/share.rs::CATEGORIES` (단일 source)
- Manifest 직렬화: `serde_json` + BTreeMap (sorted keys) + pretty
- Checksum: `"<hex>  <name>\n"` 두 칸 공백 + LF
- dir-hash: lex-정렬 + `"<rel>\0<sha>\n"` concat → SHA-256

변경 시 양쪽 동시 합의가 필요. `mac_gui/WINDOWS_PARITY_BRIEF.md` 참조.
