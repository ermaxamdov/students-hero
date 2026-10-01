<#
.SYNOPSIS
  Install or refresh all AutoZoom Windows tasks for upcoming meetings.

.DESCRIPTION
  Reads the current schedules from the worker JSON store, then creates or
  updates one launch task per upcoming meeting occurrence and one wake task
  per enabled ELMS occurrence. Only AutoZoom-owned task prefixes are managed.
#>

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'dist-server\zoom-tasks.js'

if (-not (Test-Path $script)) {
    Write-Error "Zoom task builder not found: $script`nRun npm run build:server first."
    exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error 'node.exe not found on PATH. Install Node.js or add it to PATH.'
    exit 1
}

Write-Host "Node:   $node"
Write-Host "Script: $script"
Write-Host ''

& $node $script --install

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host ''
Write-Host 'Zoom automation tasks are now reconciled.' -ForegroundColor Green
