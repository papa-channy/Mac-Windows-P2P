# Mac → Windows Parity 핸드오프 (NAMING backlog)

> Mac 이 v0.3.7(`e77fd97`)에서 **송신 파일 리네임을 제거**했다 — Windows 로
> 보낸 파일이 `2026-09-01__documents__이름__v01.zip` 이 아니라 **원본 이름
> 그대로** 도착한다. 배경: 수신자가 원본 파일명으로 검색해서 "파일을 찾을 수
> 없다"고 혼동한 실사례(2026-09-01, AI-Studio zip). Windows→Mac 방향도 같은
> 이유로 정렬이 필요하다.
>
> 이 커밋을 pull 한 뒤 이 문서 + Mac 참조 커밋만으로 작업 가능.

---

## 작업 목록 (권장 순서: W2 → W1 — W2가 5분짜리 선행 픽스)

| # | 항목 | 위치 | 난이도 | 의존 |
|---|---|---|---|---|
| **W2** | pwsh stdout CP949 → UTF-8 (transfer_id 깨짐) | `send-to-mac.ps1` 상단 | 하 | 없음 |
| **W1** | 송신 파일명 원본 유지 (리네임 제거) | `send-to-mac.ps1:148` | 하 | 없음 |

---

## W2. pwsh stdout 인코딩 — 한글 transfer_id 깨짐 (난이도 하)

### 증상 (실측)
`00_System/80_Logs/send.jsonl` 2026-09-01T18:40 항목:

```json
"transfer_id": "2026-09-01T184023+0900__windows__mac__data__����Ʈ����_��ü��_����_�丣�ҳ�x��ǥ__v01"
```

한글 파일명(`소프트웨어_평가체계_...xlsx`)을 보냈을 때 transfer_id 가 깨져
기록됐다. `source` 필드는 멀쩡한 것에 주목 — Rust 가 받은 인자는 정상이고,
**pwsh 의 stdout 만** 깨진다.

### 원인
`commands.rs` `send_path`/`send_path_force` 가 `send-to-mac.ps1` 의 stdout 을
`String::from_utf8_lossy` 로 읽는데(`commands.rs:365` 부근), Windows
PowerShell 콘솔 출력은 기본 CP949 다. 한글이 lossy 변환에서 �� 로 깨진 채
`transfer_id` 로 파싱되어 send.jsonl/알림/GUI 에 그대로 퍼진다.

### 적용
`send-to-mac.ps1` **최상단**(param 블록 직후)에:

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

stdout 을 파싱당하는 다른 스크립트(`mw.ps1` 등)가 있으면 동일 적용.

### 완료 기준
- [ ] 한글 파일명 송신 후 send.jsonl 의 `transfer_id` 가 한글 그대로 기록
- [ ] GUI 송신 완료 토스트/이력에도 한글 정상 표시

---

## W1. 송신 파일명 원본 유지 — 리네임 제거 (난이도 하)

### Mac 구현 (참조 — v0.3.7 `e77fd97`)
`mac_gui/share-manager/src-tauri/src/transfer/engine.rs` (2) Naming 단계:

```rust
// 변경 전: naming::render(...) → "<YYYY-MM-DD>__<category>__<base>__v01<ext>"
// 변경 후: 원본 파일명 (NFC 정규화만)
let (base, ext) = naming::split(&top_name, is_dir);
let final_name = format!("{base}{ext}");
```

**바꾸지 않은 것** (wire 호환의 핵심):
- `transfer_id` — 기존 `<ts>__<src>__<dst>__<category>__<base>__v01` 유지
- 매니페스트/체크섬/로그 **사이드카 파일명** — 기존 `<transfer_id>.json` 등 유지
- 매니페스트 `destination.primary_file` / `files[].path` — **실제(원본) 파일명**
  기록. 양쪽 GUI 모두 이름 파싱이 아니라 manifest `primary_file` 매칭이므로
  이것만 맞으면 verify/목록이 무수정 동작

### Windows 적용
`send-to-mac.ps1:148`:

```powershell
# 변경 전
$newName  = "${date}__${category}__${baseName}__v01${ext}"
# 변경 후
$newName  = "${baseName}${ext}"
```

- `$date`/`$category` 변수는 transfer_id(`:198`)·매니페스트에서 계속 쓰므로
  삭제하지 말 것
- 매니페스트의 `destination.primary_file`/`files[].path` 가 `$newName` 을
  쓰는지 확인 (쓰고 있으면 자동으로 원본명이 됨)
- 충돌 처리는 기존 그대로: Test-Path → GUI 확인 / `-Force` 덮어쓰기
  (리네임 제거로 날짜가 달라도 같은 이름이면 충돌하게 됨 — 의도된 동작,
  Mac 과 동일)
- NFC: Windows 파일명은 이미 NFC 라 별도 정규화 불필요 (Mac 은 NFD 소스
  때문에 명시 정규화가 필요했던 것)

### 완료 기준
- [ ] Windows→Mac 송신 파일이 셰어에 원본 이름 그대로 도착
- [ ] Mac GUI 수신 목록에서 항목 표시 + verify ✓ (manifest primary_file 매칭)
- [ ] 같은 이름 재송신 시 충돌 확인 → `-Force`/`send_path_force` 로 덮어쓰기
- [ ] 한글 파일명 왕복 (W2 와 함께 검증)

### 끝나면
- `PARITY_MATRIX.md` §4 NAMING 백로그 2행을 ✅ 로
- 완료 커밋 메시지에 `(W1)`/`(W2)` 식별자
