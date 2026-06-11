# RAW_SECRET Parity (D3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows file-send secret blocker byte-identical to Mac's `raw_secret.rs` (A안) by honoring gitignore-style `!` negation and failing closed when the share policy can't be read.

**Architecture:** Extract the pattern decision into three pure PowerShell functions in a dot-sourced sibling module (`windows_gui/_secret-policy.ps1`), unit-tested with Pester. Wire them into `send-to-mac.ps1`, replacing the buggy inline shareignore parsing and the match loop — leaving the existing `policy.json` load (which `$policy` is reused from later) untouched.

**Tech Stack:** PowerShell 7 (pwsh), Pester 3.4 (preinstalled), `-like` glob matching.

---

## Background — what's wrong (handoff `MAC_PARITY_HANDOFF_SECRETS.md`)

The same file is blocked or not depending on which OS sends it. Mac was rewritten (A안) to read the shared policy with two behaviors Windows lacks:

- **S1 (bug):** `send-to-mac.ps1:116` does `if ($t.StartsWith('!')) { continue }` — it *drops* negation lines. So `!.env.example` is ignored and `.env.*` (a block pattern) then matches `.env.example`, blocking the template. Fix: route `!` lines to an allow list and let allow win.
- **S2 (fail-open):** when no policy file is found, `$blockPatterns` is empty and the match loop blocks nothing → everything passes. Mac falls back to a conservative default (fail-closed). Fix: when the merged block list is empty, seed built-in defaults.

## File Structure

| File | Responsibility |
|---|---|
| `windows_gui/_secret-policy.ps1` (**create**) | Pure functions: parse shareignore lines into block/allow, the fail-closed defaults, and the match decision. No file IO, no globals. |
| `windows_gui/_secret-policy.Tests.ps1` (**create**) | Pester 3.4 unit tests for the three functions. |
| `windows_gui/send-to-mac.ps1` (**modify** `109-133`) | Dot-source the module; replace shareignore parsing (`109-119`) + match loop (`122-133`) with module calls; add S2 fallback. |
| `PARITY_MATRIX.md` (**modify** D3 row + §4 item 9) | Flip D3 to ✅ once verified. |

All paths below are relative to the repo root `D:\dev\Mac-Windows-P2P`. PowerShell commands assume the working directory is `D:\dev\Mac-Windows-P2P\windows_gui` unless noted.

---

### Task 1: Pure secret-policy module (TDD)

**Files:**
- Create: `windows_gui/_secret-policy.ps1`
- Test: `windows_gui/_secret-policy.Tests.ps1`

- [ ] **Step 1: Write the failing tests**

Create `windows_gui/_secret-policy.Tests.ps1`:

```powershell
# Pester 3.4 (legacy `Should Be` syntax). Run from windows_gui/.
. (Join-Path $PSScriptRoot '_secret-policy.ps1')

Describe 'ConvertTo-SecretPatterns' {
    It 'puts plain lines into Block' {
        $r = ConvertTo-SecretPatterns @('.env.*', '*.pem')
        $r.Block.Count | Should Be 2
        $r.Allow.Count | Should Be 0
    }
    It 'routes ! lines into Allow without the bang' {
        $r = ConvertTo-SecretPatterns @('.env.*', '!.env.example')
        ($r.Block -contains '.env.*')       | Should Be $true
        ($r.Allow -contains '.env.example') | Should Be $true
    }
    It 'skips blanks and # comments' {
        $r = ConvertTo-SecretPatterns @('', '   ', '# a comment', 'id_rsa')
        $r.Block.Count | Should Be 1
        $r.Block[0]    | Should Be 'id_rsa'
    }
}

Describe 'Test-SecretBlock' {
    It 'blocks a glob match and returns the pattern' {
        Test-SecretBlock -Name 'server.pem' -Block @('*.pem') | Should Be '*.pem'
    }
    It 'allows when an allow pattern matches (negation wins)' {
        Test-SecretBlock -Name '.env.example' -Block @('.env.*') -Allow @('.env.example') | Should BeNullOrEmpty
    }
    It 'still blocks a non-allowed sibling' {
        Test-SecretBlock -Name '.env.local' -Block @('.env.*') -Allow @('.env.example') | Should Be '.env.*'
    }
    It 'matches case-insensitively' {
        Test-SecretBlock -Name 'ID_RSA' -Block @('id_rsa') | Should Be 'id_rsa'
    }
    It 'returns null when nothing matches' {
        Test-SecretBlock -Name 'readme.md' -Block @('*.pem', 'id_rsa') | Should BeNullOrEmpty
    }
}

Describe 'Get-DefaultSecretPatterns (fail-closed)' {
    It 'blocks ssh private keys' {
        $d = Get-DefaultSecretPatterns
        Test-SecretBlock -Name 'id_rsa' -Block $d.Block -Allow $d.Allow | Should Be 'id_rsa'
    }
    It 'blocks .env under the fail-closed default' {
        $d = Get-DefaultSecretPatterns
        Test-SecretBlock -Name '.env' -Block $d.Block -Allow $d.Allow | Should Be '.env'
    }
    It 'allows .env.example even under fail-closed' {
        $d = Get-DefaultSecretPatterns
        Test-SecretBlock -Name '.env.example' -Block $d.Block -Allow $d.Allow | Should BeNullOrEmpty
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `windows_gui/`):
```
pwsh -NoProfile -Command "Invoke-Pester -Path ./_secret-policy.Tests.ps1 -EnableExit"
```
Expected: FAIL — dot-source errors because `_secret-policy.ps1` does not exist yet (and `Test-SecretBlock`/`ConvertTo-SecretPatterns`/`Get-DefaultSecretPatterns` are undefined). Non-zero exit.

- [ ] **Step 3: Write the module**

Create `windows_gui/_secret-policy.ps1`:

```powershell
# _secret-policy.ps1 — RAW_SECRET pattern policy (parity with Mac raw_secret.rs, A안).
# Pure functions only: no file IO, no side effects → unit-testable. Dot-sourced by
# send-to-mac.ps1. gitignore-style '!' negation + conservative fail-closed default.

function ConvertTo-SecretPatterns {
    # Split shareignore-style lines into block + allow('!') patterns.
    # Skips blank lines and '#' comments. A leading '!' marks an allow exception.
    param([string[]] $Lines)
    $block = New-Object System.Collections.Generic.List[string]
    $allow = New-Object System.Collections.Generic.List[string]
    foreach ($line in $Lines) {
        if ($null -eq $line) { continue }
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        if ($t.StartsWith('!')) { $allow.Add($t.Substring(1)) }
        else { $block.Add($t) }
    }
    [pscustomobject]@{ Block = [string[]]$block; Allow = [string[]]$allow }
}

function Get-DefaultSecretPatterns {
    # Conservative fail-closed default (= the open-network block list) used when the
    # share policy can't be read, so an unreadable policy blocks rather than leaks.
    [pscustomobject]@{
        Block = [string[]]@(
            '.env', '.env.*', '*.pem', '*.key', '*.cer', '*.crt', '*.p12', '*.pfx',
            '*.mobileprovision', 'service-account*.json', 'id_rsa', 'id_ed25519',
            'id_ecdsa', 'id_dsa', '*.gpg.key', '*.kdbx', 'secrets.yaml', 'secrets.yml',
            'secrets.json', 'credentials.json'
        )
        Allow = [string[]]@('.env.example', '.env.template', '.env.sample')
    }
}

function Test-SecretBlock {
    # Return the first block pattern matching $Name, or $null when allowed.
    # Allow patterns win (gitignore '!' negation). Case-insensitive, basename only,
    # PowerShell -like globs (* and ?) — identical surface to Mac's matcher.
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [string[]] $Block = @(),
        [string[]] $Allow = @()
    )
    $n = $Name.ToLower()
    foreach ($pat in $Allow) {
        if ($n -like $pat.ToLower()) { return $null }
    }
    foreach ($pat in $Block) {
        if ($n -like $pat.ToLower()) { return $pat }
    }
    return $null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `windows_gui/`):
```
pwsh -NoProfile -Command "Invoke-Pester -Path ./_secret-policy.Tests.ps1 -EnableExit"
```
Expected: PASS — `Tests Passed: 11, Failed: 0`. Exit code 0.

- [ ] **Step 5: Commit**

```
git add windows_gui/_secret-policy.ps1 windows_gui/_secret-policy.Tests.ps1
git commit -m "windows secrets: pure pattern-policy module + Pester tests (S1/S2 core)"
```

---

### Task 2: Wire the module into send-to-mac.ps1

**Files:**
- Modify: `windows_gui/send-to-mac.ps1:94` (add dot-source), `:109-119` (shareignore parse + S2), `:122-133` (match)

- [ ] **Step 1: Dot-source the module before the policy block**

In `windows_gui/send-to-mac.ps1`, find (around line 94):
```powershell
# Load shared policy (gates RAW_SECRET behavior per network_mode).
$policyPath = Join-Path $SHARE_ROOT '00_System\10_Config\global\policy.json'
```
Insert immediately **above** the comment:
```powershell
. (Join-Path $PSScriptRoot '_secret-policy.ps1')
```

- [ ] **Step 2: Replace the shareignore parsing with module calls + S2 fallback**

Replace this exact block (lines `109-119`):
```powershell
$secretsPolicyFile = if ($networkMode -eq 'open') { 'open-network.shareignore' } else { 'closed-network.shareignore' }
$secretsPolicyPath = Join-Path $SHARE_ROOT "00_System\10_Config\ignore_rules\_secrets_policy\$secretsPolicyFile"
if (Test-Path -LiteralPath $secretsPolicyPath) {
    foreach ($line in Get-Content -LiteralPath $secretsPolicyPath -Encoding UTF8) {
        $t = $line.Trim()
        if (-not $t) { continue }
        if ($t.StartsWith('#')) { continue }
        if ($t.StartsWith('!')) { continue }   # negation patterns: handled elsewhere if needed
        [void]$blockPatterns.Add($t)
    }
}
Dbg "policy network_mode=$networkMode  block_patterns=$($blockPatterns.Count)"
```
with:
```powershell
$secretsPolicyFile = if ($networkMode -eq 'open') { 'open-network.shareignore' } else { 'closed-network.shareignore' }
$secretsPolicyPath = Join-Path $SHARE_ROOT "00_System\10_Config\ignore_rules\_secrets_policy\$secretsPolicyFile"
$allowPatterns = New-Object System.Collections.ArrayList
if (Test-Path -LiteralPath $secretsPolicyPath) {
    # S1: '!' lines become allow exceptions (allow wins over block at match time).
    $parsed = ConvertTo-SecretPatterns (Get-Content -LiteralPath $secretsPolicyPath -Encoding UTF8)
    foreach ($p in $parsed.Block) { [void]$blockPatterns.Add($p) }
    foreach ($p in $parsed.Allow) { [void]$allowPatterns.Add($p) }
}
# S2: fail-closed. If the per-mode shareignore couldn't be read, or no block pattern
# came from any source, seed the conservative defaults (block AND its allow exceptions)
# instead of passing everything. Matches Mac's fallback (= the open-network list).
# NOTE: refined during code review — the trigger also fires when the shareignore file
# is unreadable (not only when the merged block list is empty), so policy.json
# always_blocked_patterns + a missing shareignore still seeds the allow-exceptions.
if (-not $shareignoreRead -or $blockPatterns.Count -eq 0) {
    $def = Get-DefaultSecretPatterns
    foreach ($p in $def.Block) { [void]$blockPatterns.Add($p) }
    foreach ($p in $def.Allow) { [void]$allowPatterns.Add($p) }
}
Dbg "policy network_mode=$networkMode  block_patterns=$($blockPatterns.Count)  allow_patterns=$($allowPatterns.Count)"
```

> The `if (Test-Path ...)` block above also sets `$shareignoreRead = $true` after a
> successful read (added in the same review refinement).

- [ ] **Step 3: Replace the inline match loop with the allow-first matcher**

Replace this exact block (lines `122-133`):
```powershell
$nameLower = $item.Name.ToLower()
$blocked = $null
foreach ($pat in $blockPatterns) {
    $patLower = $pat.ToLower()
    # PowerShell's -like handles simple wildcards (* and ?).
    if ($nameLower -like $patLower) { $blocked = $pat; break }
}
if ($blocked) {
    $modeLabel = if ($networkMode -eq 'open') { 'OPEN-NETWORK (모든 시크릿 차단)' } else { 'CLOSED-NETWORK (서명/인증서/SSH 키만 차단)' }
    Show-Error "BLOCKED (RAW_SECRET): '$blocked' matched.`n`n현재 정책: $modeLabel.`n.env / API 키 등이 자동 차단됐다면 'closed' 모드인지 확인하거나 policy.json 을 수정하세요."
    exit 11
}
```
with:
```powershell
# Allow-first decision (negation honored). Mac raw_secret.rs uses the same precedence.
$blocked = Test-SecretBlock -Name $item.Name -Block $blockPatterns -Allow $allowPatterns
if ($blocked) {
    $modeLabel = if ($networkMode -eq 'open') { 'OPEN-NETWORK (모든 시크릿 차단)' } else { 'CLOSED-NETWORK (서명/인증서/SSH 키만 차단)' }
    Show-Error "BLOCKED (RAW_SECRET): '$blocked' matched.`n`n현재 정책: $modeLabel.`n.env / API 키 등이 자동 차단됐다면 'closed' 모드인지 확인하거나 policy.json 을 수정하세요."
    exit 11
}
```

> Note: the later manifest field `block_patterns = $blockPatterns.Count` (≈ line 257) needs no change — `$blockPatterns` now holds the merged + fallback set. The `$policy` object loaded at lines 95-108 is untouched, so the language-detection block at line 220 still works.

- [ ] **Step 4: Verify the script still parses (no syntax break)**

Run (from `windows_gui/`):
```
pwsh -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path ./send-to-mac.ps1), [ref]$null, [ref]([ref]$e).Value); if ($e) { $e; exit 1 } else { 'PARSE OK' }"
```
Expected: `PARSE OK`, exit 0.

- [ ] **Step 5: Verify the unit tests still pass (module unchanged, regression guard)**

Run (from `windows_gui/`):
```
pwsh -NoProfile -Command "Invoke-Pester -Path ./_secret-policy.Tests.ps1 -EnableExit"
```
Expected: PASS — 11 passed, 0 failed.

- [ ] **Step 6: Commit**

```
git add windows_gui/send-to-mac.ps1
git commit -m "windows secrets: honor ! negation (S1) + fail-closed fallback (S2)"
```

---

### Task 3: End-to-end verification against a temp share

This proves the wiring (dot-source → loader → matcher → exit code) end-to-end using a throwaway share, so nothing is written to the real `D:\Mac-Window_Share`.

**Files:** none (verification only).

- [ ] **Step 1: Build a temp share with a closed-mode policy and run the script against sample files**

Run (from `windows_gui/`) — this whole block is one command:
```
pwsh -NoProfile -Command @'
$ErrorActionPreference = "Stop"
$share = Join-Path $env:TEMP ("mw-secret-test-" + [guid]::NewGuid().ToString("N").Substring(0,8))
$pol   = Join-Path $share "00_System\10_Config\ignore_rules\_secrets_policy"
$glob  = Join-Path $share "00_System\10_Config\global"
New-Item -ItemType Directory -Force -Path $pol, $glob | Out-Null
'{ "network_mode": "closed" }' | Set-Content -LiteralPath (Join-Path $glob "policy.json") -Encoding UTF8
# closed-mode: block ssh/signing/certs, explicitly allow .env templates, allow plain .env
@(
  "id_rsa","id_ed25519","*.pem","*.p12","*.pfx","service-account*.json","!.env.example"
) | Set-Content -LiteralPath (Join-Path $pol "closed-network.shareignore") -Encoding UTF8

$work = Join-Path $share "_samples"; New-Item -ItemType Directory -Force -Path $work | Out-Null
$cases = @(
  @{ name=".env";                    expect=0  },
  @{ name=".env.example";            expect=0  },
  @{ name="server.pem";              expect=11 },
  @{ name="id_rsa";                  expect=11 },
  @{ name="cert.p12";                expect=11 },
  @{ name="service-account-x.json";  expect=11 }
)
$fail = 0
foreach ($c in $cases) {
  $f = Join-Path $work $c.name; "x" | Set-Content -LiteralPath $f -Encoding UTF8
  $env:MW_SHARE_ROOT = $share
  & pwsh -NoProfile -File ./send-to-mac.ps1 $f "env" -NoGui *> $null
  $got = $LASTEXITCODE
  $ok  = if ($got -eq $c.expect) { "PASS" } else { $fail++; "FAIL" }
  "{0}  {1,-24} expect={2} got={3}" -f $ok, $c.name, $c.expect, $got
  Remove-Item -LiteralPath (Join-Path $share ("10_Exchange\20_Windows_to_Mac\20_Ready\50_Env\2*__env__*")) -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $share -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item Env:\MW_SHARE_ROOT -ErrorAction SilentlyContinue
if ($fail -gt 0) { "RESULT: $fail case(s) FAILED"; exit 1 } else { "RESULT: all cases PASS"; exit 0 }
'@
```
Expected output (exact verdicts; `RESULT: all cases PASS`, exit 0):
```
PASS  .env                     expect=0  got=0
PASS  .env.example             expect=0  got=0
PASS  server.pem               expect=11 got=11
PASS  id_rsa                   expect=11 got=11
PASS  cert.p12                 expect=11 got=11
PASS  service-account-x.json   expect=11 got=11
RESULT: all cases PASS
```

This maps 1:1 to the handoff §검증 closed-mode table: `.env` allowed, `.env.example` allowed via negation (S1), signing/cert/ssh keys blocked.

- [ ] **Step 2: Verify S2 fail-closed (no policy files → still blocks)**

Run (from `windows_gui/`):
```
pwsh -NoProfile -Command @'
$ErrorActionPreference = "Stop"
$share = Join-Path $env:TEMP ("mw-secret-failclosed-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path (Join-Path $share "_samples") | Out-Null   # NO policy files
$f = Join-Path $share "_samples\.env"; "x" | Set-Content -LiteralPath $f -Encoding UTF8
$env:MW_SHARE_ROOT = $share
& pwsh -NoProfile -File ./send-to-mac.ps1 $f "env" -NoGui *> $null
$got = $LASTEXITCODE
Remove-Item -LiteralPath $share -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item Env:\MW_SHARE_ROOT -ErrorAction SilentlyContinue
if ($got -eq 11) { "PASS fail-closed: .env blocked with no policy (exit 11)"; exit 0 }
else { "FAIL fail-closed: expected 11, got $got"; exit 1 }
'@
```
Expected: `PASS fail-closed: .env blocked with no policy (exit 11)`, exit 0.

> Note: with no `policy.json`, `network_mode` stays the safe default `closed`, so the chosen shareignore file is `closed-network.shareignore` (also absent) → merged block list empty → S2 defaults seed → `.env` matches the default `.env` block. Confirms fail-closed.

- [ ] **Step 3: Commit (no-op guard)**

No source changed in Task 3. If `git status` is clean, skip the commit. If the run left stray files under the repo (it should not — everything is under `$env:TEMP`), remove them first.

---

### Task 4: Close out the parity matrix

**Files:**
- Modify: `PARITY_MATRIX.md` (D3 row ~line 76, §4 item 9 ~line 127)

- [ ] **Step 1: Flip the D3 row to resolved**

In `PARITY_MATRIX.md`, in the §3-A table D3 row, change the 영향 cell `◑ **Mac 완료 / Windows S1·S2 대기**` to:
```
✅ **해소** — Windows S1(negation)+S2(fail-closed) 적용, 양쪽 동일 판정 검증
```

- [ ] **Step 2: Strike the §4 backlog item 9**

In `PARITY_MATRIX.md` §4 "확인 필요", change:
```
9. Windows `send-to-mac.ps1` 의 RAW_SECRET 차단 보장 (D3)
```
to:
```
9. ~~Windows `send-to-mac.ps1` 의 RAW_SECRET 차단 보장 (D3)~~ ✅ 완료 (`_secret-policy.ps1` + S1/S2)
```

- [ ] **Step 3: Commit**

```
git add PARITY_MATRIX.md
git commit -m "parity: D3 RAW_SECRET resolved on Windows (S1 negation + S2 fail-closed)"
```

---

## Self-Review

- **Spec coverage:** S1 negation → Task 1 (`ConvertTo-SecretPatterns`, `Test-SecretBlock` allow-first) + Task 2 Step 2-3; verified in Task 3 Step 1 (`.env.example` PASS). S2 fail-closed → Task 1 (`Get-DefaultSecretPatterns`) + Task 2 Step 2; verified in Task 3 Step 2. Handoff §검증 table → Task 3 Step 1 cases. PARITY_MATRIX close-out → Task 4. All covered.
- **Type consistency:** `ConvertTo-SecretPatterns` / `Get-DefaultSecretPatterns` both return `[pscustomobject]@{ Block; Allow }` (string[]); `Test-SecretBlock(-Name, -Block, -Allow)` returns a pattern string or `$null`. The script passes `$blockPatterns` (ArrayList) / `$allowPatterns` (ArrayList) into `[string[]]` params — PowerShell coerces. Names match across Task 1 ↔ Task 2.
- **No placeholders:** every code/command step shows full content and exact expected output.
- **Out of scope (intentional):** the existing `policy.json` load (`95-108`) and `$policy` reuse (language detection, line 220) are deliberately left unchanged.

## Done when
- [ ] `Invoke-Pester ./_secret-policy.Tests.ps1` → 11 passed, 0 failed
- [ ] Task 3 Step 1 prints `RESULT: all cases PASS`
- [ ] Task 3 Step 2 prints the fail-closed PASS line
- [ ] `PARITY_MATRIX.md` D3 shows ✅
