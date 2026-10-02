param(
    [Parameter(Mandatory = $true)] [string]$ScheduleId,
    [Parameter(Mandatory = $true)] [string]$OccurrenceKey,
    [string]$Name = 'Zoom lesson',
    [string]$Url,
    [string]$StartTime,
    [int]$GraceMinutes = 10,
    [int]$BrowserGraceSeconds = 0,
    [int]$RetryGraceSeconds = 180,
    [int]$MethodWaitSeconds = 5,
    [int]$RetryIntervalSeconds = 10,
    [string]$DataRoot
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dataRoot = if ($DataRoot) { $DataRoot } else { $root }
$resetMarker = Join-Path $dataRoot 'logout.lock'
if (Test-Path -LiteralPath $resetMarker) {
    exit 0
}
$dataDir = Join-Path $dataRoot 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

$logPath = Join-Path $dataDir 'zoom-launch.log'
$historyPath = Join-Path $dataDir 'zoom-launch-history.json'
$occurrencePath = Join-Path $dataDir 'zoom-occurrences.json'

function Write-LaunchLog([string]$Message) {
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "$stamp Occurrence: $OccurrenceKey $Message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Request-SystemAwake {
    if (-not ('AutoZoomPowerRequest' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AutoZoomPowerRequest {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint executionState);
}
'@
    }

    $flags = [uint32]::Parse('80000001', [Globalization.NumberStyles]::HexNumber)
    $result = [AutoZoomPowerRequest]::SetThreadExecutionState($flags)
    if ($result -eq 0) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw [System.ComponentModel.Win32Exception]::new($errorCode, 'Could not keep Windows awake during the Zoom launch.')
    }
}

function Mask-Url([string]$MeetingUrl) {
    if (-not $MeetingUrl) { return '[missing]' }
    return '[meeting-url-masked]'
}

function Read-OccurrenceState {
    try {
        if (Test-Path -LiteralPath $occurrencePath) {
            $raw = Get-Content -LiteralPath $occurrencePath -Raw -ErrorAction Stop
            if ($raw -and $raw.Trim()) { return $raw | ConvertFrom-Json }
        }
    } catch {
        Write-LaunchLog 'Occurrence state: unreadable; fallback remains enabled'
    }
    return [pscustomobject]@{}
}

function Write-OccurrenceState([string]$Status, [string]$Method = '') {
    $state = Read-OccurrenceState
    if ($null -eq $state) { $state = [pscustomobject]@{} }

    $entry = [ordered]@{
        status = $Status
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    if ($Method) { $entry.method = $Method }

    $state | Add-Member -MemberType NoteProperty -Name $OccurrenceKey -Value ([pscustomobject]$entry) -Force
    $tempPath = "$occurrencePath.tmp"
    $json = $state | ConvertTo-Json -Depth 10 -Compress
    [System.IO.File]::WriteAllText($tempPath, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $occurrencePath -Force
}

function Save-LaunchSuccess([string]$Method, [string]$Details = '') {
    $history = @{}
    if (Test-Path -LiteralPath $historyPath) {
        try {
            $raw = Get-Content -LiteralPath $historyPath -Raw -ErrorAction Stop
            if ($raw -and $raw.Trim()) {
                $legacy = $raw | ConvertFrom-Json
                foreach ($property in $legacy.PSObject.Properties) { $history[$property.Name] = $property.Value }
            }
        } catch {
            $history = @{}
        }
    }

    $history[$OccurrenceKey] = [ordered]@{
        method = $Method
        status = 'completed'
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
        details = $Details
    }
    $history | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $historyPath -Encoding UTF8
    Write-OccurrenceState -Status 'completed' -Method $Method
}

function ConvertTo-ZoomDeepLink([string]$MeetingUrl) {
    if (-not $MeetingUrl) { return $null }
    try {
        $uri = [Uri]::new($MeetingUrl)
        $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
        $confno = $query['confno']
        if (-not $confno) {
            $path = $uri.AbsolutePath.Trim('/')
            if ($path -match '^j/(\d+)(?:/.*)?$') { $confno = $Matches[1] }
            elseif ($path -match '^wc/join/(\d+)(?:/.*)?$') { $confno = $Matches[1] }
        }
        if (-not $confno) { return $null }

        $parts = @('action=join', "confno=$([Uri]::EscapeDataString($confno))")
        foreach ($key in $query.AllKeys) {
            if (-not $key -or $key -eq 'confno') { continue }
            foreach ($value in $query.GetValues($key)) {
                $parts += "$([Uri]::EscapeDataString($key))=$([Uri]::EscapeDataString($value))"
            }
        }
        return 'zoommtg://zoom.us/join?' + ($parts -join '&')
    } catch {
        return $null
    }
}

function Get-RegisteredProtocolCommand {
    foreach ($path in @(
        'HKCU:\Software\Classes\zoommtg\shell\open\command',
        'HKLM:\Software\Classes\zoommtg\shell\open\command',
        'HKCR:\zoommtg\shell\open\command'
    )) {
        try {
            $command = (Get-Item -LiteralPath $path -ErrorAction Stop).GetValue('')
            if ($command) { return [Environment]::ExpandEnvironmentVariables([string]$command) }
        } catch {
            continue
        }
    }
    return $null
}

function Get-InstalledBrowserPaths {
    $paths = @()
    $candidates = @('chrome.exe', 'msedge.exe', 'microsoft-edge:')
    foreach ($candidate in $candidates) {
        try {
            $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
            if ($cmd -and $cmd.Source) { $paths += $cmd.Source }
        } catch {
        }
    }

    $common = @(
        (Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
    )
    foreach ($path in $common) {
        if ($path -and (Test-Path -LiteralPath $path)) { $paths += $path }
    }

    return @($paths | Select-Object -Unique)
}

function Find-ZoomDesktopExecutable([string]$ProtocolCommand) {
    foreach ($path in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Zoom.exe',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\Zoom.exe',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\Zoom.exe'
    )) {
        try {
            $candidate = (Get-Item -LiteralPath $path -ErrorAction Stop).GetValue('')
            if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
        } catch {
            continue
        }
    }

    if ($ProtocolCommand) {
        $candidate = $null
        if ($ProtocolCommand -match '^\s*"([^"]+\.exe)"') { $candidate = $Matches[1] }
        elseif ($ProtocolCommand -match '^\s*(.+?\.exe)(?:\s|$)') { $candidate = $Matches[1] }
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    $knownPaths = @(
        (Join-Path $env:APPDATA 'Zoom\bin\Zoom.exe'),
        (Join-Path $env:LOCALAPPDATA 'Zoom\bin\Zoom.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Zoom\bin\Zoom.exe'),
        (Join-Path $env:ProgramFiles 'Zoom\bin\Zoom.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Zoom\bin\Zoom.exe')
    )

    foreach ($base in @((Join-Path $env:APPDATA 'Zoom'), (Join-Path $env:LOCALAPPDATA 'Zoom'))) {
        if (-not $base) { continue }
        try {
            $children = Get-ChildItem -LiteralPath $base -Directory -Filter 'bin*' -ErrorAction SilentlyContinue
            if ($children) {
                foreach ($child in $children) {
                    $knownPaths += (Join-Path $child.FullName 'Zoom.exe')
                }
            }
        } catch {
        }
    }

    foreach ($candidate in $knownPaths) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    return $null
}

function Get-ZoomProcessIds {
    $ids = @()
    try {
        $proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '(?i)^zoom.*\.exe$' }
        if ($proc) { $ids += @($proc | ForEach-Object { [int]$_.ProcessId }) }
    } catch {
    }
    try {
        $proc2 = Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -match '(?i)^zoom.*$' }
        if ($proc2) { $ids += @($proc2 | ForEach-Object { [int]$_.Id }) }
    } catch {
    }
    return @($ids | Select-Object -Unique)
}

function Is-ZoomDetected {
    $known = @{}
    foreach ($id in $baselineZoomProcessIds) { $known[[string]$id] = $true }
    foreach ($id in (Get-ZoomProcessIds)) {
        if (-not $known.ContainsKey([string]$id)) { return $true }
    }
    return $false
}

function Verify-MethodResult(
    [string]$Method,
    [int]$WaitSeconds,
    [switch]$AllowExistingZoom
) {
    $remaining = $WaitSeconds
    while ($remaining -gt 0) {
        Start-Sleep -Seconds 1
        $remaining -= 1
        $detected = if ($AllowExistingZoom) {
            @(Get-ZoomProcessIds).Count -gt 0
        } else {
            Is-ZoomDetected
        }
        if ($detected) {
            Write-LaunchLog "$Method verification succeeded: Zoom Desktop detected"
            return $true
        }
    }
    Write-LaunchLog "$Method verification failed: Zoom not detected within $WaitSeconds seconds"
    return $false
}

function Invoke-MethodA([string]$Url, [int]$WaitSeconds) {
    Write-LaunchLog 'Method A: default browser HTTPS URL'
    try {
        Start-Process -FilePath $Url -ErrorAction Stop | Out-Null
        Write-LaunchLog 'Method A: default browser launch requested'
        return Verify-MethodResult -Method 'Method A' -WaitSeconds $WaitSeconds
    } catch {
        Write-LaunchLog 'Method A failed while requesting the browser launch'
        return $false
    }
}

function Invoke-MethodB([string]$Url, [int]$WaitSeconds) {
    Write-LaunchLog 'Method B: explicit Chrome/Edge browser launch'
    $browserPaths = Get-InstalledBrowserPaths
    foreach ($browser in $browserPaths) {
        try {
            $browserName = Split-Path -Leaf $browser
            Write-LaunchLog "Method B: launching $browserName"
            Start-Process -FilePath $browser -ArgumentList @("$Url") -ErrorAction Stop | Out-Null
            if (Verify-MethodResult -Method 'Method B' -WaitSeconds $WaitSeconds) {
                return $true
            }
        } catch {
            Write-LaunchLog 'Method B failed while requesting the browser launch'
        }
    }
    return $false
}

function Invoke-MethodC([string]$ZoomProtocolUrl, [int]$WaitSeconds) {
    if (-not $ZoomProtocolUrl) {
        Write-LaunchLog 'Method C: skipped (no zoom protocol URL available)'
        return $false
    }

    Write-LaunchLog 'Method C: Zoom protocol launch'
    $allowExistingZoom = @($baselineZoomProcessIds).Count -gt 0
    try {
        Start-Process -FilePath $ZoomProtocolUrl -ErrorAction Stop | Out-Null
        Write-LaunchLog 'Method C: protocol launch requested'
        return Verify-MethodResult `
            -Method 'Method C' `
            -WaitSeconds $WaitSeconds `
            -AllowExistingZoom:$allowExistingZoom
    } catch {
        Write-LaunchLog 'Method C failed while requesting the Zoom protocol launch'
        return $false
    }
}

function Invoke-MethodD([string]$ZoomExe, [int]$WaitSeconds) {
    if (-not $ZoomExe) {
        Write-LaunchLog 'Method D: skipped (Zoom executable not found)'
        return $false
    }

    Write-LaunchLog 'Method D: direct Zoom Desktop launch'
    try {
        Start-Process -FilePath $ZoomExe -ErrorAction Stop | Out-Null
        Write-LaunchLog 'Method D: Zoom executable launch requested'
        return Verify-MethodResult -Method 'Method D' -WaitSeconds $WaitSeconds
    } catch {
        Write-LaunchLog 'Method D failed while requesting the Zoom desktop launch'
        return $false
    }
}

function Invoke-MethodE([string]$Url, [int]$WaitSeconds) {
    Write-LaunchLog 'Method E: GUI automation fallback'
    $browserPaths = Get-InstalledBrowserPaths
    foreach ($browser in $browserPaths) {
        try {
            $browserName = Split-Path -Leaf $browser
            Write-LaunchLog "Method E: opening $browserName to the Zoom URL"
            Start-Process -FilePath $browser -ArgumentList @("$Url") -ErrorAction Stop | Out-Null
            if (Verify-MethodResult -Method 'Method E' -WaitSeconds $WaitSeconds) {
                return $true
            }
        } catch {
            Write-LaunchLog 'Method E failed while requesting the browser launch'
        }
    }
    return $false
}

try {
    Request-SystemAwake
    Write-LaunchLog 'Windows power request: keeping the system awake for the launch chain'
} catch {
    Write-LaunchLog 'Windows power request failed'
    throw
}

Write-LaunchLog 'Windows fallback: checking occurrence state'

if (-not $Url) {
    Write-LaunchLog 'Windows result: failed (meeting URL missing)'
    exit 1
}

if ($StartTime) {
    try {
        $scheduledAt = [DateTimeOffset]::Parse(
            $StartTime,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::None
        ).LocalDateTime
        $now = Get-Date
        $lateMinutes = ($now - $scheduledAt).TotalMinutes
        if ($lateMinutes -gt $GraceMinutes) {
            Write-LaunchLog 'Windows result: missed grace window'
            exit 0
        }
        if ($lateMinutes -lt -1) {
            Write-LaunchLog 'Windows result: task started early'
            exit 0
        }
    } catch {
        Write-LaunchLog 'Windows result: failed (invalid scheduled time)'
        exit 1
    }
}

$state = Read-OccurrenceState
$entry = $state.PSObject.Properties[$OccurrenceKey]
$stateStatus = if ($entry) { [string]$entry.Value.status } else { '' }
Write-LaunchLog "Occurrence state before launch: $stateStatus"
if ($stateStatus -in @('completed', 'failed')) {
    Write-LaunchLog 'Windows fallback: skipped (occurrence already completed or failed)'
    exit 0
}

if ($BrowserGraceSeconds -gt 0) {
    Write-LaunchLog "Windows fallback: waiting $BrowserGraceSeconds seconds for browser result"
    Start-Sleep -Seconds $BrowserGraceSeconds
    $state = Read-OccurrenceState
    $entry = $state.PSObject.Properties[$OccurrenceKey]
    $stateStatus = if ($entry) { [string]$entry.Value.status } else { '' }
    Write-LaunchLog "Occurrence state after grace: $stateStatus"
    if ($stateStatus -in @('completed', 'failed')) {
        Write-LaunchLog 'Windows fallback: skipped (occurrence already completed or failed)'
        exit 0
    }
}

if (Test-Path -LiteralPath $historyPath) {
    try {
        $raw = Get-Content -LiteralPath $historyPath -Raw -ErrorAction Stop
        if ($raw -and $raw.Trim()) {
            $legacy = $raw | ConvertFrom-Json
            if ($legacy -and $legacy.PSObject.Properties[$OccurrenceKey]) {
                Write-LaunchLog 'Windows fallback: skipped (legacy occurrence history exists)'
                exit 0
            }
        }
    } catch {
    }
}

$deepLink = ConvertTo-ZoomDeepLink $Url
$protocolCommand = Get-RegisteredProtocolCommand
$zoomExe = Find-ZoomDesktopExecutable $protocolCommand
$baselineZoomProcessIds = @(Get-ZoomProcessIds)
$deadline = (Get-Date).AddSeconds([Math]::Max(1, $RetryGraceSeconds))
$runIndex = 0
$successfulMethod = $null

Write-LaunchLog "Launch plan: A -> B -> C -> D -> E with retry grace = $RetryGraceSeconds seconds; URL: $(Mask-Url $Url)"

while ((Get-Date) -lt $deadline) {
    $runIndex += 1
    Write-LaunchLog "Attempt $runIndex start"

    $methods = @(
        { Invoke-MethodA -Url $Url -WaitSeconds $MethodWaitSeconds },
        { Invoke-MethodB -Url $Url -WaitSeconds $MethodWaitSeconds },
        { Invoke-MethodC -ZoomProtocolUrl $deepLink -WaitSeconds $MethodWaitSeconds },
        { Invoke-MethodD -ZoomExe $zoomExe -WaitSeconds $MethodWaitSeconds },
        { Invoke-MethodE -Url $Url -WaitSeconds $MethodWaitSeconds }
    )

    foreach ($method in $methods) {
        $result = & $method
        if ($result) {
            $successfulMethod = $method.ToString().Split(':')[0]
            Write-LaunchLog "SUCCESS via $successfulMethod"
            Save-LaunchSuccess -Method $successfulMethod -Details 'Zoom Desktop detected after layered launch verification'
            exit 0
        }
    }

    Write-LaunchLog "Attempt $runIndex finished without Zoom detection; retrying in $RetryIntervalSeconds seconds"
    Start-Sleep -Seconds $RetryIntervalSeconds
}

Write-LaunchLog 'Windows result: failed (all launch methods exhausted within retry grace window)'
Write-OccurrenceState -Status 'failed' -Method 'all-methods'
exit 1
