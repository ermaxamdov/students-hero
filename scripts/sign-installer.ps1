param(
    [string]$InstallerPath = (Join-Path $PSScriptRoot '..\installer\output\Setup.exe'),
    [string]$Thumbprint,
    [string]$PfxPath,
    [string]$PfxPassword,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $InstallerPath)) {
    throw "Installer not found at $InstallerPath. Run npm run build:installer first."
}

$cert = $null
if ($PfxPath) {
    if (-not (Test-Path $PfxPath)) {
        throw "PFX certificate not found at $PfxPath"
    }
    $cert = Get-PfxCertificate -FilePath $PfxPath -Password (ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText)
} elseif ($Thumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My -Thumbprint $Thumbprint -ErrorAction SilentlyContinue | Select-Object -First 1
} else {
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq 'CN=Auto Zoom Scheduler Installer' } | Select-Object -First 1
}

if (-not $cert) {
    throw 'No usable code-signing certificate found. Provide a valid -Thumbprint or -PfxPath for a production signing build.'
}

$signtool = @(
    'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe',
    'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe',
    'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22000.0\x64\signtool.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $signtool) {
    throw 'signtool.exe was not found in the installed Windows Kit directories.'
}

$thumb = $cert.Thumbprint
& $signtool sign /fd SHA256 /tr $TimestampUrl /td SHA256 /sha1 $thumb /v $InstallerPath
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Get-AuthenticodeSignature -FilePath $InstallerPath | Format-List SignerCertificate, Status, StatusMessage
