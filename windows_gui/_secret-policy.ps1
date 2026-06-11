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
    $Name = [System.IO.Path]::GetFileName($Name)
    $n = $Name.ToLower()
    foreach ($pat in $Allow) {
        if ($n -like $pat.ToLower()) { return $null }
    }
    foreach ($pat in $Block) {
        if ($n -like $pat.ToLower()) { return $pat }
    }
    return $null
}
