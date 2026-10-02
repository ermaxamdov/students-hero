param(
    [Parameter(Mandatory = $true)] [string]$ScheduleId,
    [Parameter(Mandatory = $true)] [string]$OccurrenceKey,
    [string]$Name = 'Zoom lesson',
    [int]$DelayMinutes = 10,
    [string]$CaptureAt,
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
$screenRoot = Join-Path $dataRoot 'screen'
$occurrencePath = Join-Path $dataDir 'zoom-occurrences.json'

if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}
if (-not (Test-Path $screenRoot)) {
    New-Item -ItemType Directory -Path $screenRoot -Force | Out-Null
}

function Read-OccurrenceState {
    try {
        if (Test-Path -LiteralPath $occurrencePath) {
            $raw = Get-Content -LiteralPath $occurrencePath -Raw -ErrorAction Stop
            if ($raw -and $raw.Trim()) {
                $parsed = $raw | ConvertFrom-Json
                if ($null -eq $parsed) { return @{} }

                $result = @{}
                if ($parsed -is [System.Collections.IDictionary]) {
                    foreach ($key in $parsed.Keys) { $result[$key] = $parsed[$key] }
                    return $result
                }

                foreach ($property in $parsed.PSObject.Properties) {
                    $result[$property.Name] = $property.Value
                }
                return $result
            }
        }
    } catch {
    }
    return @{}
}

function Save-OccurrenceState([hashtable]$Entry) {
    $state = Read-OccurrenceState
    $state[$OccurrenceKey] = [ordered]@{
        occurrenceKey = $OccurrenceKey
        scheduleId = $ScheduleId
        title = $Name
        status = $Entry.status
        screenshotStatus = $Entry.screenshotStatus
        captureType = $Entry.captureType
        reason = $Entry.reason
        screenshotPath = $Entry.screenshotPath
        capturedAt = $Entry.capturedAt
        createdAt = $Entry.createdAt
        delayMinutes = $Entry.delayMinutes
        captureAt = $Entry.captureAt
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }

    $temp = "$occurrencePath.tmp"
    $json = $state | ConvertTo-Json -Depth 10 -Compress
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temp, $json, $utf8NoBom)
    Move-Item -LiteralPath $temp -Destination $occurrencePath -Force
}

function Get-OccurrenceStartTime {
    if ($OccurrenceKey -match '@(.*)$') {
        $iso = $Matches[1]
        try {
            return [DateTime]::Parse($iso)
        } catch {
        }
    }
    return (Get-Date)
}

function Sanitize-FileName([string]$Value) {
    $sanitized = [regex]::Replace($Value, '[^A-Za-z0-9._-]+', '-')
    $sanitized = $sanitized.Trim('-_. ')
    if ([string]::IsNullOrWhiteSpace($sanitized)) { $sanitized = 'zoom-meeting' }
    return $sanitized.Substring(0, [Math]::Min(120, $sanitized.Length))
}

function Capture-FullscreenScreenshot([string]$Destination) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
        return $true
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Capture-WindowScreenshot([IntPtr]$WindowHandle, [string]$Destination) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZoomScreenshotWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
'@

    $rect = New-Object ZoomScreenshotWin32+RECT
    $ok = [ZoomScreenshotWin32]::GetWindowRect($WindowHandle, [ref]$rect)
    if (-not $ok) { return $false }

    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { return $false }

    $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
        return $true
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Find-ZoomWindowHandle {
    $candidates = @()
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        $name = $process.ProcessName
        $title = $process.MainWindowTitle
        $windowHandle = [long]$process.MainWindowHandle
        if ($windowHandle -ne 0 -and (($name -match '^(Zoom|CptHost)$') -or ($title -match 'Zoom'))) {
            $candidates += [IntPtr]$windowHandle
        }
    }
    if ($candidates.Count -eq 0) { return $null }
    return $candidates[0]
}

$occurrenceStart = Get-OccurrenceStartTime
$dateDir = $occurrenceStart.ToString('yyyy-MM-dd')
$targetDir = Join-Path $screenRoot $dateDir
if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }

$occurrenceKeySafe = Sanitize-FileName($OccurrenceKey)
$destination = Join-Path $targetDir "$occurrenceKeySafe.png"
$relativePath = "screen/$dateDir/$occurrenceKeySafe.png"

$current = Read-OccurrenceState
$previous = @{}
if ($current.ContainsKey($OccurrenceKey)) { $previous = $current[$OccurrenceKey] }
$currentTs = (Get-Date).ToUniversalTime().ToString('o')
$launchStatus = $previous.status
if ($launchStatus -notin @('browser-launched', 'windows-launched', 'completed')) {
    Save-OccurrenceState ([ordered]@{
        status = 'missed'
        screenshotStatus = 'missed'
        reason = 'zoom_not_launched'
        screenshotPath = $null
        captureType = $null
        capturedAt = $currentTs
        createdAt = $currentTs
        delayMinutes = $DelayMinutes
        captureAt = if ($CaptureAt) { $CaptureAt } else { $null }
    })
    exit 0
}

$windowHandle = Find-ZoomWindowHandle
$success = $false
$captureType = $null

if ($windowHandle) {
    try {
        $success = Capture-WindowScreenshot -WindowHandle $windowHandle -Destination $destination
        if ($success) { $captureType = 'zoom-window' }
    } catch {
        $success = $false
    }
}

if (-not $success) {
    try {
        $success = Capture-FullscreenScreenshot -Destination $destination
        if ($success) { $captureType = 'desktop-primary-monitor' }
    } catch {
        $success = $false
    }
}

if (-not $success) {
    Save-OccurrenceState ([ordered]@{
        status = 'failed'
        screenshotStatus = 'failed'
        reason = 'capture_failed'
        screenshotPath = $null
        captureType = $null
        capturedAt = $currentTs
        createdAt = $currentTs
        delayMinutes = $DelayMinutes
        captureAt = if ($CaptureAt) { $CaptureAt } else { $null }
    })
    exit 1
}

Save-OccurrenceState ([ordered]@{
    status = 'success'
    screenshotStatus = 'success'
    reason = $null
    screenshotPath = $relativePath
    captureType = $captureType
    capturedAt = $currentTs
    createdAt = $currentTs
    delayMinutes = $DelayMinutes
    captureAt = if ($CaptureAt) { $CaptureAt } else { $null }
})
exit 0
