/**
 * Turns ELMS lessons into Auto Zoom Scheduler schedules.
 *
 * Design decisions:
 *  - A lesson is a concrete dated event, so it maps to a `once` schedule.
 *    Weekly repetition is offered separately via `groupWeekly`, which folds
 *    lessons of the same subject+time+weekday into one `custom` schedule.
 *  - Lessons already in the past are skipped: a `once` schedule whose time has
 *    passed would never fire and would only clutter the list.
 *  - Imported schedules keep a stable id derived from the ELMS lesson so that
 *    re-importing updates instead of duplicating.
 */

import type { ElmsLesson } from '../types/elms'
import type { Schedule, WeekdayIndex } from '../types/schedule'

/** Prefix marking a schedule as ELMS-sourced, and making ids collision-free. */
const ELMS_ID_PREFIX = 'elms:'

export function isElmsSchedule(schedule: Schedule): boolean {
  return schedule.id.startsWith(ELMS_ID_PREFIX)
}

/** Human label for a lesson: "Subject (teacher)". */
function lessonName(lesson: ElmsLesson): string {
  const parts = [lesson.subject]
  if (lesson.teacher) parts.push(`- ${lesson.teacher}`)
  return parts.join(' ')
}

/** Local `Date` for the lesson's start moment, or null if unparseable. */
export function lessonStart(lesson: ElmsLesson): Date | null {
  if (!lesson.date || !lesson.startTime) return null
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lesson.date)
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(lesson.startTime)
  if (!dateMatch || !timeMatch) return null
  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  )
}

/**
 * Build one-off schedules, one per dated lesson.
 * `now` lets callers (and tests) control what counts as "in the past".
 */
export function lessonsToSchedules(lessons: ElmsLesson[], now: Date = new Date()): Schedule[] {
  const schedules: Schedule[] = []
  const seen = new Set<string>()

  for (const lesson of lessons) {
    const url = lesson.meetingUrl ?? lesson.zoomUrl
    if (!url || !lesson.startTime) continue

    const start = lessonStart(lesson)
    // Skip lessons that already happened - a past `once` never fires.
    if (!start || start.getTime() <= now.getTime()) continue

    const id = `${ELMS_ID_PREFIX}${lesson.id}@${lesson.date}T${lesson.startTime}`
    if (seen.has(id)) continue
    seen.add(id)

    schedules.push({
      id,
      name: lessonName(lesson),
      url,
      time: lesson.startTime,
      repeat: 'once',
      enabled: true,
    })
  }

  return schedules
}

/**
 * Fold recurring lessons into weekly schedules.
 *
 * Lessons sharing subject + start time + meeting link are grouped, and the
 * weekdays they occur on become a `custom` repeat. This is what a student
 * usually wants: one entry per weekly class rather than one per date.
 */
export function lessonsToWeeklySchedules(
  lessons: ElmsLesson[],
  now: Date = new Date(),
): Schedule[] {
  interface Group {
    lesson: ElmsLesson
    url: string
    days: Set<WeekdayIndex>
    hasFuture: boolean
  }

  const groups = new Map<string, Group>()

  for (const lesson of lessons) {
    const url = lesson.meetingUrl ?? lesson.zoomUrl
    if (!url || !lesson.startTime) continue
    const start = lessonStart(lesson)
    if (!start) continue

    const key = `${lesson.subject}|${lesson.startTime}|${url}`
    const existing = groups.get(key)
    const day = start.getDay() as WeekdayIndex

    if (existing) {
      existing.days.add(day)
      existing.hasFuture = existing.hasFuture || start.getTime() > now.getTime()
    } else {
      groups.set(key, {
        lesson,
        url,
        days: new Set([day]),
        hasFuture: start.getTime() > now.getTime(),
      })
    }
  }

  const schedules: Schedule[] = []
  for (const [key, group] of groups) {
    // Drop classes whose every occurrence is already over (e.g. finished
    // modules) - they would sit disabled-but-never-firing in the list.
    if (!group.hasFuture) continue
    const days = [...group.days].sort((a, b) => a - b)
    schedules.push({
      id: `${ELMS_ID_PREFIX}weekly:${key}`,
      name: lessonName(group.lesson),
      url: group.url,
      time: group.lesson.startTime,
      repeat: 'custom',
      days,
      enabled: true,
    })
  }

  return schedules
}

/**
 * Merge imported schedules into the existing list.
 *
 * Existing entries with the same id are replaced but keep their `enabled`
 * flag and `lastRun`, so a re-import never re-opens a lesson that already
 * fired and never silently re-enables something the user switched off.
 * Manually created schedules are left untouched.
 */
export function mergeSchedules(
  existing: Schedule[],
  imported: Schedule[],
): { merged: Schedule[]; added: number; updated: number } {
  const byId = new Map(existing.map((schedule) => [schedule.id, schedule]))
  let added = 0
  let updated = 0

  for (const schedule of imported) {
    const previous = byId.get(schedule.id)
    if (previous) {
      byId.set(schedule.id, {
        ...schedule,
        enabled: previous.enabled,
        lastRun: previous.lastRun,
      })
      updated += 1
    } else {
      byId.set(schedule.id, schedule)
      added += 1
    }
  }

  return { merged: [...byId.values()], added, updated }
}
