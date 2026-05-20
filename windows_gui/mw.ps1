# mw.ps1 — Mac-Window_Share CLI (Windows operator side)
# Parity with mac_gui/mw. Subcommands: mount | umount | status | open | doctor | keep-alive
#
# All commands return 0 on success, non-zero on error.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $Command = ''
)

$ErrorActionPreference = 'Stop'

$SHARE_HOST = if ($env:MW_SHARE_HOST) { $env:MW_SHARE_HOST } else { '192.168.50.1' }
$SHARE_NAME = if ($env:MW_SHARE_NAME) { $env:MW_SHARE_NAME } else { 'Mac-Window_Share' }
$DRIVE      = if ($env:MW_DRIVE)      { $env:MW_DRIVE }      else { 'Z:' }
$LOG_DIR    = if ($env:MW_LOG_DIR)    { $env:MW_LOG_DIR }    else { Join-Path $env:LOCALAPPDATA 'MacWindowShare\Logs' }
$UNC_ROOT   = "\\$SHARE_HOST\$SHARE_NAME"

function Write-MwLog([string]$msg) {
    if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null }
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -LiteralPath (Join-Path $LOG_DIR 'mw.log') -Value $line -Encoding UTF8
}

function Test-PortOpen {
    $r = Test-NetConnection -ComputerName $SHARE_HOST -Port 445 -WarningAction SilentlyContinue
    return [bool]$r.TcpTestSucceeded
}

function Get-MappedShare {
    Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayRoot -eq $UNC_ROOT }
}

function Invoke-Mount {
    $existing = Get-MappedShare
    if ($existing) {
        Write-Host "Already mounted at $($existing.Root) <- $UNC_ROOT"
        Write-MwLog "mount: already mounted at $($existing.Root)"
        return 0
    }
    if (-not (Test-PortOpen)) {
        Write-Error "ERROR: cannot reach ${SHARE_HOST}:445 (10GbE link, firewall, or share offline?)"
        Write-MwLog "mount: port 445 unreachable"
        return 2
    }

    # net use returns 0 on success; will prompt only if no cached creds and no /user passed.
    $out = & net.exe use $DRIVE $UNC_ROOT /persistent:yes 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ERROR: net use failed: $out"
        Write-MwLog "mount: net use failed ($LASTEXITCODE): $out"
        return 3
    }

    $existing = Get-MappedShare
    if ($existing) {
        Write-Host "Mounted at $($existing.Root)"
        Write-MwLog "mount: success ($DRIVE)"
        return 0
    }
    Write-Error "ERROR: net use returned success but drive not visible"
    Write-MwLog "mount: net use ok but drive missing"
    return 3
}

function Invoke-Umount {
    $existing = Get-MappedShare
    if (-not $existing) {
        Write-Host "Not mounted."
        return 0
    }
    $target = $existing.Root
    & net.exe use $target /delete /yes | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Unmounted: $target"
        Write-MwLog "umount: success ($target)"
        return 0
    }
    Write-Error "ERROR: net use /delete failed (exit $LASTEXITCODE)"
    Write-MwLog "umount: failed ($target)"
    return 1
}

function Invoke-Status {
    $mapped = Get-MappedShare
    $mountState = if ($mapped) { "mounted at $($mapped.Root)" } else { 'not mounted' }
    $portState  = if (Test-PortOpen) { 'open' } else { 'closed/unreachable' }

    $direct = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
              Where-Object { $_.IPAddress -like '192.168.50.*' } | Select-Object -First 1
    $myIp     = if ($direct) { $direct.IPAddress } else { 'unassigned (no 192.168.50.x)' }
    $iface    = if ($direct) { $direct.InterfaceAlias } else { 'unknown' }
    $linkSpd  = if ($iface -ne 'unknown') { (Get-NetAdapter -Name $iface -ErrorAction SilentlyContinue).LinkSpeed } else { 'unknown' }

    $diskLine = if ($mapped) {
        $info = Get-PSDrive -Name $mapped.Name
        '  disk:    {0:N1} GB used / {1:N1} GB total ({2:N1} GB free)' -f ($info.Used/1GB), (($info.Used+$info.Free)/1GB), ($info.Free/1GB)
    } else {
        '  disk:    (n/a - not mounted)'
    }

    Write-Host @"
Mac-Window_Share status
-----------------------
  share:   $UNC_ROOT
  mount:   $mountState
  drive:   $DRIVE
  port:    ${SHARE_HOST}:445 $portState
  link:    $iface ($linkSpd)
  my IP:   $myIp
$diskLine
"@
}

function Invoke-Open {
    $r = Invoke-Mount
    if ($r -ne 0) { return $r }
    $mapped = Get-MappedShare
    if ($mapped) { Start-Process explorer.exe -ArgumentList $mapped.Root }
    return 0
}

function Invoke-Doctor {
    Write-Host "=== Mac-Window_Share diagnostics ==="
    Write-Host ""
    Write-Host "[direct-link adapter (expect 192.168.50.x)]"
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like '192.168.50.*' } |
        Format-Table InterfaceAlias, IPAddress, PrefixLength, AddressState -AutoSize
    Write-Host "[network category]"
    Get-NetConnectionProfile -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceAlias -in ((Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.50.*' }).InterfaceAlias) } |
        Format-Table InterfaceAlias, NetworkCategory, IPv4Connectivity -AutoSize
    Write-Host "[ping x3 -> $SHARE_HOST]"
    Test-Connection -ComputerName $SHARE_HOST -Count 3 -ErrorAction SilentlyContinue |
        Format-Table Address, ResponseTime, Status -AutoSize
    Write-Host "[tcp 445]"
    $r = Test-NetConnection -ComputerName $SHARE_HOST -Port 445 -InformationLevel Detailed -WarningAction SilentlyContinue
    Write-Host ("  TcpTestSucceeded={0}  Source={1}  Via={2}" -f $r.TcpTestSucceeded, $r.SourceAddress.IPAddress, $r.InterfaceAlias)
    Write-Host "[mount]"
    $m = Get-MappedShare
    if ($m) { Write-Host "  $($m.Root) <- $($m.DisplayRoot)" } else { Write-Host "  (not mounted; expected drive: $DRIVE)" }
    Write-Host "[smb client config — encryption/signing]"
    (Get-SmbClientConfiguration -ErrorAction SilentlyContinue) | Select-Object EnableSecuritySignature, RequireSecuritySignature, EnableMultiChannel, MaximumConnectionCountPerServer | Format-List
    Write-Host "[recent log: $LOG_DIR\mw.log]"
    $logFile = Join-Path $LOG_DIR 'mw.log'
    if (Test-Path $logFile) { Get-Content -LiteralPath $logFile -Tail 10 } else { Write-Host "  (no log yet)" }
}

function Invoke-KeepAlive {
    # Intended for Task Scheduler. Silent on success, logs on failure.
    if (Get-MappedShare) { return 0 }
    if (-not (Test-PortOpen)) { Write-MwLog "keep-alive: skip, port 445 unreachable"; return 0 }
    Write-MwLog "keep-alive: not mounted, attempting mount"
    Invoke-Mount | Out-Null
}

function Show-Usage {
    Write-Host @"
mw - Mac-Window_Share CLI (Windows)

USAGE
  mw mount        Map the share to a drive letter (idempotent)
  mw umount       Remove the drive mapping
  mw status       Print mount/link/port summary
  mw open         Mount if needed, then open in Explorer
  mw doctor       Detailed network/mount diagnostics
  mw keep-alive   Internal (Task Scheduler): mount if dropped

CONFIG (override via env)
  MW_SHARE_HOST=$SHARE_HOST
  MW_SHARE_NAME=$SHARE_NAME
  MW_DRIVE=$DRIVE
  MW_LOG_DIR=$LOG_DIR
"@
}

switch -Regex ($Command) {
    '^mount$'             { exit (Invoke-Mount) }
    '^(umount|unmount)$'  { exit (Invoke-Umount) }
    '^status$'            { Invoke-Status; exit 0 }
    '^open$'              { exit (Invoke-Open) }
    '^doctor$'            { Invoke-Doctor; exit 0 }
    '^keep-alive$'        { Invoke-KeepAlive; exit 0 }
    '^(|-h|--help|help)$' { Show-Usage; exit 0 }
    default {
        Write-Error "Unknown command: $Command"
        Show-Usage
        exit 64
    }
}
