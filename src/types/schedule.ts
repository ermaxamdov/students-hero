/**
 * Domain types for Auto Zoom Scheduler.
 *
 * A schedule is shared between the dashboard and local Node worker. The UI
 * mirrors user edits in localStorage; the worker persists sync/task state
 * separately so Windows automation can run without the dashboard open.
 */

/** How often a schedule should fire. */
export type RepeatMode = 'once' | 'daily' | 'weekdays' | 'custom'

/**
 * Day-of-week index as returned by `Date.prototype.getDay()`:
 * 0 = Sunday ... 6 = Saturday.
 */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Where a schedule came from.
 * `manual` schedules are created by the user and are NEVER touched by syncing.
 */
export type ScheduleSource = 'manual' | 'elms'

export interface Schedule {
  id: string
  /** Optional human label, e.g. "English Lesson". */
  name: string
  /** The meeting link that gets opened, e.g. a Zoom join URL. */
  url: string
  /** Local wall-clock time in 24h `HH:mm` format, e.g. "07:00". */
  time: string
  repeat: RepeatMode
  /**
   * Only meaningful when `repeat === 'custom'`.
   * Day indices (0-6) on which the schedule should fire.
   */
  days?: WeekdayIndex[]
  /** When false the schedule is never opened automatically. */
  enabled: boolean
  /**
   * ISO timestamp of the last automatic (or manual "run now") execution.
   * Used to guarantee a schedule never fires twice for the same minute/day.
   */
  lastRun?: string

  /* ---- Sync provenance (absent on older records => treated as manual) ---- */

  /** Defaults to `manual` when missing, which keeps pre-sync data working. */
  source?: ScheduleSource
  /**
   * Stable identity of the originating ELMS lesson.
   * The real ELMS timetable has no lesson ids, so this is derived from
   * weekday + time + subject (see server/elmsCore.ts).
   */
  sourceLessonId?: string
  /** Subject name exactly as ELMS reports it, used for reconciliation. */
  sourceSubject?: string
  /** ISO timestamp of the sync that last wrote this schedule. */
  syncedAt?: string
  /**
   * Set when a previously imported lesson vanished from the ELMS timetable.
   * Such schedules are kept (never silently deleted) but flagged for review.
   */
  stale?: boolean
}

/** Treats legacy records without `source` as manual. */
export function scheduleSource(schedule: Schedule): ScheduleSource {
  return schedule.source === 'elms' ? 'elms' : 'manual'
}

/** The shape of the form used for both creating and editing a schedule. */
export interface ScheduleFormValues {
  name: string
  url: string
  time: string
  repeat: RepeatMode
  days: WeekdayIndex[]
}

export const REPEAT_LABELS: Record<RepeatMode, string> = {
  once: 'Once',
  daily: 'Every day',
  weekdays: 'Every weekday',
  custom: 'Custom days',
}

/** Short day labels indexed by `Date.getDay()`. */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const WEEKDAY_INDEXES: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6]
