$ErrorActionPreference = 'Stop'

$prefixes = @('AutoZoomLaunch_', 'AutoZoomWake_', 'AutoZoom_')
$tasks = Get-ScheduledTask -ErrorAction Stop |
    Where-Object {
        $name = $_.TaskName
        @($prefixes | Where-Object { $name.StartsWith($_) }).Count -gt 0
    }

if (-not $tasks) {
    Write-Host 'No AutoZoom tasks found.'
    exit 0
}

foreach ($task in $tasks) {
    Write-Host "Removing $($task.TaskName)"
    Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false
}

Write-Host 'Zoom automation tasks removed.' -ForegroundColor Green
