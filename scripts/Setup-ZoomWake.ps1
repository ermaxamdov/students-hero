$ErrorActionPreference = 'Stop'

$DefaultDurationMinutes = 60
$CloseGraceMinutes = 3
$BackToBackWindowMinutes = 15
$ZoomProcessNamesToClose = @('Zoom', 'CptHost')

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator privileges are required. Open PowerShell with "Run as administrator" and run this script again.'
}

if ($DefaultDurationMinutes -le 0 -or $CloseGraceMinutes -lt 0 -or $BackToBackWindowMinutes -lt 0) {
    throw 'Duration must be positive; close grace and back-to-back window must not be negative.'
}

$root = Split-Path -Parent $PSScriptRoot
$schedulePath = Join-Path $root 'data\sync-store.json'
if (-not (Test-Path -LiteralPath $schedulePath)) {
    throw "AutoZoom schedule store not found: $schedulePath. Run an ELMS sync first."
}

try {
    $store = Get-Content -LiteralPath $schedulePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
} catch {
    throw "Could not read the AutoZoom schedule store at '$schedulePath': $($_.Exception.Message)"
}

$enabledSchedules = @($store.schedules | Where-Object { $_.enabled })
if ($enabledSchedules.Count -eq 0) {
    throw 'The AutoZoom schedule store has no enabled class schedules.'
}
if (@($enabledSchedules | Where-Object { $_.repeat -ne 'custom' }).Count -gt 0) {
    throw 'ZoomWake supports weekly custom-day schedules only; enabled schedules include another recurrence type.'
}

function Get-ScheduleKey([string]$Name, [string]$Start, [string]$Url) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        $content = [Text.Encoding]::UTF8.GetBytes("$Name`n$Start`n$Url")
        return ([BitConverter]::ToString($hash.ComputeHash($content))).Replace('-', '')
    } finally {
        $hash.Dispose()
    }
}

function Get-PowerIndex([string]$Subgroup, [string]$Setting) {
    $output = & $powercfg.Source /qh SCHEME_CURRENT $Subgroup 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read $Setting for $Subgroup (powercfg exit code $LASTEXITCODE)."
    }

    $section = $null
    for ($index = 0; $index -lt $output.Count; $index++) {
        if ($output[$index] -notmatch 'Power Setting GUID:') { continue }
        $end = $index + 1
        while ($end -lt $output.Count -and $output[$end] -notmatch 'Power Setting GUID:') {
            $end++
        }
        $candidate = @($output[$index..($end - 1)])
        if (($candidate -join "`n") -match "GUID Alias:\s*$([regex]::Escape($Setting))\s*") {
            $section = $candidate
            break
        }
    }
    if (-not $section) {
        throw "Could not find $Setting under $Subgroup in the active power plan."
    }

    $acLine = $section | Where-Object { $_ -match 'Current AC Power Setting Index:' } | Select-Object -First 1
    $dcLine = $section | Where-Object { $_ -match 'Current DC Power Setting Index:' } | Select-Object -First 1
    if (-not $acLine -or -not $dcLine) {
        throw "Could not parse AC/DC values for $Setting."
    }

    return [pscustomobject]@{
        AC = [Convert]::ToInt64(([regex]::Match($acLine, '0x([0-9A-Fa-f]+)').Groups[1].Value), 16)
        DC = [Convert]::ToInt64(([regex]::Match($dcLine, '0x([0-9A-Fa-f]+)').Groups[1].Value), 16)
    }
}

function Show-PowerValues([string]$Label) {
    $sleep = Get-PowerIndex -Subgroup 'SUB_SLEEP' -Setting 'STANDBYIDLE'
    $hibernate = Get-PowerIndex -Subgroup 'SUB_SLEEP' -Setting 'HIBERNATEIDLE'
    $wake = Get-PowerIndex -Subgroup 'SUB_SLEEP' -Setting 'RTCWAKE'
    $lid = Get-PowerIndex -Subgroup 'SUB_BUTTONS' -Setting 'LIDACTION'
    Write-Host $Label
    [pscustomobject]@{
        Setting = 'Sleep after (seconds; 0 = Never)'
        AC = $sleep.AC
        DC = $sleep.DC
    }, [pscustomobject]@{
        Setting = 'Hibernate after (seconds)'
        AC = $hibernate.AC
        DC = $hibernate.DC
    }, [pscustomobject]@{
        Setting = 'Allow wake timers (1 = Enable)'
        AC = $wake.AC
        DC = $wake.DC
    }, [pscustomobject]@{
        Setting = 'Lid close action (2 = Hibernate)'
        AC = $lid.AC
        DC = $lid.DC
    } | Format-Table -AutoSize
}

function ConvertTo-LocalWeekdayTime([int]$DayNumber, [datetime]$Time) {
    $dayOffset = [int]($Time.Date - [datetime]'2000-01-02').TotalDays
    $day = ($DayNumber + $dayOffset) % 7
    if ($day -lt 0) { $day += 7 }
    [pscustomobject]@{
        Day = [DayOfWeek]$day
        Time = [datetime]::Today.Add($Time.TimeOfDay)
    }
}

$classesByKey = @{}
$occurrences = New-Object System.Collections.Generic.List[object]
foreach ($schedule in $enabledSchedules) {
    $name = ([string]$schedule.name).Trim()
    $start = [string]$schedule.time
    $url = [string]$schedule.url
    if ([string]::IsNullOrWhiteSpace($name)) {
        throw "Enabled schedule '$($schedule.id)' has no class name."
    }

    $parsedStart = [datetime]::MinValue
    if (-not [datetime]::TryParseExact(
        $start,
        'HH:mm',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::None,
        [ref]$parsedStart
    )) {
        throw "Enabled schedule '$name' has invalid start time '$start'."
    }

    $zoomUri = $null
    if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$zoomUri) -or
        $zoomUri.Scheme -ne 'https' -or $zoomUri.Host -notmatch '(^|\.)zoom\.') {
        throw "Enabled schedule '$name' does not contain a valid HTTPS Zoom meeting link."
    }

    $days = @($schedule.days)
    if ($days.Count -eq 0) {
        throw "Enabled weekly schedule '$name' has no weekdays."
    }

    $classKey = "$name`n$url"
    if (-not $classesByKey.ContainsKey($classKey)) {
        $classesByKey[$classKey] = [pscustomobject]@{
            Name = $name
            ZoomLink = $url
            Occurrences = New-Object System.Collections.Generic.List[object]
        }
    }

    foreach ($day in $days) {
        $dayNumber = 0
        if (-not [int]::TryParse([string]$day, [ref]$dayNumber) -or
            $dayNumber -lt 0 -or $dayNumber -gt 6) {
            throw "Enabled weekly schedule '$name' contains invalid weekday '$day'."
        }

        $occurrenceKey = "$classKey`n$dayNumber`n$start"
        if (@($occurrences | Where-Object { $_.Key -eq $occurrenceKey }).Count -gt 0) {
            continue
        }

        $startTime = [datetime]::ParseExact(
            "2000-01-02 $start",
            'yyyy-MM-dd HH:mm',
            [Globalization.CultureInfo]::InvariantCulture
        )
        $occurrence = [pscustomobject]@{
            Key = $occurrenceKey
            ClassKey = $classKey
            Name = $name
            ZoomLink = $url
            DayNumber = $dayNumber
            StartTime = $startTime
            EndTime = $startTime.AddMinutes($DefaultDurationMinutes)
        }
        $occurrences.Add($occurrence)
        $classesByKey[$classKey].Occurrences.Add($occurrence)
    }
}

$classes = @($classesByKey.Values)
if ($classes.Count -eq 0 -or $occurrences.Count -eq 0) {
    throw 'No enabled weekly Zoom class occurrences were found.'
}

$classNameCounts = @{}
foreach ($class in $classes) {
    if (-not $classNameCounts.ContainsKey($class.Name)) {
        $classNameCounts[$class.Name] = 0
    }
    $classNameCounts[$class.Name]++
}

$taskSettings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
$powerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

function New-WeeklyTriggers($Entries) {
    $triggers = @()
    foreach ($timeGroup in @($Entries | Group-Object -Property { $_.At.ToString('HH:mm') })) {
        $days = @($timeGroup.Group | Select-Object -ExpandProperty Day -Unique)
        $at = [datetime]::Today.Add($timeGroup.Group[0].At.TimeOfDay)
        $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $at
    }
    return $triggers
}

$expectedTaskNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$classTasks = @()
foreach ($class in $classes) {
    $safeName = $class.Name -replace '[\\/:*?"<>|]', '_'
    if ($classNameCounts[$class.Name] -gt 1) {
        $safeName += ' - ' + (Get-ScheduleKey -Name $class.Name -Start '' -Url $class.ZoomLink).Substring(0, 8)
    }
    if ($safeName.Length -gt 215) {
        throw "Class name '$($class.Name)' is too long for a Windows task name."
    }

    $classTasks += [pscustomobject]@{
        Class = $class
        OpenName = "ZoomWake - $safeName - Open"
        CloseName = "ZoomWake - $safeName - Close"
    }
}

$closeEntries = @{}
foreach ($occurrence in $occurrences) {
    $closeAt = $occurrence.EndTime.AddMinutes($CloseGraceMinutes)
    $classStartAt = [datetime]'2000-01-02'
    $currentAbsoluteStart = $classStartAt.AddDays($occurrence.DayNumber).Add($occurrence.StartTime.TimeOfDay)
    $next = @(
        $occurrences |
            Where-Object { $_.Key -ne $occurrence.Key } |
            ForEach-Object {
                $nextStart = $classStartAt.AddDays($_.DayNumber).Add($_.StartTime.TimeOfDay)
                if ($nextStart -le $currentAbsoluteStart) {
                    $nextStart = $nextStart.AddDays(7)
                }
                [pscustomobject]@{ Occurrence = $_; AbsoluteStart = $nextStart }
            } |
            Sort-Object -Property AbsoluteStart |
            Select-Object -First 1
    )
    if ($next.Count -gt 0) {
        $gapMinutes = ($next[0].AbsoluteStart - $currentAbsoluteStart).TotalMinutes - $DefaultDurationMinutes
        if ($gapMinutes -ge 0 -and $gapMinutes -le $BackToBackWindowMinutes) {
            $latestClose = $next[0].AbsoluteStart.AddMinutes(-1)
            if ($latestClose -lt $closeAt) {
                $closeAt = $latestClose
            }
        }
    }

    $localClose = ConvertTo-LocalWeekdayTime -DayNumber $occurrence.DayNumber -Time $closeAt
    $closeEntries[$occurrence.Key] = $localClose
}

$powercfg = Get-Command powercfg.exe -ErrorAction Stop
Show-PowerValues -Label 'Power settings before:'
& $powercfg.Source /hibernate on
if ($LASTEXITCODE -ne 0) {
    throw "Failed to enable hibernation (powercfg exit code $LASTEXITCODE)."
}

function Set-PowerValue([string]$Scheme, [string]$Subgroup, [string]$Setting, [int]$Value) {
    & $powercfg.Source "/set${Scheme}valueindex" SCHEME_CURRENT $Subgroup $Setting $Value
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set $Setting for $Scheme (powercfg exit code $LASTEXITCODE)."
    }
}

foreach ($scheme in @('ac', 'dc')) {
    Set-PowerValue -Scheme $scheme -Subgroup 'SUB_SLEEP' -Setting 'STANDBYIDLE' -Value 0
    Set-PowerValue -Scheme $scheme -Subgroup 'SUB_SLEEP' -Setting 'HIBERNATEIDLE' -Value 600
    Set-PowerValue -Scheme $scheme -Subgroup 'SUB_BUTTONS' -Setting 'LIDACTION' -Value 2
    Set-PowerValue -Scheme $scheme -Subgroup 'SUB_SLEEP' -Setting 'RTCWAKE' -Value 1
}
& $powercfg.Source /setactive SCHEME_CURRENT
if ($LASTEXITCODE -ne 0) {
    throw "Failed to re-apply the active power plan (powercfg exit code $LASTEXITCODE)."
}
Show-PowerValues -Label 'Power settings after:'
Write-Host 'Hibernation enabled with powercfg /hibernate on.'

$legacyTaskNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$legacyRows = @{}
foreach ($schedule in $enabledSchedules) {
    $key = "$($schedule.name)`n$($schedule.time)`n$($schedule.url)"
    $legacyRows[$key] = [pscustomobject]@{
        Name = [string]$schedule.name
        Start = [string]$schedule.time
        Url = [string]$schedule.url
    }
}
foreach ($row in $legacyRows.Values) {
    $safeName = $row.Name -replace '[\\/:*?"<>|]', '_'
    $sameName = @($legacyRows.Values | Where-Object { $_.Name -eq $row.Name })
    $sameNameAndTime = @($legacyRows.Values | Where-Object { $_.Name -eq $row.Name -and $_.Start -eq $row.Start })
    $legacyName = "ZoomWake - $safeName"
    if ($sameName.Count -gt 1) {
        $legacyName += " - $($row.Start.Replace(':', ''))"
    }
    if ($sameNameAndTime.Count -gt 1) {
        $legacyName += ' - ' + (Get-ScheduleKey -Name $row.Name -Start $row.Start -Url $row.Url).Substring(0, 8)
    }
    [void]$legacyTaskNames.Add($legacyName)
}

foreach ($item in $classTasks) {
    $class = $item.Class
    [void]$expectedTaskNames.Add($item.OpenName)
    [void]$expectedTaskNames.Add($item.CloseName)

    $openEntries = @(
        foreach ($occurrence in $class.Occurrences) {
            $openAt = $occurrence.StartTime.AddMinutes(-10)
            $localOpen = ConvertTo-LocalWeekdayTime -DayNumber $occurrence.DayNumber -Time $openAt
            [pscustomobject]@{ Day = $localOpen.Day; At = $localOpen.Time }
        }
    )
    $closeClassEntries = @(
        foreach ($occurrence in $class.Occurrences) {
            $close = $closeEntries[$occurrence.Key]
            [pscustomobject]@{ Day = $close.Day; At = $close.Time }
        }
    )

    $deepLink = $null
    $meetingUri = [Uri]$class.ZoomLink
    $query = [System.Web.HttpUtility]::ParseQueryString($meetingUri.Query)
    $confno = $query['confno']
    if (-not $confno -and $meetingUri.AbsolutePath -match '^/j/(\d+)(?:/|$)') {
        $confno = $Matches[1]
    }
    if ($confno) {
        $deepQuery = @('action=join', "confno=$([Uri]::EscapeDataString($confno))")
        foreach ($queryKey in $query.AllKeys) {
            if (-not $queryKey -or $queryKey -eq 'confno') { continue }
            foreach ($queryValue in $query.GetValues($queryKey)) {
                $deepQuery += "$([Uri]::EscapeDataString($queryKey))=$([Uri]::EscapeDataString($queryValue))"
            }
        }
        $deepLink = 'zoommtg://zoom.us/join?' + ($deepQuery -join '&')
    }

    $escapedHttpsUrl = $class.ZoomLink.Replace("'", "''")
    if ($deepLink) {
        $escapedDeepLink = $deepLink.Replace("'", "''")
        $openCommand = @"
`$meetingUrl = '$escapedHttpsUrl'
try {
    Start-Process -FilePath '$escapedDeepLink' -ErrorAction Stop | Out-Null
    Start-Sleep -Seconds 8
    if (-not (Get-Process -Name Zoom -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath `$meetingUrl -ErrorAction Stop | Out-Null
    }
} catch {
    Start-Process -FilePath `$meetingUrl -ErrorAction Stop | Out-Null
}
"@
    } else {
        $openCommand = "Start-Process -FilePath '$escapedHttpsUrl' -ErrorAction Stop"
    }

    $openPayload = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($openCommand))
    $openAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $openPayload"
    $openTriggers = New-WeeklyTriggers -Entries $openEntries
    Register-ScheduledTask `
        -TaskName $item.OpenName `
        -Action $openAction `
        -Trigger $openTriggers `
        -Settings $taskSettings `
        -Principal $taskPrincipal `
        -Description "Open the Zoom meeting 10 minutes before $($class.Name)." `
        -Force `
        -ErrorAction Stop | Out-Null

    $processNames = ($ZoomProcessNamesToClose | ForEach-Object { "'$($_.Replace("'", "''"))'" }) -join ', '
    $closeCommand = "foreach (`$processName in @($processNames)) { Stop-Process -Name `$processName -Force -ErrorAction SilentlyContinue }"
    $closePayload = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($closeCommand))
    $closeAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $closePayload"
    $closeTriggers = New-WeeklyTriggers -Entries $closeClassEntries
    Register-ScheduledTask `
        -TaskName $item.CloseName `
        -Action $closeAction `
        -Trigger $closeTriggers `
        -Settings $taskSettings `
        -Principal $taskPrincipal `
        -Description "Close Zoom after $($class.Name) ends." `
        -Force `
        -ErrorAction Stop | Out-Null

    Write-Host "Registered or updated Open and Close tasks for '$($class.Name)' ($($class.Occurrences.Count) weekly occurrence(s))."
}

$existingTasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -like 'ZoomWake - *' })
foreach ($task in $existingTasks) {
    if ($task.TaskName -eq 'ZoomWake - TEST') { continue }
    if ($legacyTaskNames.Contains($task.TaskName) -and -not $expectedTaskNames.Contains($task.TaskName)) {
        Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop
        Write-Host "Removed obsolete pre-Open/Close task '$($task.TaskName)'."
    }
}

Write-Host ''
Write-Host "Duration: $DefaultDurationMinutes minutes; close grace: $CloseGraceMinutes minutes; back-to-back window: $BackToBackWindowMinutes minutes."
Write-Host 'Zoom wake tasks and next run times:'
$rows = foreach ($task in @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -like 'ZoomWake - *' } | Sort-Object -Property TaskName)) {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
    [pscustomobject]@{
        TaskName = $task.TaskName
        NextRunTime = $taskInfo.NextRunTime
    }
}
$rows | Format-Table -AutoSize
