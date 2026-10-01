$ErrorActionPreference = 'Stop'

$shutdown = Join-Path $env:WINDIR 'System32\shutdown.exe'
& $shutdown /h
if ($LASTEXITCODE -ne 0) {
    throw "Windows hibernation request failed (shutdown exit code $LASTEXITCODE)."
}
