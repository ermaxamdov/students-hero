param(
    [switch]$NoConfirm
)

$ErrorActionPreference = 'Stop'

$logDir = Join-Path $env:LOCALAPPDATA 'AutoZoomScheduler\logs'
$null = New-Item -ItemType Directory -Path $logDir -Force
$logPath = Join-Path $logDir 'sleep-mode.log'

function Write-Log([string]$Message) {
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "$stamp $Message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

$session = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($session)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Log 'Hibernate requested without elevated privileges; Windows still handled the command if allowed.'
}

Write-Log 'Sleep Mode invoked; hibernate requested.'

try {
    # This is the reliable low-power state that matches the tested wake flow.
    # The shortcut may still be labeled "Sleep Mode", but internally it uses Hibernate.
    & shutdown.exe /h /f
    Write-Log 'shutdown.exe /h /f returned successfully.'
} catch {
    Write-Log "Hibernate failed: $($_.Exception.Message)"
    throw
}

Write-Host 'Auto Zoom Scheduler is entering Hibernate (power-safe wake path).'
