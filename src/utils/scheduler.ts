/**
 * Core scheduling logic.
 *
 * Everything here works with the *local system time* of the machine running
 * the browser (never UTC), because the user types a wall-clock time like
 * "07:00" and expects it to mean 07:00 on their own computer.
 *
 * The functions are pure so they can be reasoned about (and tested) without a
 * running React tree: `App.tsx` simply calls `findDueSchedules()` on every
 * timer tick and opens whatever comes back.
 */

import type { Schedule, WeekdayIndex } from '../types/schedule'

/**
 * How long after the scheduled moment we are still allowed to fire.
 *
 * 60s == "only inside the scheduled minute". So 06:59 does nothing, 07:00
 * fires, and by 07:01 the window is closed. This also gives background tabs
 * (whose timers get throttled to roughly one tick per minute) a fair chance
 * to still catch the occurrence.
 */
export const TRIGGER_WINDOW_MS = 60_000

/** Parse an `HH:mm` string into hours/minutes. Returns null when invalid. */
export function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

/** Build a local `Date` for `time` on the same calendar day as `base`. */
function atTimeOnDay(base: Date, time: string, dayOffset = 0): Date | null {
  const parsed = parseTime(time)
  if (!parsed) return null
  const date = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    parsed.hours,
    parsed.minutes,
    0,
    0,
  )
  return date
}

/** Does the repeat rule allow this schedule to fire on the given date? */
export function runsOnDay(schedule: Schedule, date: Date): boolean {
  const day = date.getDay() as WeekdayIndex
  switch (schedule.repeat) {
    case 'once':
    case 'daily':
      // "once" can fire on any day - it simply disables itself afterwards.
      return true
    case 'weekdays':
      return day >= 1 && day <= 5
    case 'custom':
      return (schedule.days ?? []).includes(day)
    default:
      return false
  }
}

/**
 * The next moment this schedule is supposed to open, or null when it can never
 * fire again (e.g. "Custom days" with no day selected).
 *
 * `from` defaults to now. An occurrence that has already been executed
 * (tracked via `lastRun`) is skipped, so a daily 07:00 schedule that ran today
 * reports tomorrow 07:00.
 */
export function getNextOccurrence(schedule: Schedule, from: Date = new Date()): Date | null {
  const lastRun = schedule.lastRun ? new Date(schedule.lastRun) : null
  const lastRunMs = lastRun && !Number.isNaN(lastRun.getTime()) ? lastRun.getTime() : null

  // Look at most one week + 1 day ahead; every repeat rule repeats weekly.
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = atTimeOnDay(from, schedule.time, offset)
    if (!candidate) return null
    if (!runsOnDay(schedule, candidate)) continue
    // Must still be in the future...
    if (candidate.getTime() <= from.getTime()) continue
    // ...and must not be an occurrence we already executed.
    if (lastRunMs !== null && lastRunMs >= candidate.getTime()) continue
    return candidate
  }
  return null
}

/**
 * Should this schedule be opened right now?
 *
 * Conditions (all must hold):
 *  1. the schedule is enabled;
 *  2. the repeat rule includes today;
 *  3. `now` sits inside the trigger window that starts at today's scheduled
 *     time (so 07:00:00 - 07:00:59 for a 07:00 schedule);
 *  4. it has not already run for this occurrence - `lastRun` is compared
 *     against today's scheduled moment, which gives us both "not twice in the
 *     same minute" and "only once per day" for free.
 */
export function isDue(schedule: Schedule, now: Date = new Date()): boolean {
  if (!schedule.enabled) return false
  if (!runsOnDay(schedule, now)) return false

  const occurrence = atTimeOnDay(now, schedule.time)
  if (!occurrence) return false

  const elapsed = now.getTime() - occurrence.getTime()
  if (elapsed < 0 || elapsed >= TRIGGER_WINDOW_MS) return false

  if (schedule.lastRun) {
    const lastRun = new Date(schedule.lastRun)
    if (!Number.isNaN(lastRun.getTime()) && lastRun.getTime() >= occurrence.getTime()) {
      return false
    }
  }

  return true
}

/** Every schedule that is due at `now`. */
export function findDueSchedules(schedules: Schedule[], now: Date = new Date()): Schedule[] {
  return schedules.filter((schedule) => isDue(schedule, now))
}

/**
 * Apply the side effects of a schedule having just fired:
 *  - stamp `lastRun` so it cannot fire again for this occurrence;
 *  - a one-time schedule disables itself (it is now "completed").
 */
export function markAsRun(schedule: Schedule, now: Date = new Date()): Schedule {
  return {
    ...schedule,
    lastRun: now.toISOString(),
    enabled: schedule.repeat === 'once' ? false : schedule.enabled,
  }
}

/** True when a one-time schedule has already done its job. */
export function isCompletedOnce(schedule: Schedule): boolean {
  return schedule.repeat === 'once' && !schedule.enabled && Boolean(schedule.lastRun)
}

/** Open a meeting link in a new tab/window. Returns false if blocked. */
export function openMeeting(url: string): boolean {
  try {
    const popup = window.open(url, '_blank')
    if (!popup) return false
    popup.opener = null
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

/** `13_463_000` -> `"03h 44m 23s"`. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const pad = (value: number) => String(value).padStart(2, '0')
  const core = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
  return days > 0 ? `${days}d ${core}` : core
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Whole-day difference between two dates, ignoring the time of day. */
function calendarDayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** `"Tomorrow at 07:00"`, `"Today at 07:00"`, `"Monday at 07:00"`, ... */
export function formatNextOpening(next: Date, now: Date = new Date()): string {
  const time = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
  const diff = calendarDayDiff(now, next)

  if (diff === 0) return `Today at ${time}`
  if (diff === 1) return `Tomorrow at ${time}`
  if (diff < 7) return `${DAY_NAMES[next.getDay()]} at ${time}`
  return `${next.toLocaleDateString()} at ${time}`
}
