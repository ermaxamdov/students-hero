<#
.SYNOPSIS
  Encrypt the ELMS password with Windows DPAPI.

.DESCRIPTION
  Prompts for the password and writes it to `elms-credentials.dat`, encrypted
  with DPAPI scoped to CurrentUser. Only the Windows account that ran this
  script, on this machine, can decrypt it - copying the file elsewhere is
  useless to an attacker.

  This is strictly better than the plaintext ELMS_PASSWORD in .env.local.
  Once the file exists the worker prefers it, and ELMS_PASSWORD can be deleted
  from .env.local.

  The password is never echoed, never logged, and never written in plaintext.
#>

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'elms-credentials.dat'

Write-Host 'Encrypting your ELMS password with Windows DPAPI (CurrentUser).'
Write-Host 'It can only be decrypted by this Windows user on this machine.'
Write-Host ''

$secure = Read-Host -AsSecureString 'ELMS password'

# Marshal the SecureString to a plain string only in memory, just long enough
# to encrypt it, then zero the unmanaged buffer.
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($plain)) {
    Write-Error 'Empty password - nothing written.'
    exit 1
}

Add-Type -AssemblyName System.Security
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')

# Clear the plaintext copies from memory as promptly as we can.
[Array]::Clear($bytes, 0, $bytes.Length)
$plain = $null
[GC]::Collect()

[IO.File]::WriteAllText($target, [Convert]::ToBase64String($encrypted))

Write-Host ''
Write-Host "Saved encrypted credentials to: $target" -ForegroundColor Green
Write-Host 'This file is gitignored.'
Write-Host ''
Write-Host 'You can now remove the ELMS_PASSWORD line from .env.local.' -ForegroundColor Yellow
