# install.ps1 — register Explorer context menu entries and add windows_gui/ to user PATH.
# All changes are HKCU (user-scope), no admin required.
# Re-runnable: idempotent.

[CmdletBinding()]
param(
    [switch] $WhatIf,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

$here       = Split-Path -Parent $PSCommandPath
$mwScript   = Join-Path $here 'mw.ps1'
$sendScript = Join-Path $here 'send-to-mac.ps1'

if (-not (Test-Path $mwScript))   { throw "missing: $mwScript" }
if (-not (Test-Path $sendScript)) { throw "missing: $sendScript" }

$launcher = Join-Path $here 'launcher.vbs'
if (-not (Test-Path $launcher)) { throw "missing: $launcher" }
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

$iconSend = Join-Path $here 'icons\send-to-mac.ico'
$iconOpen = Join-Path $here 'icons\send-to-mac.ico'  # reuse same theme; swap if you want a distinct icon
if (-not (Test-Path $iconSend)) { $iconSend = '' }
if (-not (Test-Path $iconOpen)) { $iconOpen = '' }

$pwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $pwshExe) { $pwshExe = (Get-Command powershell -ErrorAction Stop).Source }

$entries = @(
    @{
        Description = 'Send to Mac (right-click on a FILE)'
        KeyPath     = 'HKCU:\Software\Classes\*\shell\ShareGuardSendToMac'
        DisplayName = 'MacBook으로 보내기'
        Icon        = $iconSend
        Command     = ('"{0}" "{1}" "send-to-mac.ps1" "%1"' -f $wscript, $launcher)
    },
    @{
        Description = 'Send to Mac (right-click on a FOLDER)'
        KeyPath     = 'HKCU:\Software\Classes\Directory\shell\ShareGuardSendToMac'
        DisplayName = 'MacBook으로 보내기'
        Icon        = $iconSend
        Command     = ('"{0}" "{1}" "send-to-mac.ps1" "%1"' -f $wscript, $launcher)
    },
    @{
        Description = 'Open Mac-Window Share (right-click background)'
        KeyPath     = 'HKCU:\Software\Classes\Directory\Background\shell\OpenMacWinShare'
        DisplayName = 'Open Mac-Window Share'
        Icon        = $iconOpen
        Command     = ('"{0}" "{1}" "mw.ps1" "open"' -f $wscript, $launcher)
    }
)

function Set-MenuEntry($entry) {
    $cmdKey = $entry.KeyPath + '\command'
    if ($WhatIf) {
        Write-Host "WhatIf: would create $($entry.KeyPath)  ->  $($entry.DisplayName)"
        Write-Host "WhatIf:   command: $($entry.Command)"
        return
    }
    # Use -LiteralPath so '*' in path (e.g. HKCU:\Software\Classes\*\shell\...) is not
    # interpreted as a wildcard. Without this, Set-ItemProperty silently no-ops.
    New-Item -Path $entry.KeyPath -Force | Out-Null
    Set-ItemProperty -LiteralPath $entry.KeyPath -Name '(default)' -Value $entry.DisplayName
    if ($entry.Icon) { Set-ItemProperty -LiteralPath $entry.KeyPath -Name 'Icon' -Value $entry.Icon }
    New-Item -Path $cmdKey -Force | Out-Null
    Set-ItemProperty -LiteralPath $cmdKey -Name '(default)' -Value $entry.Command
    Write-Host "OK   $($entry.KeyPath)"
}

function Remove-MenuEntry($entry) {
    if ($WhatIf) { Write-Host "WhatIf: would remove $($entry.KeyPath)"; return }
    if (Test-Path -LiteralPath $entry.KeyPath) {
        Remove-Item -LiteralPath $entry.KeyPath -Recurse -Force
        Write-Host "REMOVED $($entry.KeyPath)"
    } else {
        Write-Host "absent  $($entry.KeyPath)"
    }
}

function Update-UserPath {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $segments = @()
    if ($userPath) { $segments = $userPath -split ';' | Where-Object { $_ -ne '' } }
    $present = $segments | Where-Object { $_.TrimEnd('\') -ieq $here.TrimEnd('\') }
    if ($Uninstall) {
        if (-not $present) { Write-Host "PATH: $here not present (skip)"; return }
        if ($WhatIf) { Write-Host "WhatIf: would remove $here from User PATH"; return }
        $new = ($segments | Where-Object { $_.TrimEnd('\') -ine $here.TrimEnd('\') }) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $new, 'User')
        Write-Host "PATH: removed $here"
    } else {
        if ($present) { Write-Host "PATH: $here already present (skip)"; return }
        if ($WhatIf) { Write-Host "WhatIf: would prepend $here to User PATH"; return }
        $new = if ($userPath) { "$here;$userPath" } else { $here }
        [Environment]::SetEnvironmentVariable('Path', $new, 'User')
        Write-Host "PATH: added $here"
    }
}

if ($Uninstall) {
    Write-Host "=== ShareGuard windows_gui uninstall ==="
    foreach ($e in $entries) { Remove-MenuEntry $e }
    Update-UserPath
    Write-Host ""
    Write-Host "Done. Sign out / sign back in (or restart Explorer) for context menu changes to take effect."
} else {
    Write-Host "=== ShareGuard windows_gui install ==="
    Write-Host "pwsh: $pwshExe"
    Write-Host "scripts under: $here"
    Write-Host ""
    foreach ($e in $entries) { Set-MenuEntry $e }
    Update-UserPath
    Write-Host ""
    Write-Host "Done. Restart Explorer (taskkill /f /im explorer.exe & start explorer) or sign out/in to see context menu entries."
    Write-Host "New shell needed to pick up updated PATH."
}
