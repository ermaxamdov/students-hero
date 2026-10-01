$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator privileges are required. Open PowerShell with "Run as administrator" and run this script again.'
}

$tasks = @(
    Get-ScheduledTask -ErrorAction SilentlyContinue |
        Where-Object { $_.TaskName -like 'ZoomWake - *' }
)

foreach ($task in $tasks) {
    Unregister-ScheduledTask `
        -TaskName $task.TaskName `
        -TaskPath $task.TaskPath `
        -Confirm:$false
    Write-Host "Removed '$($task.TaskName)'."
}

if ($tasks.Count -eq 0) {
    Write-Host 'No tasks named "ZoomWake - *" were found.'
}
