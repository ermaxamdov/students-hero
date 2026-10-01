<#
.SYNOPSIS
  Register the daily ELMS sync with Windows Task Scheduler.

.DESCRIPTION
  Creates a scheduled task that runs the local Node worker every day at the
  configured time (05:00 by default) in the computer's local timezone.

  The task:
    - runs whether or not a browser or the dev server is open;
    - survives reboots (it is registered with Windows, not with the app);
    - runs on AC or battery;
    - asks Windows to wake the machine from sleep, when the hardware and
      firmware allow it;
    - retries shortly after a failure (e.g. no network right after wake).

  LIMITATION, stated plainly: a scheduled task CANNOT start a PC that is fully
  powered off (shut down or hibernated without wake-armed hardware). If the
  machine is off at 05:00, the sync runs at the next opportunity instead - the
  worker performs a catch-up sync when it next sees that the slot was missed.

.PARAMETER Time
  Daily run time as HH:mm, local. Defaults to the ELMS_SYNC_TIME value in
  .env.local, or 05:00.

.PARAMETER TaskName
  Scheduled task name. Defaults to "AutoZoomScheduler-ElmsSync".
#>

param(
    [string]$Time,
    [string]$TaskName = 'AutoZoomScheduler-ElmsSync'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'dist-server\elms-sync.js'

# ---- Resolve the run time: parameter > .env.local > default ----------------
if (-not $Time) {
    $envFile = Join-Path $root '.env.local'
    if (Test-Path $envFile) {
        $match = Select-String -Path $envFile -Pattern '^\s*ELMS_SYNC_TIME\s*=\s*(\d{2}:\d{2})' |
                 Select-Object -First 1
        if ($match) { $Time = $match.Matches[0].Groups[1].Value }
    }
}
if (-not $Time) { $Time = '05:00' }

if ($Time -notmatch '^([01]\d|2[0-3]):[0-5]\d$') {
    Write-Error "Invalid -Time '$Time'. Use 24-hour HH:mm, e.g. 05:00."
    exit 1
}

# ---- Preconditions --------------------------------------------------------
if (-not (Test-Path $script)) {
    Write-Error "Worker not built: $script`nRun `npm run build:server` first."
    exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error 'node.exe not found on PATH. Install Node.js or add it to PATH.'
    exit 1
}

Write-Host "Node:   $node"
Write-Host "Script: $script"
Write-Host "Time:   $Time (local time)"
Write-Host ''

# ---- Build the task definition -------------------------------------------
# Quote the script path: the project may live under a path containing spaces.
$action = New-ScheduledTaskAction -Execute $node `
                                  -Argument "`"$script`"" `
                                  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -WakeToRun `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

# Run as the current user, only when logged on, so DPAPI CurrentUser
# decryption works and no password needs to be stored in the task.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
                                        -LogonType Interactive `
                                        -RunLevel Limited

# Replace any previous registration so re-running this script is safe.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
                       -Action $action `
                       -Trigger $trigger `
                       -Settings $settings `
                       -Principal $principal `
                       -Description 'Auto Zoom Scheduler: fetch the TUIT ELMS timetable and update Zoom schedules.' | Out-Null

Write-Host "Registered scheduled task '$TaskName'." -ForegroundColor Green
Write-Host ''

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Next run time: $($info.NextRunTime)"
Write-Host ''
Write-Host 'Useful commands:'
Write-Host "  Start now:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Inspect:    Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "  Remove:     npm run elms:uninstall-task"
Write-Host ''
Write-Host 'Note: a scheduled task cannot power on a PC that is fully shut down.' -ForegroundColor Yellow
Write-Host 'If the PC is asleep, Windows will try to wake it (WakeToRun).' -ForegroundColor Yellow
Write-Host 'If it was off, the sync runs at the next opportunity instead.' -ForegroundColor Yellow
