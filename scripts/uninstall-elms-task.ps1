<#
.SYNOPSIS
  Remove the daily ELMS sync scheduled task.
#>

param(
    [string]$TaskName = 'AutoZoomScheduler-ElmsSync'
)

$ErrorActionPreference = 'Stop'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
}
else {
    Write-Host "No scheduled task named '$TaskName' - nothing to do."
}
