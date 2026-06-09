# Mac ↔ Windows Parity Matrix

> 두 시스템의 통합이 기본 전제. **OS별 코드는 달라도 "방식"(데이터 contract /
> 동작 흐름 / 사용자 경험)이 동일해야** 통합이 작동하고 관측성이 높다.
> 이 문서는 전 도메인을 양쪽 대조한 결과로, 무엇이 동일하고(✅) / OS차이로
> 정당히 다르고(◑) / 비의도적으로 어긋났는지(❌)를 한 표에서 추적한다.
>
> 대조 일자: 2026-06-09 · Mac v0.3.4 / Windows (commands.rs 단일 + app.js)

## 0. 한눈에

| 계층 | 판정 |
|---|---|
| **Wire format** (manifest / checksum / naming / dir-hash / 노트 / 클립보드 / git 문서) | ✅ **byte-identical** — 통합의 핵심. 양쪽이 서로의 산출물을 읽고 검증 가능 |
| **동작 방식** | 대체로 동일. minor drift 1건 (클립보드 폴링 분기) |
| **기능 표면** | **비대칭 존재** — 한쪽에만 있는 명령/기능 다수 (양방향 backport 필요) |
| **UI 방식** | 클립보드 2컬럼·노트는 동일. git 대시보드는 양쪽이 서로 앞선 부분 있음 |

→ **통합 자체는 깨지지 않는다** (wire 완벽). 격차는 "한쪽에만 있는 기능"이며,
관측성을 위해 아래 매트릭스로 추적한다.

---

## 1. ✅ Wire format — 완벽 동일 (통합 보장)

OS가 달라도 셰어에 쓰는 형식이 byte-identical 이라 cross-host 작동.

| Contract | 형식 | 동일 |
|---|---|---|
| `manifest.json` | schema_version/tool/transfer_id/created_at/direction/category/batch_name/version/source/destination/mode/files/totals/state · canonical sorted-keys pretty JSON | ✅ |
| `transfer_id` | `YYYY-MM-DDTHHMMSS±TTTT__<src>__<tgt>__<cat>__<batch>__v<NN>` (TZ 콜론 없음) | ✅ |
| checksum sidecar | `<sha>  <name>\n` (두 칸 + NFC 정규화) | ✅ |
| dir-hash | lex-sort `<rel>\0<sha>\n` 누적 해시, 숨김파일 제외, `\`→`/`, NFC, 1 MiB 청크 | ✅ |
| 파일 naming | `YYYY-MM-DD__<cat>__<base>__v<NN><ext>`, NFC | ✅ |
| Category (9종) | key/label/emoji/folder 전부 동일 | ✅ |
| Direction/State | 폴더·토큰 매핑 동일 (10_Mac_to_Windows 등) | ✅ |
| RAW_SECRET 목록 | `.env*`/`.pem`/`.key`/`.p12`/`.mobileprovision`/`service-account*.json`, 대소문자 무시 | ✅ (단 §3-A 참고) |
| 노트 JSON | schema_version/id/title/body/created_at/updated_at/updated_by{host,os} | ✅ |
| 노트 id | `note-<uuid-simple>`, **프론트 mint**(분열 방지), sanitize 동일 | ✅ |
| 클립보드 JSONL | text: ts/host/os/content/kind/len · image: +image_ref/width/height/size_bytes/content | ✅ |
| 클립보드 이미지 | PNG, SHA-256 dedup, `images/<sha>.png`, 폴 1.5s | ✅ |
| git-status.json | RepoStatus 13필드 + HostGitSnapshot(schema_version/host/os/scanned_at/repos) | ✅ |
| git-log.json | CommitNode(sha/parents/msg/author/date), `--format=%H%x1f%P%x1f%s%x1f%an%x1f%cI` | ✅ |
| remote-cache.json | RemoteRepoState/branch/PR | ✅ |
| RepoGraph | per_branch commits/pointers/common_ancestor/summary 알고리즘 동일 | ✅ |
| `normalize_owner_repo` | github.com 파싱 로직 byte-identical | ✅ |

---

## 2. ◑ 의도적 차이 (OS 플랫폼 — 정당)

| 항목 | Mac | Windows | 사유 |
|---|---|---|---|
| 호스트명 | `scutil --get LocalHostName` | `%COMPUTERNAME%` | OS API |
| 로컬 데이터 경로 | `~/Library/Application Support/` | `%LOCALAPPDATA%` | OS 표준 |
| share root 기본값 | `/Volumes/Mac-Windows_Share` | `D:\Mac-Window_Share` | SMB 마운트 vs 로컬 NTFS |
| remote host 기본 IP | 192.168.50.1 (상대) | 192.168.50.2 (상대) | 서로의 주소 |
| ping 옵션 | `-c 2 -W 1500` | `-n 2 -w 1500` | 플랫폼 ping |
| git scan root | 홈 하위(Developer/Projects/…) | 드라이브 C:~Z: 워크 | FS 레이아웃 |
| VSIX 해제 | `/usr/bin/unzip` | `tar.exe` | 기본 도구 |
| 마운트 개념 | SMB 마운트(변동) → offline 큐 필요 | 로컬 NTFS(상시) → 불필요 | **노트/클립보드 오프라인 큐가 Mac만 있는 정당한 이유** |
| TCC 권한 (FDA) | `has_full_disk_access`/`trigger_mac_tcc_registration`/`open_privacy_settings` | 없음 | macOS 전용 권한 모델 |
| desktop alias | Finder alias 명령 | 없음 | macOS Finder |
| Space follow / single-instance Reopen | NSWindow collection behavior | 없음 | macOS dock |

---

## 3. ❌ 비의도적 차이 / drift / 기능 비대칭

### 3-A. 동작 방식 drift (검증됨)

| # | 항목 | Mac | Windows | 영향 | 맞출 방향 |
|---|---|---|---|---|---|
| D1 | 클립보드 폴 분기 | text 성공 시 `continue`(image 스킵) | text 후 image 도 시도 | 한 사이클 text+image 동시 변경 시 타임라인 미세 불일치 (실질 드묾) | **Windows → Mac**: text 성공 시 continue. minor |
| D2 | verify 디렉토리 감지 | `manifest.mode=="directory"` 신뢰 | 실제 `abs.is_dir()` 탐사 | 정상 경로 동일. manifest 손상 시 결과 갈림 | 둘 중 하나로 통일 (manifest mode 명시 검증 권장) |
| D3 | RAW_SECRET 적용 (방식·패턴 비대칭) | **하드코딩 고정** 패턴, network_mode 무시 (raw_secret.rs) | **policy + 셰어 `_secrets_policy/{mode}.shareignore` 동적**, closed=서명·인증서·SSH만 차단 (send-to-mac.ps1) | **양방향 누출**: ①closed 모드서 `.env`/`*.pem`/`*.key` 가 Win→Mac 통과(Mac이면 차단됨) ②`id_rsa`/`id_ed25519` 등 SSH키가 Mac→Win 통과(Mac raw_secret 에 패턴 없음) | **A안(권장)**: Mac 도 셰어 `_secrets_policy` 단일 소스 읽게 → byte-identical. **즉시**: Mac raw_secret 에 ssh키/`*.pfx`/`*.gpg.key` 추가. 상세: 2026-06-10 브리핑 |

### 3-B. Mac 앞섬 → Windows backport 필요

| 기능 | Mac 식별자 | 우선순위 | 비고 |
|---|---|---|---|
| interactive git ops (fetch/pull/push/stash/stash_pop) | F-7 | **HIGH** | Windows commands.rs 에 5개 명령 없음 |
| PAT cross-host sync (age+ssh) | F-3/B-10 | **HIGH** | cross-host 핵심인데 Windows 미구현 (KEYRING 상수만 있음) |
| GitHub check-runs (CI overlay) | F-6 | MED | Windows 미구현 |
| 외부 알림 dispatch (native+webhook) | H-2/3/4 | MED | Windows 에 notify 동등물 없음 |
| `send_path_force` (overwrite) | D-8-b | MED | Windows 덮어쓰기 송신 경로 |
| `read_file_preview` | D-13-a | LOW | Details 미리보기 |
| 클립보드 상대 host 오프라인 캐시 | E-5-b/c | 조건부 | Windows 네트워크 드라이브 구성 시만 |
| watcher `git-token` topic 감시 | M-2-b | LOW | Mac 발행하나 Windows 미감시 |
| single-instance plugin | M-7-a | MED | Windows 두번째 실행 처리 부재 |

### 3-C. Windows 앞섬 → Mac backport 필요

| 기능 | Windows 산출 | 우선순위 | 비고 |
|---|---|---|---|
| L1 카드 unified layout | ADR-0005 | MED | Mac RepoCard 가 따라가야 |
| L2 detail verdict-row + connector chip | ADR-0006 | MED | Mac GitDetailModal 정렬 |
| **실제 scanned_at 표시** | app.js | **버그-Mac** | Mac RepoCard 가 `"방금 전 스캔"` **하드코딩** — 실제 데이터로 교체 필요 |

### 3-D. False-positive (에이전트 과장 — non-issue)

| 의심 | 실제 |
|---|---|
| Settings schema 분기로 cross-host 깨짐 | settings.json 은 **로컬 전용**(app_config_dir) + 양쪽 `#[serde(default)]` → 동기화 대상 아님. 무관 |
| `list_language_presets` Mac 없음 | Mac 에 있음 (policy.rs + commands.rs) |
| 클립보드 이미지 content 구분자 차이 | 최종 문자열 동일 (`×` 유니코드) |

---

## 4. 우선순위 backport 백로그

**Windows ← Mac (HIGH)** → 핸드오프 발행됨: `windows_gui/share-manager/MAC_PARITY_HANDOFF_GIT.md`
1. `git_op_*` 5개 (interactive git) — F-7 · G1
2. PAT cross-host sync (age+ssh) 3개 — F-3 · G2
3. single-instance plugin — M-7-a · G3

**Windows ← Mac (MED)**
4. notify (native+webhook) — H-2/3/4
5. github_fetch_check_runs — F-6
6. send_path_force — D-8-b

**Mac ← Windows**
7. ~~RepoCard scanned_at 하드코딩 → 실제값~~ ✅ **완료** (collectSummaries 가 host별 최신 scanned_at 집계 → RepoCard fmtRelative 표시)
8. ~~ADR-0005/0006 git L1/L2 디자인 정렬~~ ◑ **부분 완료** — ADR-0005(단일 layout)는 Mac RepoCard 가 이미 충족 + scanned_at 적용. ADR-0006 핵심(L2 verdict-row 큰 chip+진단문)은 `GitDetailModal` 에 적용(VerdictRow). connector chip 절대위치 / footer meta-actions 는 기존 ConnectorBar 로 기능 충족 — cosmetic 잔여만 후속.

**확인 필요**
9. Windows `send-to-mac.ps1` 의 RAW_SECRET 차단 보장 (D3)

---

## 5. 관측성 노트

- 이 매트릭스는 식별자(Mac CODE_MAP 의 `E-8-a` 등)로 양쪽을 가리킨다.
- backport 가 끝나면 해당 행을 ✅ 로 옮기고, Mac `IMPL_STATUS.md` 의 cross-OS
  컬럼 / Spotlight 와 동기화한다.
- 새 기능은 **한쪽에 추가하는 즉시 이 매트릭스에 행을 추가** → drift 누적 방지.
- 핸드오프는 `windows_gui/share-manager/MAC_PARITY_HANDOFF.md`(Mac→Win) 와
  이 문서를 짝으로 사용.
