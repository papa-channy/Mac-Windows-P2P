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
