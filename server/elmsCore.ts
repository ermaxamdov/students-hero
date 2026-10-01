/**
 * ELMS API client + timetable parsing + reconciliation.
 *
 * Pure logic with no browser or Node-specific APIs beyond `fetch`, so it runs
 * in the worker and is directly unit-testable.
 *
 * ## Verified API contract (checked against a real student account)
 *   POST {api}/auth/login              {username,password} -> result.access_token/.refresh_token
 *   GET  {api}/auth/refresh            Bearer <refresh>    -> result.access_token/.refresh_token
 *   GET  {api}/student/profile/show    -> result[0].activeStudy.semester_id
 *   GET  {api}/student/student-time-tables/{semesterId}
 *
 * ## The timetable is WEEKLY, not dated
 * `result.calendar` is exactly 7 entries:
 *   { week_number: 1..7, week_name: "Dushanba".., subjects: [...] }
 * `week_number` is 1=Monday .. 7=Sunday.
 * Each subject in practice only carries:
 *   { subject, schedule_time: "09:30:00", instructor, zoom_link }
 * There are no dates and no lesson ids, so a lesson's stable identity must be
 * derived from weekday + time + subject.
 */

import type { Schedule, WeekdayIndex } from '../src/types/schedule'
import { EMPTY_COUNTS, type SyncCounts } from '../src/types/sync'

export const ELMS_API_URL = 'https://api-elms.tuit.uz/api'
export const ELMS_API_BASE = 'https://api-elms.tuit.uz/api/student'
const LANGUAGE = 'oz'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface ElmsTokens {
  accessToken: string
  refreshToken: string
  semesterId?: number
  savedAt: string
}

/** A weekly recurring lesson as ELMS actually models it. */
export interface ElmsWeeklyLesson {
  /** Stable synthetic identity: `w{weekday}@{HH:mm}#{subject}`. */
  sourceLessonId: string
  subject: string
  teacher?: string
  /** JS day index, 0=Sunday..6=Saturday (converted from `week_number`). */
  weekday: WeekdayIndex
  /** Local `HH:mm`. */
  startTime: string
  isOnline: boolean
  meetingUrl?: string
  zoomUrl?: string
}

export class ElmsAuthFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ElmsAuthFailure'
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

function get(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function firstOf(source: unknown, keys: readonly string[]): string {
  for (const key of keys) {
    const value = get(source, key)
    if (value !== undefined && value !== null && value !== '') return String(value)
  }
  return ''
}

/** Field fallbacks, taken from the ELMS frontend's own candidate lists. */
const URL_KEYS = [
  'zoom_link',
  'zoomLink',
  'meeting_url',
  'meetingUrl',
  'video_url',
  'online_lesson_url',
  'lesson_url',
  'link',
  'url',
] as const

const TEXT_KEYS = [
  'subject',
  'subject_name',
  'name',
  'title',
  'description',
  'content',
  'body',
  'text',
] as const

const SUBJECT_KEYS = ['subject', 'subject_name', 'name', 'title'] as const
const TEACHER_KEYS = ['instructor', 'teacher_name', 'teacher', 'teacher_fio'] as const
const TIME_KEYS = [
  'schedule_time',
  'start_time',
  'time',
  'lesson_time',
  'begin_time',
  'started_at',
] as const

const pad = (value: number) => String(value).padStart(2, '0')

/** "09:30:00" / "08:00" / "09:30 - 10:50" -> "09:30". */
export function extractTime(raw: string): string {
  if (!raw) return ''
  const match = /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)/.exec(raw)
  return match ? `${pad(Number(match[1]))}:${match[2]}` : ''
}

/**
 * Meeting URL for a lesson: explicit fields first, then a regex scan of text
 * fields. Never fabricates a link - returns '' when ELMS has none.
 */
export function extractMeetingUrl(record: unknown): string {
  const direct = firstOf(record, URL_KEYS).trim()
  if (direct && /^https?:\/\//i.test(direct)) return direct

  const haystack = TEXT_KEYS.map((key) => get(record, key))
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  const zoom = /https?:\/\/[^\s"'<>]*zoom[^\s"'<>]*/i.exec(haystack)
  if (zoom) return zoom[0]
  if (direct) {
    const inside = /https?:\/\/[^\s"'<>]+/i.exec(direct)
    if (inside) return inside[0]
  }
  return ''
}

function isZoomLink(url: string): boolean {
  return /zoom\.us|zoommtg:/i.test(url)
}

/**
 * ELMS `week_number`: 1=Monday .. 7=Sunday.
 * JS `Date.getDay()`:  0=Sunday .. 6=Saturday.
 */
export function weekNumberToWeekday(weekNumber: number): WeekdayIndex | null {
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 7) return null
  return (weekNumber % 7) as WeekdayIndex
}

/* ------------------------------------------------------------------ */
/* Timetable parsing                                                  */
/* ------------------------------------------------------------------ */

export interface ParsedTimetable {
  lessons: ElmsWeeklyLesson[]
  /** Lessons that have a usable meeting link and a valid time. */
  withLinks: ElmsWeeklyLesson[]
  /** Subject names ELMS listed with no meeting link. */
  missingLinkSubjects: string[]
  semesterName?: string
}

export function parseTimetable(payload: unknown): ParsedTimetable {
  const calendar = get(payload, 'result.calendar')
  const days = Array.isArray(calendar) ? calendar : []
  const lessons: ElmsWeeklyLesson[] = []
  const missingLinkSubjects: string[] = []
  const seen = new Set<string>()

  for (const day of days) {
    const subjects = get(day, 'subjects')
    if (!Array.isArray(subjects)) continue

    // Prefer the numeric week_number; fall back to the Uzbek day name.
    const weekday =
      weekNumberToWeekday(Number(get(day, 'week_number'))) ??
      weekdayFromName(String(get(day, 'week_name') ?? ''))
    if (weekday === null) continue

    for (const subject of subjects) {
      const name = firstOf(subject, SUBJECT_KEYS) || 'Dars'
      const startTime = extractTime(firstOf(subject, TIME_KEYS))
      const meetingUrl = extractMeetingUrl(subject)

      if (!meetingUrl) missingLinkSubjects.push(name)

      // Identity must be stable across syncs; ELMS provides no lesson id.
      const sourceLessonId = `w${weekday}@${startTime}#${name}`
      // Guard against ELMS listing the exact same slot twice.
      if (seen.has(sourceLessonId)) continue
      seen.add(sourceLessonId)

      lessons.push({
        sourceLessonId,
        subject: name,
        teacher: firstOf(subject, TEACHER_KEYS) || undefined,
        weekday,
        startTime,
        isOnline: Boolean(meetingUrl),
        meetingUrl: meetingUrl || undefined,
        zoomUrl: meetingUrl && isZoomLink(meetingUrl) ? meetingUrl : undefined,
      })
    }
  }

  const withLinks = lessons.filter((lesson) => Boolean(lesson.meetingUrl) && lesson.startTime !== '')
  const semester = get(payload, 'result.semester.name')

  return {
    lessons,
    withLinks,
    missingLinkSubjects,
    semesterName: typeof semester === 'string' ? semester : undefined,
  }
}

const DAY_NAME_MAP: Record<string, WeekdayIndex> = {
  dushanba: 1,
  seshanba: 2,
  chorshanba: 3,
  payshanba: 4,
  juma: 5,
  shanba: 6,
  yakshanba: 0,
}

function weekdayFromName(name: string): WeekdayIndex | null {
  const key = name.trim().toLowerCase()
  return key in DAY_NAME_MAP ? DAY_NAME_MAP[key] : null
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text.slice(0, 300) }
  }
}

/** Flatten ELMS error messages; 422 returns an object of field errors. */
export function messageOf(body: unknown, fallback: string): string {
  const message = get(body, 'message')
  if (typeof message === 'string' && message !== '') return message
  if (message && typeof message === 'object') {
    const parts: string[] = []
    for (const value of Object.values(message as Record<string, unknown>)) {
      if (typeof value === 'string') parts.push(value)
      else if (Array.isArray(value)) {
        parts.push(...value.filter((item): item is string => typeof item === 'string'))
      }
    }
    if (parts.length > 0) return parts.join(' ')
  }
  return fallback
}

/** Log in with username + password. The password is never logged. */
export async function login(username: string, password: string): Promise<ElmsTokens> {
  const response = await fetch(`${ELMS_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new ElmsAuthFailure(messageOf(body, `ELMS login failed (HTTP ${response.status})`))
  }
  if (get(body, 'result.first_time_login')) {
    throw new ElmsAuthFailure(
      'ELMS requires a first-time password change. Complete it at https://elms.tuit.uz/user/login first.',
    )
  }

  const accessToken = get(body, 'result.access_token')
  const refreshToken = get(body, 'result.refresh_token')
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new ElmsAuthFailure(messageOf(body, 'ELMS returned no access token'))
  }

  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
    savedAt: new Date().toISOString(),
  }
}

/** Swap the refresh token for a fresh pair. Returns null when it fails. */
export async function refresh(tokens: ElmsTokens): Promise<ElmsTokens | null> {
  if (!tokens.refreshToken) return null
  try {
    const response = await fetch(`${ELMS_API_URL}/auth/refresh`, {
      headers: { Authorization: `Bearer ${tokens.refreshToken}` },
    })
    if (!response.ok) return null
    const body = await readJson(response)
    const accessToken = get(body, 'result.access_token')
    if (typeof accessToken !== 'string' || accessToken === '') return null
    const newRefresh = get(body, 'result.refresh_token')
    return {
      ...tokens,
      accessToken,
      refreshToken: typeof newRefresh === 'string' && newRefresh ? newRefresh : tokens.refreshToken,
      savedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Authenticated GET with automatic recovery:
 *   401 -> try refresh token -> retry
 *   still failing -> full re-login with the saved password -> retry
 */
async function authorizedGet(
  path: string,
  ctx: AuthContext,
): Promise<unknown> {
  const attempt = (token: string) =>
    fetch(`${ELMS_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })

  let response = await attempt(ctx.tokens.accessToken)

  if (response.status === 401) {
    const refreshed = await refresh(ctx.tokens)
    if (refreshed) {
      ctx.setTokens(refreshed)
      response = await attempt(refreshed.accessToken)
    }
  }

  if (response.status === 401) {
    // Refresh path exhausted - fall back to a full credential login.
    const relogged = await ctx.relogin()
    ctx.setTokens(relogged)
    response = await attempt(relogged.accessToken)
  }

  const body = await readJson(response)
  if (!response.ok) {
    if (response.status === 401) {
      throw new ElmsAuthFailure(messageOf(body, 'ELMS authentication failed'))
    }
    throw new Error(messageOf(body, `ELMS request failed (HTTP ${response.status})`))
  }
  return body
}

export interface AuthContext {
  tokens: ElmsTokens
  setTokens: (tokens: ElmsTokens) => void
  /** Full username+password login, used when refreshing is not enough. */
  relogin: () => Promise<ElmsTokens>
}

/**
 * Read the active semester id.
 *
 * IMPORTANT: it lives at `result[0].activeStudy.semester_id`, NOT
 * `result[0].semester_id` - verified against a real account.
 */
export async function fetchSemesterId(ctx: AuthContext): Promise<number | null> {
  const body = await authorizedGet(`/profile/show?language=${LANGUAGE}`, ctx)
  const result = get(body, 'result')
  const profile = Array.isArray(result) ? result[0] : result

  for (const path of ['activeStudy.semester_id', 'semester_id', 'active_study.semester_id']) {
    const value = Number(get(profile, path))
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

export async function fetchTimetable(
  ctx: AuthContext,
  semesterId: number,
): Promise<ParsedTimetable> {
  const body = await authorizedGet(`/student-time-tables/${semesterId}?language=${LANGUAGE}`, ctx)
  return parseTimetable(body)
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                     */
/* ------------------------------------------------------------------ */

export const ELMS_ID_PREFIX = 'elms:'

/** Weekly lesson -> the schedule shape the scheduler already understands. */
export function lessonToSchedule(lesson: ElmsWeeklyLesson, now: Date): Schedule {
  const url = lesson.meetingUrl ?? lesson.zoomUrl ?? ''
  return {
    id: `${ELMS_ID_PREFIX}${lesson.sourceLessonId}`,
    name: lesson.teacher ? `${lesson.subject} - ${lesson.teacher}` : lesson.subject,
    url,
    time: lesson.startTime,
    // A weekly class repeats on one weekday.
    repeat: 'custom',
    days: [lesson.weekday],
    enabled: true,
    source: 'elms',
    sourceLessonId: lesson.sourceLessonId,
    sourceSubject: lesson.subject,
    syncedAt: now.toISOString(),
  }
}

export interface ReconcileResult {
  schedules: Schedule[]
  counts: SyncCounts
  /** Human-readable log lines describing what changed. */
  changes: string[]
}

/**
 * Merge freshly fetched lessons into the existing schedule list.
 *
 * Rules (all enforced by tests):
 *  - manual schedules are never read or written;
 *  - new lesson            -> added;
 *  - same url and time     -> untouched (keeps enabled/lastRun);
 *  - url or time changed   -> updated in place, preserving the user's
 *                             `enabled` choice and `lastRun`;
 *  - lesson gone from ELMS -> flagged `stale`, never deleted;
 *  - a stale schedule that reappears is un-flagged.
 */
export function reconcile(
  existing: Schedule[],
  lessons: ElmsWeeklyLesson[],
  now: Date = new Date(),
): ReconcileResult {
  const counts: SyncCounts = { ...EMPTY_COUNTS }
  const changes: string[] = []

  // Manual schedules pass through completely untouched.
  const manual = existing.filter((schedule) => schedule.source !== 'elms')
  const elmsExisting = existing.filter((schedule) => schedule.source === 'elms')
  const byLessonId = new Map<string, Schedule>()
  for (const schedule of elmsExisting) {
    const key = schedule.sourceLessonId ?? schedule.id.replace(ELMS_ID_PREFIX, '')
    byLessonId.set(key, schedule)
  }

  const result: Schedule[] = []
  const handled = new Set<string>()

  for (const lesson of lessons) {
    const fresh = lessonToSchedule(lesson, now)
    const previous = byLessonId.get(lesson.sourceLessonId)
    handled.add(lesson.sourceLessonId)

    if (!previous) {
      result.push(fresh)
      counts.added += 1
      changes.push(`+ ${fresh.name} ${fresh.time}`)
      continue
    }

    const urlChanged = previous.url !== fresh.url
    const timeChanged = previous.time !== fresh.time
    const daysChanged = (previous.days ?? []).join(',') !== (fresh.days ?? []).join(',')
    const wasStale = previous.stale === true

    if (!urlChanged && !timeChanged && !daysChanged && !wasStale) {
      // Nothing changed: keep the existing record exactly as-is so the
      // user's enabled flag and lastRun survive.
      result.push({ ...previous, syncedAt: now.toISOString() })
      counts.unchanged += 1
      continue
    }

    result.push({
      ...fresh,
      // Preserve everything the user controls.
      enabled: previous.enabled,
      // A changed time/url means a genuinely different occurrence, so the
      // old lastRun must not block the new one from firing.
      lastRun: timeChanged || urlChanged ? undefined : previous.lastRun,
      stale: undefined,
    })
    counts.updated += 1
    if (urlChanged) changes.push(`~ ${fresh.name}: link updated`)
    if (timeChanged) changes.push(`~ ${fresh.name}: time ${previous.time} -> ${fresh.time}`)
    if (daysChanged) changes.push(`~ ${fresh.name}: weekday changed`)
    if (wasStale && !urlChanged && !timeChanged) changes.push(`~ ${fresh.name}: back in timetable`)
  }

  // Anything previously imported but absent now is flagged, never deleted.
  for (const [lessonId, schedule] of byLessonId) {
    if (handled.has(lessonId)) continue
    result.push({ ...schedule, stale: true })
    counts.stale += 1
    changes.push(`! ${schedule.name}: no longer in ELMS timetable (kept, marked stale)`)
  }

  return { schedules: [...manual, ...result], counts, changes }
}
