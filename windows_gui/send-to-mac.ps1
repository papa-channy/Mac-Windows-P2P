# send-to-mac.ps1 — Explorer context-menu hook.
# Phase-1 shim: replicates what `shareguard send --direction windows-to-mac` will eventually do,
# until that command leaves stub status. Naming policy, copy into 20_Ready/<cat>/, and SHA-256 sidecar.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $SourcePath,
    [Parameter(Position = 1)]
    [string] $Category,
    [switch] $NoGui,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

# DEBUG TRACE — write each major step to a log so we can diagnose Explorer-launch failures
$dbgLog = Join-Path $env:LOCALAPPDATA 'MacWindowShare\Logs\send-to-mac.debug.log'
$dbgDir = Split-Path $dbgLog
if (-not (Test-Path $dbgDir)) { New-Item -ItemType Directory -Path $dbgDir -Force | Out-Null }
function Dbg([string]$msg) {
    $line = '{0}  PID={1}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $PID, $msg
    Add-Content -LiteralPath $dbgLog -Value $line -Encoding UTF8
}
# Wrap everything in a try/catch so unhandled exceptions land in the log
$ErrorActionPreference = 'Continue'
trap {
    Dbg ("UNHANDLED  " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message)
    Dbg ("STACK      " + $_.ScriptStackTrace)
    exit 99
}
$ErrorActionPreference = 'Stop'

Dbg "=== launch ==="
Dbg ("args: SourcePath='{0}'  Category='{1}'  NoGui={2}" -f $SourcePath, $Category, $NoGui)
Dbg ("pwsh ver: " + $PSVersionTable.PSVersion + "  edition: " + $PSVersionTable.PSEdition)
$consoleAttached = try { [Console]::WindowHeight -gt 0 } catch { 'no-handle' }
Dbg ("isInteractive: " + [Environment]::UserInteractive + "  console window: " + $consoleAttached)

$useGui = -not $NoGui
# WPF dialog has a dark header, so use the white/inverted variant.
# Context menu (light Explorer bg) uses send-to-mac.ico via the registry — see install.ps1.
$iconPath = Join-Path $PSScriptRoot 'icons\send-to-mac-dark.png'
if ($useGui) {
    Dbg "loading PresentationFramework"
    Add-Type -AssemblyName PresentationFramework  | Out-Null
    Dbg "dot-sourcing _send-dialog.ps1"
    . (Join-Path $PSScriptRoot '_send-dialog.ps1')
    Dbg "dialog helpers loaded"
}

function Show-Error([string]$msg) {
    if ($useGui) { [System.Windows.MessageBox]::Show($msg, 'MacBook으로 보내기', 'OK', 'Error') | Out-Null }
    else { [Console]::Error.WriteLine($msg) }
}

if (-not (Test-Path -LiteralPath $SourcePath)) {
    Show-Error "Path does not exist:`n$SourcePath"
    exit 64
}

$SHARE_ROOT  = if ($env:MW_SHARE_ROOT) { $env:MW_SHARE_ROOT } else { 'D:\Mac-Window_Share' }
$categories  = @('repos', 'data', 'documents', 'research', 'env', 'builds', 'assets', 'misc', 'unclassified')
$folderMap   = @{
    'repos'='10_Repos'; 'data'='20_Data'; 'documents'='30_Documents'; 'research'='40_Research';
    'env'='50_Env';     'builds'='60_Builds'; 'assets'='70_Assets';  'misc'='90_Misc';
    'unclassified'='99_Unclassified'
}
$labelMap    = @{
    'repos'='💻 코드';      'data'='📊 데이터';   'documents'='📄 문서';    'research'='🔬 리서치';
    'env'='⚙ 환경설정';     'builds'='🛠 빌드';   'assets'='🎨 애셋';       'misc'='📦 기타';
    'unclassified'='❔ 미분류'
}

$item = Get-Item -LiteralPath $SourcePath

if (-not $Category) {
    if ($useGui) {
        Dbg "showing category dialog"
        $Category = Show-CategoryDialog -Item $item -DefaultCategory 'documents' -IconPath $iconPath
        Dbg ("dialog returned: '" + $Category + "'")
        if (-not $Category) { Dbg "user cancelled"; exit 0 }
    } else {
        [Console]::Error.WriteLine("Category required when -NoGui set. Valid: $($categories -join ', ')")
        exit 64
    }
}
$category = $Category.ToLower().Trim()
if (-not $category) { exit 0 }
if (-not $folderMap.ContainsKey($category)) {
    Show-Error "Unknown category: $category`n`nValid: $($categories -join ', ')"
    exit 64
}

. (Join-Path $PSScriptRoot '_secret-policy.ps1')
# Load shared policy (gates RAW_SECRET behavior per network_mode).
$policyPath = Join-Path $SHARE_ROOT '00_System\10_Config\global\policy.json'
$networkMode = 'closed'  # safe default
$blockPatterns = New-Object System.Collections.ArrayList
if (Test-Path -LiteralPath $policyPath) {
    try {
        $policy = Get-Content -LiteralPath $policyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($policy.network_mode) { $networkMode = $policy.network_mode }
        if ($policy.secrets -and $policy.secrets.always_blocked_patterns) {
            foreach ($p in $policy.secrets.always_blocked_patterns) { [void]$blockPatterns.Add($p) }
        }
    } catch {
        Dbg "policy.json parse failed; using defaults"
    }
}
$secretsPolicyFile = if ($networkMode -eq 'open') { 'open-network.shareignore' } else { 'closed-network.shareignore' }
$secretsPolicyPath = Join-Path $SHARE_ROOT "00_System\10_Config\ignore_rules\_secrets_policy\$secretsPolicyFile"
$allowPatterns = New-Object System.Collections.ArrayList
$shareignoreRead = $false
if (Test-Path -LiteralPath $secretsPolicyPath) {
    # S1: '!' lines become allow exceptions (allow wins over block at match time).
    $parsed = ConvertTo-SecretPatterns (Get-Content -LiteralPath $secretsPolicyPath -Encoding UTF8)
    foreach ($p in $parsed.Block) { [void]$blockPatterns.Add($p) }
    foreach ($p in $parsed.Allow) { [void]$allowPatterns.Add($p) }
    $shareignoreRead = $true
}
# S2: fail-closed. If the per-mode shareignore couldn't be read, or no block pattern
# came from any source, seed the conservative defaults (block AND its allow exceptions)
# instead of passing everything. Matches Mac's fallback (= the open-network list).
if (-not $shareignoreRead -or $blockPatterns.Count -eq 0) {
    $def = Get-DefaultSecretPatterns
    foreach ($p in $def.Block) { [void]$blockPatterns.Add($p) }
    foreach ($p in $def.Allow) { [void]$allowPatterns.Add($p) }
}
Dbg "policy network_mode=$networkMode  block_patterns=$($blockPatterns.Count)  allow_patterns=$($allowPatterns.Count)"

# Allow-first decision (negation honored). Mac raw_secret.rs uses the same precedence.
$blocked = Test-SecretBlock -Name $item.Name -Block $blockPatterns -Allow $allowPatterns
if ($blocked) {
    $modeLabel = if ($networkMode -eq 'open') { 'OPEN-NETWORK (모든 시크릿 차단)' } else { 'CLOSED-NETWORK (서명/인증서/SSH 키만 차단)' }
    Show-Error "BLOCKED (RAW_SECRET): '$blocked' matched.`n`n현재 정책: $modeLabel.`n.env / API 키 등이 자동 차단됐다면 'closed' 모드인지 확인하거나 policy.json 을 수정하세요."
    exit 11
}

$dst = Join-Path $SHARE_ROOT ("10_Exchange\20_Windows_to_Mac\20_Ready\" + $folderMap[$category])
if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

$now      = Get-Date
$date     = $now.ToString('yyyy-MM-dd')
$baseName = $item.BaseName
$isDir    = $item.PSIsContainer
$ext      = if ($isDir) { '' } else { $item.Extension }
$newName  = "${date}__${category}__${baseName}__v01${ext}"
$dstPath  = Join-Path $dst $newName
$srcKindLabel = if ($isDir) { 'directory' } else { 'file' }
Dbg "source is $srcKindLabel  target: $dstPath"

if (Test-Path -LiteralPath $dstPath) {
    if ($Force) {
        Dbg "force overwrite (-Force)"
    } elseif ($useGui) {
        $confirm = [System.Windows.MessageBox]::Show(
            "Target already exists:`n$newName`n`nOverwrite?", 'Send to Mac', 'YesNo', 'Question')
        if ($confirm -ne 'Yes') { Dbg "user declined overwrite"; exit 0 }
    } else {
        [Console]::Error.WriteLine("Target already exists: $dstPath (remove first or rename)")
        exit 20
    }
    if ($isDir) {
        Dbg "removing existing destination directory"
        Remove-Item -LiteralPath $dstPath -Recurse -Force
    }
}

if ($isDir) {
    Dbg "Copy-Item -Recurse (folder mode)"
    Copy-Item -LiteralPath $item.FullName -Destination $dstPath -Recurse -Force
    # For folders, hash a manifest of (relative-path + sha256) for every file inside.
    $fileEntries = @()
    $combinedSha = [System.Security.Cryptography.SHA256]::Create()
    foreach ($f in Get-ChildItem -LiteralPath $dstPath -Recurse -File) {
        $rel = $f.FullName.Substring($dstPath.Length).TrimStart('\','/')
        $h = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
        $fileEntries += [pscustomobject]@{ rel = $rel; sha256 = $h; bytes = $f.Length }
        # Roll a combined hash over "rel\0sha256\n" entries for a stable directory hash.
        $line = "$rel`0$h`n"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($line)
        $null = $combinedSha.TransformBlock($bytes, 0, $bytes.Length, $bytes, 0)
    }
    $combinedSha.TransformFinalBlock(@(), 0, 0) | Out-Null
    $hash = ([System.BitConverter]::ToString($combinedSha.Hash) -replace '-','').ToLower()
    $combinedSha.Dispose()
    Dbg ("folder hashed: $($fileEntries.Count) files, dir-hash=$hash")
} else {
    Dbg "Copy-Item (file mode)"
    Copy-Item -LiteralPath $item.FullName -Destination $dstPath -Force
    $hash = (Get-FileHash -LiteralPath $dstPath -Algorithm SHA256).Hash.ToLower()
    $fileEntries = $null
}

# Sidecar + manifest (parity with what shareguard send will produce)
$tsStamp     = $now.ToString('yyyy-MM-ddTHHmmsszzz').Replace(':','')
$transferId  = "${tsStamp}__windows__mac__${category}__${baseName}__v01"
$manifestDir = Join-Path $SHARE_ROOT '00_System\30_Manifests\windows_to_mac'
$ckDir       = Join-Path $SHARE_ROOT '00_System\50_Checksums\windows_to_mac'
$logDir      = Join-Path $SHARE_ROOT '00_System\40_Logs\windows_to_mac'
foreach ($d in @($manifestDir, $ckDir, $logDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

if ($isDir) {
    # Sidecar: one row per file inside the folder, paths relative to the folder root.
    $ckLines = $fileEntries | ForEach-Object { "$($_.sha256)  $newName/$($_.rel -replace '\\','/')" }
    # Append a synthetic dir-hash row for whole-tree verification.
    $ckLines += "$hash  $newName  # combined dir-hash"
    $ckLines | Set-Content -LiteralPath (Join-Path $ckDir "$transferId.sha256") -Encoding UTF8
    $manifestFiles = $fileEntries | ForEach-Object {
        @{ path = "$newName/$($_.rel -replace '\\','/')"; size_bytes = $_.bytes; sha256 = $_.sha256 }
    }
    $totalBytes = ($fileEntries | Measure-Object bytes -Sum).Sum
    $manifestMode = 'directory'
} else {
    "$hash  $newName" | Set-Content -LiteralPath (Join-Path $ckDir "$transferId.sha256") -Encoding UTF8
    $manifestFiles = @(@{ path = $newName; size_bytes = (Get-Item -LiteralPath $dstPath).Length; sha256 = $hash; mtime = (Get-Item -LiteralPath $dstPath).LastWriteTime.ToString('o') })
    $totalBytes = (Get-Item -LiteralPath $dstPath).Length
    $manifestMode = 'file'
}

# Detect project languages for folder sends (informational; enforcement comes later via shareguard send).
$detectedLanguages = @()
$hasGit = $false
if ($isDir -and $policy -and $policy.language_detection -and $policy.language_detection.enabled) {
    $markers   = $policy.language_detection.markers
    $gitDirs   = if ($policy.language_detection.git_marker_dirs) { $policy.language_detection.git_marker_dirs } else { @('.git','.hg','.svn') }
    # Walk depth 2
    $entries = Get-ChildItem -LiteralPath $item.FullName -Depth 1 -Force -ErrorAction SilentlyContinue
    foreach ($e in $entries) {
        if ($e.PSIsContainer -and $gitDirs -contains $e.Name) { $hasGit = $true; continue }
        if ($e.PSIsContainer) { continue }
        foreach ($lang in $markers.PSObject.Properties.Name) {
            foreach ($pat in $markers.$lang) {
                $patLower = $pat.ToLower()
                if ($e.Name.ToLower() -like $patLower) {
                    if ($detectedLanguages -notcontains $lang) { $detectedLanguages += $lang }
                }
            }
        }
    }
    Dbg "language detection: hasGit=$hasGit  detected=$($detectedLanguages -join ',')"
}

$manifest = [ordered]@{
    schema_version = 1
    tool           = 'send-to-mac.ps1 (phase-1 shim)'
    tool_version   = '0.1.1'
    transfer_id    = $transferId
    created_at     = $now.ToString('yyyy-MM-ddTHH:mm:sszzz')
    direction      = 'windows_to_mac'
    category       = $category
    batch_name     = $baseName
    version        = 1
    source         = @{ host = $env:COMPUTERNAME; user = $env:USERNAME; path = $item.FullName }
    destination    = @{ share_path = "10_Exchange/20_Windows_to_Mac/20_Ready/$($folderMap[$category])/"; primary_file = $newName }
    mode           = $manifestMode
    files          = $manifestFiles
    totals         = @{ files_included = ($manifestFiles | Measure-Object).Count; bytes_out = $totalBytes }
    policy_applied = @{
        network_mode      = $networkMode
        block_patterns    = $blockPatterns.Count
        allow_patterns    = $allowPatterns.Count
        detected_languages= $detectedLanguages
        has_git           = $hasGit
    }
    state          = 'ready'
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $manifestDir "$transferId.json") -Encoding UTF8

$logKindLabel = if ($isDir) { "directory ($(($fileEntries|Measure-Object).Count) files, $totalBytes bytes)" } else { "$totalBytes bytes" }
@(
    "[$($now.ToString('o'))] context-menu send: $($item.FullName) -> $dstPath"
    "[$($now.ToString('o'))] mode=$manifestMode  hash=$hash  payload=$logKindLabel"
    "[$($now.ToString('o'))] state=ready transfer_id=$transferId"
) | Set-Content -LiteralPath (Join-Path $logDir "$transferId.log") -Encoding UTF8

if ($useGui) {
    Show-ResultDialog `
        -Filename $newName `
        -Category $labelMap[$category] `
        -Sha256   $hash `
        -IconPath $iconPath
} else {
    Write-Host "Sent to Mac:`n  $newName`n`nCategory: $category`nSHA-256: $($hash.Substring(0,16))...`n`nManifest, checksum, log written to 00_System/."
    Write-Host "transfer_id: $transferId"
}
exit 0
