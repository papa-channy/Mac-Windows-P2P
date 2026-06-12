# Mac → Windows Parity 핸드오프 (MED backlog)

> `PARITY_MATRIX.md §4` 의 **Windows ← Mac (MED) 3건**. HIGH(G1/G2/G3)는
> 전부 완료됐고(`fd41e3f`), 이제 MED 가 남았다. 이 커밋을 pull 한 뒤 이 문서 +
> 커밋 메시지만으로 작업 가능. wire format(check-run summary, manifest)은 이미
> 동일하므로 명령/모듈만 추가하면 된다.
>
> Windows = 단일 `src-tauri/src/commands.rs` + `src/app.js`.

---

## 작업 목록 (권장 순서: M3 → M5 → M4)

| # | 항목 | Mac 식별자 | 난이도 | 의존 |
|---|---|---|---|---|
| **M3** | `send_path_force` (덮어쓰기 송신) | D-8-b | 하 | 기존 send 엔진 재사용 |
| **M5** | `github_fetch_check_runs` (CI overlay) | F-6 / L-12 | 중 | 기존 GitHub PAT(G2 완료) |
| **M4** | notify dispatch (native + webhook) | H-2/3/4 / K-4-h | 중 | settings 확장 |

---

## M3. send_path_force — 덮어쓰기 송신 (난이도 하)

대상 파일이 셰어에 이미 있을 때 **덮어쓰기**로 강제 전송하는 경로. Mac 은
`send_path`(거부) ↔ `send_path_force`(overwrite) 두 명령으로 분리.

### Mac 구현 (참조)
`mac_gui/.../commands.rs:212-262` — `send_path` 와 동일하되
`build_request(.., overwrite=true)`:
```rust
let req = transfer::engine::build_request(
    PathBuf::from(&source_path), &category,
    Direction::MacToWindows, 1, /*overwrite=*/ true,
)?;
// 이후 send + log_hub append(forced:true) + notify(SendOk/SendFail)
```

### Windows 적용
- Windows `send_path` 는 PowerShell(`send-to-mac.ps1`)에 위임 중. 그 스크립트는
  이미 `-Force`/overwrite 인자를 받는지 확인 — 받으면 `send_path_force` 는
  같은 스크립트를 `-Force` 와 함께 호출하는 얇은 래퍼.
- 없으면 `send-to-mac.ps1` 에 overwrite 분기 추가(목적지 존재 시 덮어쓰기) +
  `commands.rs` 에 `send_path_force(source_path, category)` 명령(= send_path 와
  동일 흐름 + force 플래그) 추가 + Tauri 등록.
- 프론트(`app.js`): 송신 결과가 "목적지 존재"일 때 사용자에게 "덮어쓰기"
  확인 → `invoke('send_path_force', ...)`. (Mac 은 DestinationExists 신호 →
  overwrite 모달.)

### 완료 기준
- [ ] 셰어에 같은 이름 파일이 있을 때 일반 송신은 거부/확인, force 는 덮어씀
- [ ] manifest/checksum 결과는 일반 송신과 동일 (wire 동일)

---

## M5. github_fetch_check_runs — CI 상태 오버레이 (난이도 중)

커밋별 GitHub Actions check-run 상태를 가져와 Git 대시보드에 ✓/✗/⏳ 오버레이.
G2 로 PAT 가 이미 양쪽에 있으니 토큰은 그대로 사용.

### wire (이미 동일해야 함)
`CheckRunSummary`: `total / success / failure / in_progress / neutral /
overall("success"|"failure"|"pending"|"neutral"|"none"|"error") / html_url`.
Mac `git.rs:1102-1112`, `api.ts:519`.

### Mac 구현 (참조 — 거의 복붙)
`git.rs:1114-1191`:
```rust
fn classify_check_runs(runs: &serde_json::Value) -> CheckRunSummary {
    // check_runs[] 순회:
    //   status != "completed"            → in_progress++
    //   conclusion == "success"          → success++
    //   failure|timed_out|action_required|startup_failure → failure++
    //   neutral|skipped|stale|cancelled|기타 → neutral++
    // overall 우선순위: failure>0 → "failure"
    //   else in_progress>0 → "pending" / success>0 → "success" / else "neutral"
    // html_url = 첫 run 의 html_url
}

#[tauri::command]
pub fn github_fetch_check_runs(owner_repo: String, shas: Vec<String>)
    -> Result<HashMap<String, CheckRunSummary>, String>
{
    let token = get_token().ok_or("등록된 토큰이 없습니다")?;
    // 각 sha: GET https://api.github.com/repos/{owner_repo}/commits/{sha}/check-runs?per_page=20
    //   Ok → classify, Err → overall="error" (배치 전체 실패 안 시킴)
}
```

### Windows 적용
1. `CheckRunSummary` 구조체(이미 있으면 재사용) + `classify_check_runs` +
   `github_fetch_check_runs` 를 `commands.rs` 로 포팅. `gh_get` 헬퍼(G2 에서 PAT
   fetch 에 이미 사용 중)를 그대로 쓴다.
2. Tauri 등록: `github_fetch_check_runs`.
3. 프론트(`app.js`): L3 inspector(또는 Sync Timeline)의 remote 커밋 dot 위에
   `overall` 색으로 배지 — 성공 녹 / 실패 빨강 / pending 호박 / neutral 회색.
   Mac `GitInspectorModal` 의 `CheckRunBadge`(F-10-b) 참조.

### 완료 기준
- [ ] PAT 등록된 repo + CI 있는 커밋 → 배지 색이 실제 Actions 결과와 일치
- [ ] 404/403 커밋은 배지 없이 bare dot (배치 실패 없음)

---

## M4. notify dispatch — native 알림 + webhook (난이도 중)

전송/검증 성공·실패를 **OS 네이티브 알림 + Slack/Discord webhook** 으로
fan-out. Windows 에는 동등물이 없다.

### Mac 구현 (참조)
`mac_gui/.../notify.rs` 전체:
- `NotifyEvent` enum: `SendOk / SendFail / VerifyOk / VerifyFail / Clipboard`
- `dispatch(app, ev, title, body)`:
  1. settings 읽기 → `allowed(settings.notifications, ev)` (이벤트별 토글)
  2. `settings.notifications.native` → `app.notification().builder()...show()`
  3. `webhook_url` 있으면 별도 thread 로 `post_webhook` (Slack 호환 JSON:
     `{"text":"*{title}*\n{body}","username":"share-manager"}`)
- `NotificationSettings` (settings 의 한 섹션): `enabled / native / webhook_url /
  on_send_ok / on_send_fail / on_verify_ok / on_verify_fail / on_clipboard`

호출 site: `send_path` / `send_path_force` / `auto_verify_pending` 등에서
`notify::dispatch(&app, NotifyEvent::SendOk, title, body)`.

### Windows 적용
1. **crate**: `tauri-plugin-notification`(이미 있는지 확인 — 없으면 추가) +
   webhook 은 `ureq`(G2 에서 age/http 쓰며 이미 있을 수 있음) 또는 `reqwest`.
2. **NotificationSettings** 를 Windows `share.rs` 의 `Settings` 에 `#[serde(default)]`
   섹션으로 추가(Mac 과 동일 필드명 — settings.json 은 로컬 전용이라 cross-host
   동기화 대상은 아니지만, 같은 이름이어야 UI/코드 정합).
3. `notify` 모듈(또는 commands.rs 내 함수): `NotifyEvent` + `dispatch` +
   `post_webhook` 포팅. native 는 Windows 토스트(plugin), webhook payload 는
   **Slack 호환 동일 형식**(wire 동일).
4. 호출 site: Windows 송신/검증 완료 지점에서 `dispatch(...)` 호출.
5. 프론트(`app.js`): 설정 화면에 알림 섹션(활성화 / 네이티브 / webhook URL /
   이벤트별 토글) — Mac `NotificationSection`(G-8-g) 참조. "테스트 알림" 버튼.

### 완료 기준
- [ ] 설정 토글대로 native 토스트 표시 (SendOk 등)
- [ ] Slack incoming webhook URL 설정 시 `*제목*\n본문` 메시지 도착
- [ ] 이벤트별 토글 OFF 시 해당 이벤트 알림 안 옴

---

## 식별자 ↔ Windows 위치
| Mac 식별자 | Mac 위치 | Windows 적용 |
|---|---|---|
| D-8-b send_path_force | `commands.rs:212` | `commands.rs` (M3) |
| F-6 / L-12 check-runs | `git.rs:1102-1191` | `commands.rs` (M5) |
| H-2/3/4 notify dispatch | `notify.rs` | `commands.rs`/`notify` (M4) |
| K-4-h NotificationSettings | `share.rs:212` | `share.rs` (M4) |

검증: `cargo test` + 각 완료 기준. 끝나면 `PARITY_MATRIX.md §4` MED 행을 ✅ 로
옮기고 Mac `IMPL_STATUS.md` cross-OS 동기화.

## TL;DR
- **M3** send_path_force = send 엔진 force 플래그 래퍼 (하)
- **M5** check-runs = `git.rs:1114-1191` 거의 복붙 + L3 배지 (중)
- **M4** notify = `notify.rs` 포팅(native+webhook) + settings 섹션 + UI (중)

남은 건 LOW/조건부(read_file_preview, 클립보드 오프라인 캐시)뿐 — MED 끝나면
양쪽 기능 표면이 사실상 대칭이 된다.
