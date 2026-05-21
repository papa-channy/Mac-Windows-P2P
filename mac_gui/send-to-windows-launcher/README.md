# SendToWindowsLauncher

Mac의 Finder 우클릭 → Services → "Windows로 보내기" 메뉴를 제공하는 소형
Swift 앱. 자체 UI는 없고, 선택된 파일/폴더 경로를 모아서
`share-manager --send <path>` 형식으로 Tauri 본체 (`share-manager.app`) 에
넘기는 게 전부.

Windows 쪽의 `launcher.vbs + wscript` 패턴과 동일한 역할 — 터미널/콘솔 깜빡임
없이 헤드리스로 메인 GUI 를 띄운다.

## 빌드 / 설치

```sh
sh scripts/install.sh             # 빌드 + ~/Applications 설치 + Services 갱신
sh scripts/install.sh --uninstall # 제거
```

설치 후 macOS 시스템 설정 → 키보드 → 키보드 단축키 → Services → "파일 및
폴더" 카테고리에서 **"Windows로 보내기"** 체크.

## 동작

1. Finder 우클릭 → Services → "Windows로 보내기"
2. macOS 가 `NSServicesProvider.handleSendService` 콜백 호출
3. NSPasteboard 에서 `file-url` 들 읽음
4. `share-manager` 실행파일 위치 탐색 (우선순위):
   - `$SHARE_MANAGER_BIN` (테스트용 override)
   - `/Applications/share-manager.app/Contents/MacOS/share-manager`
   - `~/Applications/share-manager.app/Contents/MacOS/share-manager`
   - `PATH` 에서 `share-manager`
5. `share-manager --send <path1> --send <path2> …` 로 spawn 후 즉시 종료

## CLI 모드 (개발용)

```sh
SendToWindowsLauncher.app/Contents/MacOS/SendToWindowsLauncher /path/to/file.txt
```

CLI 인자로 파일 경로를 받으면 Services 등록 절차 없이 바로 Tauri 본체를
spawn 한다.
