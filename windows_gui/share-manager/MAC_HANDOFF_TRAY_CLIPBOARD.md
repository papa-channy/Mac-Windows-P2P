# Windows → Mac 핸드오프 (백그라운드 클립보드 상주 — 트레이 + 자동시작)

> Windows 측이 **클립보드 백그라운드 상주**를 구현했다. Mac 도 동형으로 맞춰
> "양측 앱을 띄워둬야만 실시간 클립보드 공유가 되는" 불편을 없앤다.
> 이 문서 + Windows 커밋(`windows: system tray + close-to-tray + autostart`)만
> 보고 작업 가능.

---

## 문제 (양측 공통)

클립보드 캡처는 **떠 있는 프로세스**가 OS 클립보드를 폴링해야 가능하다
(`start_clipboard_poller`). 그런데 캡처 스레드가 GUI 앱 프로세스 안에서만 돌기
때문에, 앱이 종료되면 그 호스트의 **새 복사(실시간)**가 셰어에 안 올라간다.
→ 결과적으로 "상대의 최신 클립보드를 받으려면 상대 앱이 떠 있어야" 한다.
(과거 기록은 셰어에 영구 저장돼 있어 한쪽이 꺼져도 보인다 — 실시간만 문제.)

검증된 증상(사용자): "Mac 에서 Windows 최신 클립보드를 보려면 Windows 가
실행 중이어야 하고, 반대도 동일." 새 복사만 안 되고 과거 기록은 보임.

## Windows 가 한 일 (참고 구현)

`windows_gui/share-manager/src-tauri/`:
1. `Cargo.toml`: `tauri` 에 `"tray-icon"` feature 추가 + `tauri-plugin-autostart = "2"`.
2. `src/lib.rs` (Tauri Builder):
   - autostart 플러그인 등록: `tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![]))`
   - `.setup` 에서 트레이 아이콘 빌드: 메뉴(열기/완전 종료) + 좌클릭 시 창 복원,
     그리고 `app.autolaunch().enable()` 로 로그인 자동시작 활성화.
   - `.on_window_event` 에서 `WindowEvent::CloseRequested` → `window.hide()` +
     `api.prevent_close()` (창을 닫아도 종료 안 하고 트레이로 숨김 → poller 생존).

핵심 코드(그대로 참고):
```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

tauri::Builder::default()
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
    // ...other plugins...
    .setup(|app| {
        commands::start_clipboard_poller(app.handle().clone());
        // tray
        let open_i = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
        let quit_i = MenuItem::with_id(app, "quit", "완전 종료", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
        let _tray = TrayIconBuilder::with_id("main-tray")
            .icon(app.default_window_icon().unwrap().clone())
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, e| match e.id.as_ref() {
                "open" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, e| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                    let app = tray.app_handle();
                    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                }
            })
            .build(app)?;
        let _ = app.autolaunch().enable();
        Ok(())
    })
    .on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let _ = window.hide();
            api.prevent_close();
        }
    })
```

---

## Mac 가 할 일 (macOS 특성 반영)

**중요한 차이:** macOS 는 Windows 와 달리 **창을 닫아도(빨간 버튼) 앱이
종료되지 않는다** (Dock 에 남아 프로세스 생존). 따라서 Mac 의 poller 는
창을 닫아도 이미 살아 있을 가능성이 높다. Mac 의 핵심 결손은 **앱이 완전히
꺼져 있을 때**(Cmd+Q / 미실행)이므로, 우선순위는:

### M1 (필수) — 로그인 자동시작
`tauri-plugin-autostart` (Windows 와 동일 crate, `MacosLauncher::LaunchAgent`).
`Cargo.toml` 추가 + 플러그인 등록 + `.setup` 에서 `app.autolaunch().enable()`.
→ 로그인 시 자동 실행되어 항상 떠 있게.

### M2 (권장) — 메뉴바(트레이) 상주 + 창 닫아도 유지
1. **메뉴바 아이템**: Tauri v2 `TrayIconBuilder` (macOS 는 NSStatusItem 으로
   렌더). 메뉴(열기/완전 종료) + 클릭 시 창 복원. 위 코드 그대로 이식 —
   macOS 에서도 동일 API.
2. **창 닫기 동작**: `WindowEvent::CloseRequested` → `window.hide()` +
   `api.prevent_close()`. (선택) 빨간 버튼으로 닫을 때 Dock 에서도 숨기려면
   `app.set_activation_policy(tauri::ActivationPolicy::Accessory)` 로 메뉴바
   전용(LSUIElement) 앱처럼 만들 수 있음 — 단 이러면 Dock 아이콘이 사라지므로
   "열기"는 메뉴바에서만. **권장: Dock 유지 + 메뉴바 병행** (Accessory 는 선택).
3. **Dock 클릭 재오픈**: macOS 에서 Dock 아이콘 클릭 시 창 복원은
   `RunEvent::Reopen { .. }` (tauri `app.run(|app, event| ...)`) 에서
   `get_webview_window("main").show()` 처리. (Windows single-instance 와 별개로
   macOS 고유.)

### M3 (확인) — poller 가 창과 무관하게 도는지
`clipboard.rs` 의 poller 스레드가 앱 프로세스 생존 동안 계속 도는지 확인
(Windows 는 `std::thread::spawn` 으로 독립 — Mac 도 동형이면 OK). 창 hide 시
일시정지 로직이 없어야 한다.

---

## 검증
- [ ] 로그인 후 Mac 앱이 자동 실행되어 메뉴바/Dock 에 상주 (M1)
- [ ] 창을 닫아도 앱이 종료되지 않고 클립보드 poller 가 계속 동작 (M2/M3)
- [ ] Mac 창을 닫은 상태에서 Mac 에서 복사 → Windows 에 실시간 반영
- [ ] 메뉴바/Dock 에서 창 재오픈 가능, "완전 종료"로 종료 가능
- [ ] 양측 모두: 창을 띄워두지 않아도 (백그라운드 상주만으로) 실시간 클립보드 공유

## 식별자
| | Windows | Mac |
|---|---|---|
| 자동시작 | `tauri-plugin-autostart` + `autolaunch().enable()` | 동일 crate (M1) |
| 백그라운드 상주 | 트레이 + CloseRequested→hide | 메뉴바 + (macOS 는 창닫기로도 생존) (M2) |
| 재오픈 | 트레이 좌클릭 / 메뉴 "열기" | 메뉴바 + Dock Reopen 이벤트 (M2) |

끝나면 `PARITY_MATRIX.md` 에 "클립보드 백그라운드 상주" 행 추가하고 양측 ✅.
