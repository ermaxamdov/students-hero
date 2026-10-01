/**
 * Display helpers shared by the redesigned components.
 *
 * Pure formatting only - no scheduling decisions are made here. The actual
 * firing logic stays in utils/scheduler.ts.
 */

import type { Schedule } from '../types/schedule'
import { getNextOccurrence } from './scheduler'

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const DAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** Weekday order for the tab strip: Monday first, Sunday last. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/**
 * Strip the trailing " - Teacher" that ELMS names carry, so the subject and
 * the teacher can be shown on separate lines.
 */
export function splitName(schedule: Schedule): { subject: string; teacher?: string } {
  if (schedule.sourceSubject) {
    const teacher = schedule.name.startsWith(schedule.sourceSubject)
      ? schedule.name.slice(schedule.sourceSubject.length).replace(/^\s*-\s*/, '')
      : undefined
    return { subject: schedule.sourceSubject, teacher: teacher || undefined }
  }
  const separator = schedule.name.indexOf(' - ')
  if (separator > 0) {
    return {
      subject: schedule.name.slice(0, separator),
      teacher: schedule.name.slice(separator + 3),
    }
  }
  return { subject: schedule.name || 'Untitled meeting' }
}

/** "Every day", "Weekdays", "Mon", "Mon, Wed", "Once". */
export function recurrenceLabel(schedule: Schedule): string {
  switch (schedule.repeat) {
    case 'daily':
      return 'Every day'
    case 'weekdays':
      return 'Weekdays'
    case 'once':
      return 'Once'
    case 'custom': {
      const days = schedule.days ?? []
      if (days.length === 0) return 'No days'
      if (days.length === 7) return 'Every day'
      return days
        .slice()
        .sort((a, b) => WEEK_ORDER.indexOf(a as never) - WEEK_ORDER.indexOf(b as never))
        .map((day) => DAY_SHORT[day])
        .join(', ')
    }
    default:
      return ''
  }
}

/** Does this schedule occur on the given weekday? */
export function occursOnWeekday(schedule: Schedule, weekday: number): boolean {
  switch (schedule.repeat) {
    case 'daily':
      return true
    case 'weekdays':
      return weekday >= 1 && weekday <= 5
    case 'custom':
      return (schedule.days ?? []).includes(weekday as never)
    case 'once':
      // A one-off has no weekday identity until it is scheduled; treat the
      // next occurrence's day as its slot.
      return getNextOccurrence(schedule)?.getDay() === weekday
    default:
      return false
  }
}

/** Sort by time of day, then name - the order a timetable reads in. */
export function byTimeThenName(a: Schedule, b: Schedule): number {
  return a.time.localeCompare(b.time) || a.name.localeCompare(b.name)
}

/**
 * The soonest upcoming occurrence across all enabled schedules.
 * Returns null when nothing is scheduled ahead.
 */
export function findNextMeeting(
  schedules: Schedule[],
  now: Date,
): { schedule: Schedule; at: Date } | null {
  let best: { schedule: Schedule; at: Date } | null = null
  for (const schedule of schedules) {
    if (!schedule.enabled) continue
    const at = getNextOccurrence(schedule, now)
    if (!at) continue
    if (!best || at.getTime() < best.at.getTime()) best = { schedule, at }
  }
  return best
}

/** `03h 16m` / `1d 04h` / `42s` - compact, adaptive precision. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')

  if (days > 0) return `${days}d ${pad(hours)}h`
  if (hours > 0) return `${pad(hours)}h ${pad(minutes)}m`
  if (minutes > 0) return `${pad(minutes)}m ${pad(seconds)}s`
  return `${seconds}s`
}

/** "Today at 07:00" / "Tomorrow at 07:00" / "Mon at 07:00". */
export function formatWhen(at: Date, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(at) - startOf(now)) / 86_400_000)
  if (diff === 0) return `Today at ${time}`
  if (diff === 1) return `Tomorrow at ${time}`
  if (diff < 7) return `${DAY_LONG[at.getDay()]} at ${time}`
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)} at ${time}`
}

/** `29.09.2026 05:00`, or a dash when absent/invalid. */
export function formatStamp(iso: string | undefined | null): string {
  if (!iso) return '\u2014'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '\u2014'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Just the clock part of a timestamp: `05:00`. */
export function formatClock(iso: string | undefined | null): string {
  if (!iso) return '\u2014'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '\u2014'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "Today, 03:21" - used for "last synced". */
export function formatRelativeStamp(iso: string | undefined | null, now: Date): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never'
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(now) - startOf(date)) / 86_400_000)
  const clock = formatClock(iso)
  if (diff === 0) return `Today, ${clock}`
  if (diff === 1) return `Yesterday, ${clock}`
  return formatStamp(iso)
}

/** Is this a Zoom link (vs. some other meeting provider)? */
export function isZoom(url: string): boolean {
  return /zoom\.us|zoommtg:/i.test(url)
}

/** Shorten a URL for display: host + a hint of the path. */
export function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.length > 18 ? `${parsed.pathname.slice(0, 18)}\u2026` : parsed.pathname
    return `${parsed.host}${path}`
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}\u2026` : url
  }
}
