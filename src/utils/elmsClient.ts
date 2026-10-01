/**
 * Client for the real TUIT ELMS API.
 *
 * Endpoints and payload shapes here were taken from the live ELMS frontend
 * bundle, not guessed. See src/types/elms.ts for the summary.
 *
 * The API responds with `Access-Control-Allow-Origin: *` and allows the
 * `authorization` header on preflight, so the browser can talk to it directly
 * with no backend and no proxy. Credentials are sent only to api-elms.tuit.uz.
 */

import {
  ElmsAuthError,
  type ElmsImportResult,
  type ElmsLesson,
  type ElmsLoginResult,
  type ElmsSession,
} from '../types/elms'

/** Auth endpoints live under /api, student data under /api/student. */
export const ELMS_API_URL = 'https://api-elms.tuit.uz/api'
export const ELMS_API_BASE = 'https://api-elms.tuit.uz/api/student'
export const ELMS_LOGIN_PAGE = 'https://elms.tuit.uz/user/login'
/** ELMS serves its own UI in Uzbek by default; keep responses consistent. */
const LANGUAGE = 'oz'

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                   */
/* ------------------------------------------------------------------ */

/** `lodash.get`-style lookup for the dotted paths ELMS uses. */
function get(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** First non-empty value among several candidate keys. */
function firstOf(source: unknown, keys: readonly string[]): string {
  for (const key of keys) {
    const value = get(source, key)
    if (value !== undefined && value !== null && value !== '') {
      return String(value)
    }
  }
  return ''
}

/**
 * Field-name candidates, copied from the ELMS bundle's own fallback lists.
 * ELMS itself tries these in order, which means the API is not consistent
 * across records - so we must be equally tolerant.
 */
const DATE_KEYS = [
  'lesson_date',
  'schedule_date',
  'start_date',
  'date',
  'publish_at',
  'created_at',
  'begin_at',
  'started_at',
] as const

const TIME_KEYS = [
  'schedule_time',
  'start_time',
  'time',
  'lesson_time',
  'begin_time',
  'started_at',
  'begin_at',
  'publish_at',
] as const

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

const TITLE_KEYS = [
  'subject_name',
  'subject',
  'name',
  'title',
  'description',
  'content',
  'body',
  'text',
] as const

const TEACHER_KEYS = ['teacher_name', 'teacher', 'instructor', 'teacher_fio'] as const
const ROOM_KEYS = ['room', 'room_name', 'auditorium', 'auditory', 'cabinet', 'building'] as const
const TYPE_KEYS = ['lesson_type', 'training_type', 'type', 'lesson_type_name', 'category'] as const
const END_TIME_KEYS = ['end_time', 'finish_time', 'ended_at', 'end_at', 'to_time'] as const

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * Extract a local `HH:mm` from the many shapes ELMS uses:
 * "08:30", "08:30:00", "08:30 - 09:50", "2026-09-29 08:30:00", ISO strings.
 */
export function extractTime(raw: string): string {
  if (!raw) return ''
  // A plain time, possibly inside a range like "08:30 - 09:50".
  const direct = /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?/.exec(raw)
  // Prefer a date-time parse when the string clearly carries a date.
  if (/\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4}/.test(raw)) {
    const parsed = parseDateTime(raw)
    if (parsed) return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  }
  if (direct) return `${pad(Number(direct[1]))}:${direct[2]}`
  return ''
}

/** The second time in a range such as "08:30 - 09:50". */
export function extractEndTime(raw: string): string {
  if (!raw) return ''
  const matches = [...raw.matchAll(/([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?/g)]
  if (matches.length < 2) return ''
  const last = matches[matches.length - 1]
  return `${pad(Number(last[1]))}:${last[2]}`
}

/**
 * Parse the date formats ELMS accepts, always in **local** time.
 * Note `new Date('YYYY-MM-DD')` is UTC per spec, which would shift the day for
 * users east of GMT (Uzbekistan is UTC+5), so that form is handled manually.
 */
export function parseDateTime(raw: string): Date | null {
  if (!raw) return null
  const value = raw.trim()

  // YYYY-MM-DD[ HH:mm[:ss]] / YYYY-MM-DDTHH:mm...
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    )
  }

  // DD.MM.YYYY / DD-MM-YYYY, optionally with a time.
  m = /^(\d{2})[.-](\d{2})[.-](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (m) {
    return new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    )
  }

  // Unix seconds / milliseconds.
  if (/^\d{10}$/.test(value)) return new Date(Number(value) * 1000)
  if (/^\d{13}$/.test(value)) return new Date(Number(value))

  const fallback = new Date(value)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** `Date` -> local `YYYY-MM-DD`. */
function toLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Find a meeting link on a lesson record. ELMS checks explicit URL fields
 * first, then regex-scans free-text fields for an embedded zoom link.
 */
export function extractMeetingUrl(record: unknown): string {
  const direct = firstOf(record, URL_KEYS)
  if (direct && /^https?:\/\//i.test(direct.trim())) return direct.trim()

  const haystack = TITLE_KEYS.map((key) => get(record, key))
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  // Prefer an explicit zoom link, then any http(s) link in the text.
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

/** Walk the nested `result.calendar[].subjects[]` structure into flat lessons. */
export function parseTimetable(payload: unknown): ElmsImportResult {
  const calendar = get(payload, 'result.calendar')
  const days = Array.isArray(calendar) ? calendar : []
  const lessons: ElmsLesson[] = []
  let totalLessons = 0

  days.forEach((day, dayIndex) => {
    const subjects = get(day, 'subjects')
    if (!Array.isArray(subjects)) return

    // The date can live on the day wrapper or on each subject.
    const dayDateRaw = firstOf(day, DATE_KEYS)

    subjects.forEach((subject, subjectIndex) => {
      totalLessons += 1

      const dateRaw = firstOf(subject, DATE_KEYS) || dayDateRaw
      const timeRaw = firstOf(subject, TIME_KEYS)
      const parsedDate = parseDateTime(dateRaw)

      // Time may come from a dedicated field or from the date-time itself.
      let startTime = extractTime(timeRaw)
      if (!startTime && parsedDate && /[T ]\d{1,2}:\d{2}/.test(dateRaw)) {
        startTime = `${pad(parsedDate.getHours())}:${pad(parsedDate.getMinutes())}`
      }

      const endTime = extractEndTime(timeRaw) || extractTime(firstOf(subject, END_TIME_KEYS))
      const meetingUrl = extractMeetingUrl(subject)
      const flaggedOnline =
        Boolean(get(subject, 'is_zoom_class')) ||
        Boolean(get(subject, 'is_online')) ||
        Boolean(get(subject, 'online'))

      const id =
        firstOf(subject, ['id', 'lesson_id', 'schedule_id', 'time_table_id']) ||
        `${dayIndex}-${subjectIndex}`

      lessons.push({
        id: String(id),
        subject: firstOf(subject, TITLE_KEYS) || 'Dars',
        teacher: firstOf(subject, TEACHER_KEYS) || undefined,
        date: parsedDate ? toLocalDate(parsedDate) : '',
        startTime,
        endTime: endTime || undefined,
        lessonType: firstOf(subject, TYPE_KEYS) || undefined,
        room: firstOf(subject, ROOM_KEYS) || undefined,
        isOnline: flaggedOnline || Boolean(meetingUrl),
        meetingUrl: meetingUrl || undefined,
        zoomUrl: meetingUrl && isZoomLink(meetingUrl) ? meetingUrl : undefined,
      })
    })
  })

  // Only lessons we can actually schedule: need a link and a start time.
  const withLinks = lessons.filter((lesson) => Boolean(lesson.meetingUrl) && lesson.startTime !== '')

  return { lessons, withLinks, totalLessons }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

/**
 * Pull a human-readable error out of an ELMS response.
 *
 * `message` is usually a string ("Login noto'g'ri"), but validation failures
 * (HTTP 422) return an object of field -> string[] instead, e.g.
 * `{"message":{"password":["The password must be at least 4 characters."]}}`.
 */
function messageOf(body: unknown, fallback: string): string {
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

/**
 * Authenticate against ELMS.
 *
 * Credentials go straight to api-elms.tuit.uz over HTTPS and are never stored
 * or forwarded anywhere else.
 */
export async function elmsLogin(username: string, password: string): Promise<ElmsLoginResult> {
  let response: Response
  try {
    response = await fetch(`${ELMS_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    return {
      kind: 'error',
      message:
        'ELMS serveriga ulanib bo\u2018lmadi. Internet aloqasini tekshiring (yoki ELMS vaqtincha ishlamayotgan bo\u2018lishi mumkin).',
    }
  }

  const body = await readJson(response)

  if (response.status === 401 || response.status === 422) {
    return { kind: 'invalidCredentials', message: messageOf(body, 'Login yoki parol noto\u2018g\u2018ri') }
  }
  if (!response.ok) {
    return { kind: 'error', message: messageOf(body, `ELMS xatosi (HTTP ${response.status})`) }
  }

  // ELMS forces a password change on first login; we must not bypass that.
  if (get(body, 'result.first_time_login')) {
    return { kind: 'firstTimeLogin' }
  }

  const accessToken = get(body, 'result.access_token')
  const refreshToken = get(body, 'result.refresh_token')
  if (typeof accessToken !== 'string' || accessToken === '') {
    return { kind: 'error', message: messageOf(body, 'ELMS token qaytarmadi') }
  }

  return {
    kind: 'ok',
    session: {
      accessToken,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
      savedAt: new Date().toISOString(),
      username,
    },
  }
}

/** Exchange the refresh token for a fresh access token. */
export async function elmsRefresh(session: ElmsSession): Promise<ElmsSession | null> {
  if (!session.refreshToken) return null
  try {
    const response = await fetch(`${ELMS_API_URL}/auth/refresh`, {
      headers: { Authorization: `Bearer ${session.refreshToken}` },
    })
    if (!response.ok) return null
    const body = await readJson(response)
    const accessToken = get(body, 'result.access_token')
    if (typeof accessToken !== 'string' || accessToken === '') return null
    const refreshToken = get(body, 'result.refresh_token')
    return {
      ...session,
      accessToken,
      refreshToken: typeof refreshToken === 'string' && refreshToken ? refreshToken : session.refreshToken,
      savedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Authenticated GET that transparently refreshes the access token once on 401,
 * mirroring what the ELMS frontend does with its axios interceptor.
 */
async function authorizedGet(
  path: string,
  session: ElmsSession,
  onSessionRenewed: (session: ElmsSession) => void,
): Promise<unknown> {
  const request = (token: string) =>
    fetch(`${ELMS_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

  let response: Response
  try {
    response = await request(session.accessToken)
  } catch {
    throw new Error('ELMS serveriga ulanib bo\u2018lmadi.')
  }

  if (response.status === 401) {
    const renewed = await elmsRefresh(session)
    if (!renewed) throw new ElmsAuthError('ELMS sessiyasi tugagan. Qaytadan kiring.')
    onSessionRenewed(renewed)
    response = await request(renewed.accessToken)
    if (response.status === 401) {
      throw new ElmsAuthError('ELMS sessiyasi tugagan. Qaytadan kiring.')
    }
  }

  const body = await readJson(response)
  if (!response.ok) {
    throw new Error(messageOf(body, `ELMS xatosi (HTTP ${response.status})`))
  }
  return body
}

/** Read the student profile to discover the active semester id. */
export async function fetchSemesterId(
  session: ElmsSession,
  onSessionRenewed: (session: ElmsSession) => void,
): Promise<number | null> {
  const body = await authorizedGet(`/profile/show?language=${LANGUAGE}`, session, onSessionRenewed)
  const result = get(body, 'result')
  const profile = Array.isArray(result) ? result[0] : result
  const semesterId = Number(get(profile, 'semester_id'))
  return Number.isFinite(semesterId) && semesterId > 0 ? semesterId : null
}

/** Fetch and normalize the timetable for a semester. */
export async function fetchTimetable(
  session: ElmsSession,
  semesterId: number,
  onSessionRenewed: (session: ElmsSession) => void,
): Promise<ElmsImportResult> {
  const body = await authorizedGet(
    `/student-time-tables/${semesterId}?language=${LANGUAGE}`,
    session,
    onSessionRenewed,
  )
  return parseTimetable(body)
}

/**
 * Full import: resolve the semester (cached on the session) then load lessons.
 *
 * Returns the session that was actually in effect at the end. The access token
 * may have been rotated by the 401-refresh path mid-import, so callers must
 * persist *this* session rather than the one they passed in - otherwise the
 * fresh token is overwritten by the stale one.
 */
export async function importFromElms(
  session: ElmsSession,
  onSessionRenewed: (session: ElmsSession) => void,
): Promise<{ result: ElmsImportResult; semesterId: number; session: ElmsSession }> {
  let current = session
  const track = (renewed: ElmsSession) => {
    current = renewed
    onSessionRenewed(renewed)
  }

  const semesterId = current.semesterId ?? (await fetchSemesterId(current, track))
  if (!semesterId) {
    throw new Error('ELMS profilidan semestr aniqlanmadi.')
  }
  // Re-read `current`: fetchSemesterId may have rotated the token.
  const result = await fetchTimetable(current, semesterId, track)
  return { result, semesterId, session: current }
}
