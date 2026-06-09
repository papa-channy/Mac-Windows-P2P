# Mac → Windows Parity 핸드오프 (RAW_SECRET 정합 — D3)

> `PARITY_MATRIX.md` §3-B / §3-A D3 의 해소. Mac 이 **A안**(셰어 단일 정책
> 소스 읽기)으로 RAW_SECRET 차단을 재구현했고, 이제 Windows 측이 **완전히
> 동일하게 동작**하도록 작은 정렬 2건만 적용하면 양쪽이 byte-identical 차단이
> 된다. 이 커밋을 pull 한 뒤 이 문서 + 커밋 메시지만으로 작업 가능.

---

## 배경 — 무엇이 어긋났었나 (D3)

같은 파일이 **어느 OS 에서 보내느냐에 따라 차단 여부가 갈렸다**:

- Mac 은 `raw_secret.rs` 에 **하드코딩 고정 패턴**(.env*/.pem/.key/.p12/
  .mobileprovision/service-account*.json)을 network_mode 무시하고 항상 차단.
- Windows `send-to-mac.ps1` 은 **policy.json + 셰어 `_secrets_policy/
  <mode>-network.shareignore`** 를 읽어 network_mode(open/closed) 반영.

→ 현재 `closed` 모드에서:
- ① `.env`/`*.pem`/`*.key` 가 **Win→Mac 통과**(Mac 송신이면 차단됐을 것)
- ② `id_rsa`/`id_ed25519` 등 ssh 개인키가 **Mac→Win 통과**(Mac 패턴에 없었음)

## Mac 이 한 일 (A안, 이미 적용됨)

`mac_gui/.../transfer/raw_secret.rs` 를 **Windows sender 와 동일한 정책
소스**를 읽도록 재작성:
1. `policy.json` → `network_mode` + `secrets.always_blocked_patterns`
2. 셰어 `00_System/10_Config/ignore_rules/_secrets_policy/<mode>-network.shareignore`
3. PowerShell `-like` 호환 glob(`*` `?`), 대소문자 무시, basename
4. **`!` negation = allow 예외**(gitignore 스타일) — `.env.example` 은
   `.env.*` 매칭에도 불구하고 차단 안 됨
5. 셰어 못 읽으면 보수적 fallback(open 목록 = 전부 차단)으로 fail-closed

이제 Mac 은 closed 모드에서 `.env` 허용 / ssh키·서명키 차단 — **Windows 와
동일 동작**.

---

## Windows 가 할 일 (작은 정렬 2건)

Windows 는 이미 정책 소스를 읽으므로(§배경) **거의 정합**. 단 두 가지 차이를
맞춰야 진짜 byte-identical 이 된다.

### S1. negation(`!`) 처리 추가 — **버그 fix** (필수)

현재 `send-to-mac.ps1` (line 111~118 부근)은 shareignore 의 모든 비주석
라인을 그대로 `$blockPatterns` 에 add 한다. 그래서 `!.env.example` 도
패턴으로 들어가지만 `-like` 가 `!`를 리터럴로 봐서 매칭되지 않고, 대신
**`.env.*` 가 `.env.example` 을 잡아 차단**해 버린다 (의도와 반대 — 템플릿
파일이 막힘).

**수정**: `!` 로 시작하는 라인은 `$allowPatterns` 로, 나머지는
`$blockPatterns` 로 분리하고, 매칭 시 **allow 우선**:

```powershell
$blockPatterns = New-Object System.Collections.ArrayList
$allowPatterns = New-Object System.Collections.ArrayList

# policy.json always_blocked_patterns 로드 (기존 그대로) → $blockPatterns

# shareignore 로드 — ! 는 allow 로 분리
if (Test-Path -LiteralPath $secretsPolicyPath) {
    foreach ($line in Get-Content -LiteralPath $secretsPolicyPath -Encoding UTF8) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        if ($t.StartsWith('!')) {
            [void]$allowPatterns.Add($t.Substring(1))
        } else {
            [void]$blockPatterns.Add($t)
        }
    }
}

# 매칭 — allow 우선 (negation 존중)
$nameLower = $item.Name.ToLower()
$allowed = $false
foreach ($pat in $allowPatterns) {
    if ($nameLower -like $pat.ToLower()) { $allowed = $true; break }
}
$blocked = $null
if (-not $allowed) {
    foreach ($pat in $blockPatterns) {
        if ($nameLower -like $pat.ToLower()) { $blocked = $pat; break }
    }
}
if ($blocked) {
    Show-Error "BLOCKED (RAW_SECRET): '$blocked' matched. ..."
    exit 11
}
```

이러면 `.env.example` 은 `!.env.example` allow 로 통과 — Mac 과 동일.

### S2. fail-closed fallback (권장)

셰어 정책을 못 읽었을 때(파일 없음/파싱 실패) Windows 가 현재
`$blockPatterns.Count == 0` 이면 **아무것도 차단 안 하고 통과**할 수 있다.
Mac 은 이 경우 보수적 fallback(전부 차단)으로 **fail-closed** 한다.

**수정**: `$blockPatterns.Count -eq 0` 이면 내장 기본 목록(= open-network
목록)을 사용:

```powershell
if ($blockPatterns.Count -eq 0) {
    $default = @('.env','.env.*','*.pem','*.key','*.cer','*.crt','*.p12','*.pfx',
                 '*.mobileprovision','service-account*.json','id_rsa','id_ed25519',
                 'id_ecdsa','id_dsa','*.gpg.key','*.kdbx','secrets.yaml','secrets.yml',
                 'secrets.json','credentials.json')
    foreach ($p in $default) { [void]$blockPatterns.Add($p) }
    foreach ($p in @('.env.example','.env.template','.env.sample')) { [void]$allowPatterns.Add($p) }
}
```

---

## 검증 (양쪽 동일 결과 확인)

현재 셰어 `network_mode = closed` 기준, 같은 파일을 양쪽에서 보내며 비교:

| 파일 | 기대 (closed) |
|---|---|
| `.env` | **허용** (개발 시크릿 — closed 신뢰망) |
| `.env.example` | 허용 (negation) |
| `server.pem` | 허용 (closed) |
| `id_rsa` / `id_ed25519` | **차단** exit 11 |
| `cert.p12` / `*.pfx` | 차단 |
| `service-account-x.json` | 차단 |

→ Mac 과 Windows 가 **같은 파일에 같은 판정**이면 D3 해소.
(`network_mode` 를 `open` 으로 바꾸면 `.env`/`*.pem`/`*.key` 도 양쪽 다 차단.)

### 완료 기준
- [ ] S1 negation: `.env.example` 양쪽 허용 / `.env.local` 양쪽 차단(open) or 허용(closed)
- [ ] S2 fallback: 셰어 정책 삭제 후 송신 시 `.env` 차단(fail-closed)
- [ ] ssh 개인키(`id_rsa`) closed 모드에서도 양쪽 차단
- [ ] 같은 10개 샘플 파일을 Mac/Win 양쪽에서 송신 → 판정 100% 일치

## 식별자 / 위치
| | Mac | Windows |
|---|---|---|
| 차단 로직 | `transfer/raw_secret.rs` (D-5-a, A안 재작성) | `send-to-mac.ps1` (S1/S2) |
| 정책 소스 | 셰어 `_secrets_policy/<mode>.shareignore` + `policy.json` | 동일 (이미 읽음) |

끝나면 `PARITY_MATRIX.md` D3 행을 ✅ 로 옮긴다.

## TL;DR
Mac 은 하드코딩을 버리고 셰어 정책을 읽게 바꿈(완료). Windows 는 (S1)
`!` negation 을 allow 로 처리 + (S2) 정책 없을 때 fail-closed fallback —
이 둘만 하면 양쪽 RAW_SECRET 차단이 완전 동일해진다.
