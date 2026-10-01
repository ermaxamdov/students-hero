/**
 * Reconcile per-occurrence Windows tasks for Zoom launches and ELMS wakeups.
 *
 * Tasks are independent of the browser and worker after registration. Manual
 * schedules retain their existing launch behavior but never receive wake tasks.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Schedule, WeekdayIndex } from '../src/types/schedule'
import { projectRoot } from './config'
import { loadStore } from './store'

export const AUTO_ZOOM_LEGACY_TASK_PREFIX = 'AutoZoom_'
export const AUTO_ZOOM_LAUNCH_TASK_PREFIX = 'AutoZoomLaunch_'
export const AUTO_ZOOM_WAKE_TASK_PREFIX = 'AutoZoomWake_'
export const AUTO_ZOOM_SCREENSHOT_TASK_PREFIX = 'AutoZoomScreenshot_'
const LOOK_AHEAD_DAYS = 56
const DEFAULT_WAKE_OFFSET_MINUTES = 5
const DEFAULT_SCREENSHOT_DELAY_MINUTES = 10
const DEFAULT_GRACE_MINUTES = 10
const BROWSER_GRACE_SECONDS = 15

export interface ZoomTaskSpec {
  name: string
  scheduleId: string
  occurrenceId: string
  title: string
  url: string
  startAt: Date
}

export interface WakeTaskSpec {
  name: string
  occurrenceId: string
  startAt: Date
  meetingAt: Date
}

export interface ScreenshotTaskSpec {
  name: string
  scheduleId: string
  occurrenceId: string
  title: string
  startAt: Date
  delayMinutes: number
}

export interface ZoomTaskReport {
  created: number
  updated: number
  removed: number
  failed: number
  tasks: string[]
}

export interface ZoomTaskRunResult {
  at: string | null
  resultCode: number | null
  state: string | null
}

export interface ZoomTaskDiagnostics {
  queryStatus: 'ok' | 'error'
  error?: string
  launchTaskCount: number | null
  wakeTaskCount: number | null
  screenshotTaskCount: number | null
  expectedLaunchCount: number
  expectedWakeCount: number
  expectedScreenshotCount: number
  ready: boolean | null
  nextWake: { at: string; installed: boolean } | null
  nextLaunch: { at: string; installed: boolean } | null
  nextScreenshot: { at: string; installed: boolean } | null
  lastWakeResult: ZoomTaskRunResult | null
  lastLaunchResult: ZoomTaskRunResult | null
  lastScreenshotResult: ZoomTaskRunResult | null
}

function taskSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'schedule'
}

function scheduleRunsOnDay(schedule: Schedule, date: Date): boolean {
  const day = date.getDay() as WeekdayIndex
  switch (schedule.repeat) {
    case 'once':
    case 'daily':
      return true
    case 'weekdays':
      return day >= 1 && day <= 5
    case 'custom':
      return (schedule.days ?? []).includes(day)
    default:
      return false
  }
}

function atTimeOnDay(base: Date, time: string, dayOffset = 0): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    Number(match[1]),
    Number(match[2]),
    0,
    0,
  )
}

function scheduleOccurrenceId(schedule: Schedule, occurrence: Date): string {
  return `${schedule.id}@${occurrence.toISOString()}`
}

function shouldSkipScheduleOccurrence(schedule: Schedule, occurrence: Date, now: Date): boolean {
  if (occurrence.getTime() <= now.getTime()) return true
  if (schedule.lastRun) {
    const lastRun = new Date(schedule.lastRun)
    if (!Number.isNaN(lastRun.getTime()) && lastRun.getTime() >= occurrence.getTime()) {
      return true
    }
  }
  return false
}

function occurrenceTaskSuffix(schedule: Schedule, occurrence: Date): string {
  return `${taskSlug(schedule.id)}_${occurrence
    .getFullYear()}${String(occurrence.getMonth() + 1).padStart(2, '0')}${String(occurrence.getDate()).padStart(2, '0')}_${String(occurrence.getHours()).padStart(2, '0')}${String(occurrence.getMinutes()).padStart(2, '0')}`
}

export function collectZoomTaskSpecs(schedules: Schedule[], now: Date = new Date()): ZoomTaskSpec[] {
  const byOccurrence = new Map<string, ZoomTaskSpec>()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  for (const schedule of schedules) {
    if (!schedule.enabled || !schedule.url || schedule.stale) continue

    if (schedule.repeat === 'once') {
      for (let dayOffset = 0; dayOffset <= LOOK_AHEAD_DAYS; dayOffset += 1) {
        const occurrence = atTimeOnDay(firstDay, schedule.time, dayOffset)
        if (!occurrence || shouldSkipScheduleOccurrence(schedule, occurrence, now)) continue
        const key = scheduleOccurrenceId(schedule, occurrence)
        byOccurrence.set(key, {
          name: `${AUTO_ZOOM_LAUNCH_TASK_PREFIX}${occurrenceTaskSuffix(schedule, occurrence)}`,
          scheduleId: schedule.id,
          occurrenceId: key,
          title: schedule.name || 'Zoom lesson',
          url: schedule.url,
          startAt: occurrence,
        })
        break
      }
      continue
    }

    for (let dayOffset = 0; dayOffset <= LOOK_AHEAD_DAYS; dayOffset += 1) {
      const base = new Date(
        firstDay.getFullYear(),
        firstDay.getMonth(),
        firstDay.getDate() + dayOffset,
      )
      if (!scheduleRunsOnDay(schedule, base)) continue

      const occurrence = atTimeOnDay(base, schedule.time)
      if (!occurrence || shouldSkipScheduleOccurrence(schedule, occurrence, now)) continue
      const key = scheduleOccurrenceId(schedule, occurrence)
      if (byOccurrence.has(key)) continue
      byOccurrence.set(key, {
        name: `${AUTO_ZOOM_LAUNCH_TASK_PREFIX}${occurrenceTaskSuffix(schedule, occurrence)}`,
        scheduleId: schedule.id,
        occurrenceId: key,
        title: schedule.name || 'Zoom lesson',
        url: schedule.url,
        startAt: occurrence,
      })
    }
  }

  return [...byOccurrence.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

export function collectWakeTaskSpecs(
  schedules: Schedule[],
  wakeOffsetMinutes = DEFAULT_WAKE_OFFSET_MINUTES,
  now: Date = new Date(),
): WakeTaskSpec[] {
  const launches = collectZoomTaskSpecs(schedules, now)
  return launches.flatMap((launch) => {
    const schedule = schedules.find((item) => item.id === launch.scheduleId)
    if (schedule?.source !== 'elms') return []
    const wakeAt = new Date(launch.startAt.getTime() - wakeOffsetMinutes * 60_000)
    if (wakeAt.getTime() <= now.getTime()) return []
    return [{
      name: `${AUTO_ZOOM_WAKE_TASK_PREFIX}${launch.name.slice(AUTO_ZOOM_LAUNCH_TASK_PREFIX.length)}`,
      occurrenceId: launch.occurrenceId,
      startAt: wakeAt,
      meetingAt: launch.startAt,
    }]
  })
}

export function collectScreenshotTaskSpecs(
  schedules: Schedule[],
  screenshotDelayMinutes = DEFAULT_SCREENSHOT_DELAY_MINUTES,
  now: Date = new Date(),
): ScreenshotTaskSpec[] {
  const launches = collectZoomTaskSpecs(schedules, now)
  return launches.flatMap((launch) => {
    const screenshotAt = new Date(launch.startAt.getTime() + screenshotDelayMinutes * 60_000)
    if (screenshotAt.getTime() <= now.getTime()) return []
    return [{
      name: `${AUTO_ZOOM_SCREENSHOT_TASK_PREFIX}${launch.name.slice(AUTO_ZOOM_LAUNCH_TASK_PREFIX.length)}`,
      scheduleId: launch.scheduleId,
      occurrenceId: launch.occurrenceId,
      title: launch.title,
      startAt: screenshotAt,
      delayMinutes: screenshotDelayMinutes,
    }]
  })
}

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          const code = typeof error.code === 'number' ? error.code : 'unknown'
          reject(new Error(`PowerShell task operation failed (exit ${code}).`))
        }
        else resolve(stdout.trim())
      },
    )
  })
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function quoteForCommandLine(value: string): string {
  return /^[A-Za-z0-9_./\\:-]+$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`
}

export function buildZoomLauncherArgument(task: ZoomTaskSpec, scriptPath: string): string {
  const parts = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ScheduleId',
    task.scheduleId,
    '-OccurrenceKey',
    task.occurrenceId,
    '-Name',
    task.title,
    '-Url',
    task.url,
    '-StartTime',
    task.startAt.toISOString(),
    '-GraceMinutes',
    String(DEFAULT_GRACE_MINUTES),
    '-BrowserGraceSeconds',
    String(BROWSER_GRACE_SECONDS),
  ]
  return parts.map((value) => quoteForCommandLine(value)).join(' ')
}

export function buildScreenshotTaskArgument(task: ScreenshotTaskSpec, scriptPath: string): string {
  const parts = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ScheduleId',
    task.scheduleId,
    '-OccurrenceKey',
    task.occurrenceId,
    '-Name',
    task.title,
    '-DelayMinutes',
    String(task.delayMinutes),
    '-CaptureAt',
    task.startAt.toISOString(),
  ]
  return parts.map((value) => quoteForCommandLine(value)).join(' ')
}

function buildWakeTaskArgument(): string {
  return '-NoProfile -NonInteractive -Command exit 0'
}

interface ExistingTask {
  name?: unknown
  execute?: unknown
  arguments?: unknown
  triggerAt?: unknown
  actionCount?: unknown
  triggerCount?: unknown
  wakeToRun?: unknown
  startWhenAvailable?: unknown
  allowStartIfOnBatteries?: unknown
  dontStopIfGoingOnBatteries?: unknown
  logonType?: unknown
}

interface RequiredTask {
  startAt: Date
  execute: string
  arguments: string
  description: string
  kind: 'launch' | 'wake' | 'screenshot'
}

async function getExistingManagedTasks(): Promise<Map<string, ExistingTask>> {
  const command = [
    '$ErrorActionPreference = "Stop";',
    `$launchPrefix = ${quotePowerShellString(AUTO_ZOOM_LAUNCH_TASK_PREFIX)};`,
    `$wakePrefix = ${quotePowerShellString(AUTO_ZOOM_WAKE_TASK_PREFIX)};`,
    `$screenshotPrefix = ${quotePowerShellString(AUTO_ZOOM_SCREENSHOT_TASK_PREFIX)};`,
    `$legacyPrefix = ${quotePowerShellString(AUTO_ZOOM_LEGACY_TASK_PREFIX)};`,
    '$tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName.StartsWith($launchPrefix) -or $_.TaskName.StartsWith($wakePrefix) -or $_.TaskName.StartsWith($screenshotPrefix) -or $_.TaskName.StartsWith($legacyPrefix) } | ForEach-Object {',
    '  $action = if ($_.Actions.Count -gt 0) { $_.Actions[0] } else { $null };',
    '  $triggerAt = $null;',
    '  if ($_.Triggers.Count -gt 0 -and $_.Triggers[0].StartBoundary) { $triggerAt = ([DateTime]::Parse($_.Triggers[0].StartBoundary)).ToUniversalTime().ToString("o") };',
    '  [pscustomobject]@{ name = $_.TaskName; execute = if ($action) { [string]$action.Execute } else { "" }; arguments = if ($action) { [string]$action.Arguments } else { "" }; actionCount = $_.Actions.Count; triggerCount = $_.Triggers.Count; triggerAt = $triggerAt; wakeToRun = [bool]$_.Settings.WakeToRun; startWhenAvailable = [bool]$_.Settings.StartWhenAvailable; allowStartIfOnBatteries = -not [bool]$_.Settings.DisallowStartIfOnBatteries; dontStopIfGoingOnBatteries = -not [bool]$_.Settings.StopIfGoingOnBatteries; logonType = [string]$_.Principal.LogonType }',
    '});',
    '[Console]::Out.Write((ConvertTo-Json -InputObject $tasks -Compress))',
  ].join(' ')
  const raw = await runPowerShell(command)
  if (!raw) return new Map()
  const parsed = JSON.parse(raw) as ExistingTask | ExistingTask[]
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return new Map(
    entries
      .filter((entry) => typeof entry.name === 'string')
      .map((entry) => [entry.name as string, entry]),
  )
}

export function managedTaskNeedsUpdate(existing: ExistingTask, required: RequiredTask): boolean {
  const actualTriggerAt = typeof existing.triggerAt === 'string'
    ? Date.parse(existing.triggerAt)
    : Number.NaN
  const triggerMatches = Number.isFinite(actualTriggerAt) &&
    Math.abs(actualTriggerAt - required.startAt.getTime()) < 1000
  const logonType = typeof existing.logonType === 'string'
    ? existing.logonType.toLowerCase()
    : ''
  const interactiveLogon = logonType === 'interactive' || logonType === 'interactivetoken'

  return existing.execute !== required.execute ||
    existing.arguments !== required.arguments ||
    existing.actionCount !== 1 ||
    existing.triggerCount !== 1 ||
    !triggerMatches ||
    existing.wakeToRun !== true ||
    existing.startWhenAvailable !== true ||
    existing.allowStartIfOnBatteries !== true ||
    existing.dontStopIfGoingOnBatteries !== true ||
    !interactiveLogon
}

function deleteTask(taskName: string): Promise<string> {
  const command = [
    '$ErrorActionPreference = "Stop";',
    `$taskName = ${quotePowerShellString(taskName)};`,
    '$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;',
    'if ($null -ne $existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop };',
    '"ok"',
  ].join(' ')
  return runPowerShell(command)
}

function ensureTask(
  taskName: string,
  startAt: Date,
  argumentsValue: string,
  description: string,
): Promise<string> {
  const command = [
    '$ErrorActionPreference = "Stop";',
    `$taskName = ${quotePowerShellString(taskName)};`,
    `$triggerTime = [DateTime]::Parse(${quotePowerShellString(startAt.toISOString())});`,
    `$action = New-ScheduledTaskAction -Execute ${quotePowerShellString('powershell.exe')} -Argument ${quotePowerShellString(argumentsValue)};`,
    '$trigger = New-ScheduledTaskTrigger -Once -At $triggerTime;',
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 90) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -RunOnlyIfIdle:$false -RunOnlyIfNetworkAvailable:$false -MultipleInstances IgnoreNew;',
    '$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited;',
    `$description = ${quotePowerShellString(description)};`,
    '$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;',
    'if ($null -ne $existing) {',
    '  try { Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -ErrorAction Stop | Out-Null; "updated"; exit 0 }',
    '  catch {',
    '    $notFound = $_.Exception.HResult -eq -2147024894 -or $_.FullyQualifiedErrorId -match "0x80070002";',
    '    if (-not $notFound) {',
    '      try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop }',
    '      catch { if ($_.Exception.HResult -ne -2147024894 -and $_.FullyQualifiedErrorId -notmatch "0x80070002") { throw } }',
    '    }',
    '  }',
    '}',
    'Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force -ErrorAction Stop | Out-Null;',
    '"ok"',
  ].join(' ')
  return runPowerShell(command)
}

let reconciliationQueue: Promise<void> = Promise.resolve()

export function reconcileZoomLaunchTasks(
  schedules: Schedule[],
  now: Date = new Date(),
  wakeOffsetMinutes = DEFAULT_WAKE_OFFSET_MINUTES,
  screenshotDelayMinutes = DEFAULT_SCREENSHOT_DELAY_MINUTES,
): Promise<ZoomTaskReport> {
  const current = reconciliationQueue.then(() =>
    reconcileZoomTasksNow(schedules, now, wakeOffsetMinutes, screenshotDelayMinutes))
  reconciliationQueue = current.then(() => undefined, () => undefined)
  return current
}

async function reconcileZoomTasksNow(
  schedules: Schedule[],
  now: Date,
  wakeOffsetMinutes: number,
  screenshotDelayMinutes: number,
): Promise<ZoomTaskReport> {
  const launches = collectZoomTaskSpecs(schedules, now)
  const wakes = collectWakeTaskSpecs(schedules, wakeOffsetMinutes, now)
  const screenshots = collectScreenshotTaskSpecs(schedules, screenshotDelayMinutes, now)
  let existing: Map<string, ExistingTask>
  try {
    existing = await getExistingManagedTasks()
  } catch {
    return { created: 0, updated: 0, removed: 0, failed: 1, tasks: [...launches, ...wakes].map((task) => task.name) }
  }

  const launchScript = join(projectRoot(), 'scripts', 'launch-zoom-task.ps1')
  const screenshotScript = join(projectRoot(), 'scripts', 'take-zoom-screenshot.ps1')
  if (launches.length > 0 && !existsSync(launchScript)) {
    return { created: 0, updated: 0, removed: 0, failed: launches.length, tasks: [...launches, ...wakes, ...screenshots].map((task) => task.name) }
  }
  if (screenshots.length > 0 && !existsSync(screenshotScript)) {
    return { created: 0, updated: 0, removed: 0, failed: screenshots.length, tasks: [...launches, ...wakes, ...screenshots].map((task) => task.name) }
  }

  const required = new Map<string, RequiredTask>()
  for (const task of launches) {
    required.set(task.name, {
      startAt: task.startAt,
      execute: 'powershell.exe',
      arguments: buildZoomLauncherArgument(task, launchScript),
      description: 'Auto Zoom launch for one meeting occurrence',
      kind: 'launch',
    })
  }
  for (const task of wakes) {
    required.set(task.name, {
      startAt: task.startAt,
      execute: 'powershell.exe',
      arguments: buildWakeTaskArgument(),
      description: 'Auto Zoom wake for one ELMS meeting occurrence',
      kind: 'wake',
    })
  }
  for (const task of screenshots) {
    required.set(task.name, {
      startAt: task.startAt,
      execute: 'powershell.exe',
      arguments: buildScreenshotTaskArgument(task, screenshotScript),
      description: 'Auto Zoom screenshot for one meeting occurrence',
      kind: 'screenshot',
    })
  }

  let created = 0
  let updated = 0
  let removed = 0
  let failed = 0
  const successfulNames = new Set<string>()
  const operations: Array<() => Promise<void>> = []

  for (const [taskName, spec] of required) {
    const currentTask = existing.get(taskName)
    const isExisting = currentTask !== undefined
    if (currentTask && !managedTaskNeedsUpdate(currentTask, spec)) {
      successfulNames.add(taskName)
      continue
    }
    operations.push(async () => {
      await ensureTask(
        taskName,
        spec.startAt,
        spec.arguments,
        spec.description,
      )
      successfulNames.add(taskName)
      if (isExisting) updated += 1
      else created += 1
    })
  }

  for (let offset = 0; offset < operations.length; offset += 8) {
    const batch = operations.slice(offset, offset + 8)
    const results = await Promise.allSettled(batch.map((operation) => operation()))
    failed += results.filter((result) => result.status === 'rejected').length
  }

  for (const taskName of existing.keys()) {
    if (required.has(taskName)) continue
    const isLegacyLaunch = taskName.startsWith(AUTO_ZOOM_LEGACY_TASK_PREFIX)
    // Keep old launch tasks until replacement launch tasks have all been
    // installed successfully, avoiding a gap during an interrupted upgrade.
    if (isLegacyLaunch && launches.some((task) => !successfulNames.has(task.name))) continue
    try {
      await deleteTask(taskName)
      removed += 1
    } catch {
      failed += 1
    }
  }

  return {
    created,
    updated,
    removed,
    failed,
    tasks: [...required.keys()],
  }
}

interface TaskQueryEntry {
  name?: unknown
  state?: unknown
  lastRun?: unknown
  lastResult?: unknown
  triggerAt?: unknown
  wakeToRun?: unknown
  startWhenAvailable?: unknown
  allowStartIfOnBatteries?: unknown
  dontStopIfGoingOnBatteries?: unknown
  logonType?: unknown
}

function parseTaskEntries(raw: string): TaskQueryEntry[] {
  if (!raw) return []
  const parsed = JSON.parse(raw) as TaskQueryEntry | TaskQueryEntry[] | null
  if (parsed === null) return []
  return Array.isArray(parsed) ? parsed : [parsed]
}

function latestTaskResult(entries: TaskQueryEntry[], prefix: string): ZoomTaskRunResult | null {
  const candidates = entries
    .filter((entry) =>
      typeof entry.name === 'string' &&
      (entry.name as string).startsWith(prefix) &&
      typeof entry.lastRun === 'string' &&
      typeof entry.lastResult === 'number',
    )
    .sort((a, b) => Date.parse(b.lastRun as string) - Date.parse(a.lastRun as string))
  const latest = candidates[0]
  if (!latest) return null
  return {
    at: latest.lastRun as string,
    resultCode: latest.lastResult as number,
    state: typeof latest.state === 'string' ? latest.state : null,
  }
}

export async function getZoomTaskDiagnostics(
  schedules: Schedule[],
  wakeOffsetMinutes = DEFAULT_WAKE_OFFSET_MINUTES,
  now: Date = new Date(),
  screenshotDelayMinutes = DEFAULT_SCREENSHOT_DELAY_MINUTES,
): Promise<ZoomTaskDiagnostics> {
  const launches = collectZoomTaskSpecs(schedules, now)
  const wakes = collectWakeTaskSpecs(schedules, wakeOffsetMinutes, now)
  const screenshots = collectScreenshotTaskSpecs(schedules, screenshotDelayMinutes, now)
  let entries: TaskQueryEntry[]
  try {
    const command = [
      '$ErrorActionPreference = "Stop";',
      `$launchPrefix = ${quotePowerShellString(AUTO_ZOOM_LAUNCH_TASK_PREFIX)};`,
      `$wakePrefix = ${quotePowerShellString(AUTO_ZOOM_WAKE_TASK_PREFIX)};`,
      `$screenshotPrefix = ${quotePowerShellString(AUTO_ZOOM_SCREENSHOT_TASK_PREFIX)};`,
      '$tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName.StartsWith($launchPrefix) -or $_.TaskName.StartsWith($wakePrefix) -or $_.TaskName.StartsWith($screenshotPrefix) });',
      '$result = @($tasks | ForEach-Object {',
      '  $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction Stop;',
      '  $lastRun = $null;',
      '  if ($info.LastRunTime -gt [DateTime]"2000-01-01" -and $info.LastTaskResult -ne 267011) { $lastRun = $info.LastRunTime.ToUniversalTime().ToString("o") };',
      '  $triggerAt = $null;',
      '  if ($_.Triggers.Count -gt 0 -and $_.Triggers[0].StartBoundary) { $triggerAt = ([DateTime]::Parse($_.Triggers[0].StartBoundary)).ToUniversalTime().ToString("o") };',
      '  [pscustomobject]@{ name = $_.TaskName; state = [string]$_.State; lastRun = $lastRun; lastResult = [long]$info.LastTaskResult; triggerAt = $triggerAt; wakeToRun = [bool]$_.Settings.WakeToRun; startWhenAvailable = [bool]$_.Settings.StartWhenAvailable; allowStartIfOnBatteries = -not [bool]$_.Settings.DisallowStartIfOnBatteries; dontStopIfGoingOnBatteries = -not [bool]$_.Settings.StopIfGoingOnBatteries; logonType = [string]$_.Principal.LogonType }',
      '});',
      '[Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress))',
    ].join(' ')
    entries = parseTaskEntries(await runPowerShell(command))
  } catch {
    return {
      queryStatus: 'error',
      error: 'Windows Task Scheduler query failed.',
      launchTaskCount: null,
      wakeTaskCount: null,
      screenshotTaskCount: null,
      expectedLaunchCount: launches.length,
      expectedWakeCount: wakes.length,
      expectedScreenshotCount: screenshots.length,
      ready: null,
      nextWake: null,
      nextLaunch: null,
      nextScreenshot: null,
      lastWakeResult: null,
      lastLaunchResult: null,
      lastScreenshotResult: null,
    }
  }

  const installed = new Map(entries
    .filter((entry) => typeof entry.name === 'string')
    .map((entry) => [entry.name as string, entry]))
  const isTaskReady = (name: string, expectedAt: Date): boolean => {
    const task = installed.get(name)
    if (!task || task.state === 'Disabled' || typeof task.triggerAt !== 'string') return false
    const triggerAt = Date.parse(task.triggerAt)
    const correctTrigger = Number.isFinite(triggerAt) &&
      Math.abs(triggerAt - expectedAt.getTime()) < 60_000
    const interactive = task.logonType === 'Interactive' || task.logonType === 'InteractiveToken'
    return correctTrigger &&
      task.wakeToRun === true &&
      task.startWhenAvailable === true &&
      task.allowStartIfOnBatteries === true &&
      task.dontStopIfGoingOnBatteries === true &&
      interactive
  }
  const ready = launches.every((task) => isTaskReady(task.name, task.startAt)) &&
    wakes.every((task) => isTaskReady(task.name, task.startAt)) &&
    screenshots.every((task) => isTaskReady(task.name, task.startAt))

  const nextWake = wakes[0]
  const nextLaunch = launches[0]
  const nextScreenshot = screenshots[0]

  return {
    queryStatus: 'ok',
    launchTaskCount: entries.filter((entry) => typeof entry.name === 'string' && (entry.name as string).startsWith(AUTO_ZOOM_LAUNCH_TASK_PREFIX)).length,
    wakeTaskCount: entries.filter((entry) => typeof entry.name === 'string' && (entry.name as string).startsWith(AUTO_ZOOM_WAKE_TASK_PREFIX)).length,
    screenshotTaskCount: entries.filter((entry) => typeof entry.name === 'string' && (entry.name as string).startsWith(AUTO_ZOOM_SCREENSHOT_TASK_PREFIX)).length,
    expectedLaunchCount: launches.length,
    expectedWakeCount: wakes.length,
    expectedScreenshotCount: screenshots.length,
    ready,
    nextWake: nextWake ? { at: nextWake.startAt.toISOString(), installed: isTaskReady(nextWake.name, nextWake.startAt) } : null,
    nextLaunch: nextLaunch ? { at: nextLaunch.startAt.toISOString(), installed: isTaskReady(nextLaunch.name, nextLaunch.startAt) } : null,
    nextScreenshot: nextScreenshot ? { at: nextScreenshot.startAt.toISOString(), installed: isTaskReady(nextScreenshot.name, nextScreenshot.startAt) } : null,
    lastWakeResult: latestTaskResult(entries, AUTO_ZOOM_WAKE_TASK_PREFIX),
    lastLaunchResult: latestTaskResult(entries, AUTO_ZOOM_LAUNCH_TASK_PREFIX),
    lastScreenshotResult: latestTaskResult(entries, AUTO_ZOOM_SCREENSHOT_TASK_PREFIX),
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const store = loadStore('05:00')

  if (args.has('--install')) {
    const result = await reconcileZoomLaunchTasks(
      store.schedules,
      new Date(),
      store.wakeOffsetMinutes,
      store.screenshotDelayMinutes,
    )
    console.log(JSON.stringify({
      required: result.tasks.length,
      created: result.created,
      updated: result.updated,
      removed: result.removed,
      failed: result.failed,
    }, null, 2))
    if (result.failed > 0) process.exitCode = 1
    return
  }

  if (args.has('--remove')) {
    const existing = await getExistingManagedTasks()
    const owned = [...existing.keys()].filter((name) =>
      name.startsWith(AUTO_ZOOM_LAUNCH_TASK_PREFIX) ||
      name.startsWith(AUTO_ZOOM_WAKE_TASK_PREFIX) ||
      name.startsWith(AUTO_ZOOM_LEGACY_TASK_PREFIX))
    const results = await Promise.allSettled(owned.map((taskName) => deleteTask(taskName)))
    if (results.some((result) => result.status === 'rejected')) process.exitCode = 1
    console.log(JSON.stringify({ removed: results.filter((result) => result.status === 'fulfilled').length }))
    return
  }

  console.log(JSON.stringify({
    launchTasks: collectZoomTaskSpecs(store.schedules).map((task) => task.name),
    wakeTasks: collectWakeTaskSpecs(store.schedules, store.wakeOffsetMinutes).map((task) => task.name),
  }, null, 2))
}

const isDirectEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectEntry) {
  main().catch(() => {
    console.error('Zoom task operation failed.')
    process.exitCode = 1
  })
}
