/**
 * Types for the TUIT ELMS integration.
 *
 * These mirror the real API at https://api-elms.tuit.uz, which was determined
 * by inspecting the live `elms-student-cabinet` bundle served from
 * https://elms.tuit.uz/time-tables (the page itself is a SPA and contains no
 * timetable data in its HTML).
 *
 *   POST {API_URL}/auth/login            -> { result: { access_token, refresh_token, first_time_login? } }
 *   GET  {API_URL}/auth/refresh          -> { result: { access_token, refresh_token } }   (Bearer = refresh token)
 *   GET  {API_BASE}/profile/show         -> { result: [ { semester_id, ... } ] }
 *   GET  {API_BASE}/student-time-tables/{semesterId} -> { result: { calendar: [ { subjects: [...] } ] } }
 *
 * Auth is a plain Bearer token - no cookies, no CSRF, no CAPTCHA.
 */

/** A single lesson normalized out of the ELMS timetable payload. */
export interface ElmsLesson {
  id: string
  subject: string
  teacher?: string
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string
  /** Local start time, `HH:mm`. */
  startTime: string
  /** Local end time, `HH:mm`, when ELMS provides it. */
  endTime?: string
  lessonType?: string
  room?: string
  isOnline: boolean
  meetingUrl?: string
  zoomUrl?: string
}

/** The stored ELMS session. Kept in localStorage so login is not repeated. */
export interface ElmsSession {
  accessToken: string
  refreshToken: string
  /** ISO timestamp of when the session was obtained/refreshed. */
  savedAt: string
  /** Semester used for timetable requests, from the student profile. */
  semesterId?: number
  /** Display name / username, purely informational. */
  username?: string
}

/** Discriminated result of a login attempt. */
export type ElmsLoginResult =
  | { kind: 'ok'; session: ElmsSession }
  /**
   * ELMS demands a password change on first login. We must not work around
   * this - the user has to finish it on the official site.
   */
  | { kind: 'firstTimeLogin' }
  | { kind: 'invalidCredentials'; message: string }
  | { kind: 'error'; message: string }

/** Outcome of an import run. */
export interface ElmsImportResult {
  lessons: ElmsLesson[]
  /** Lessons that carried a usable meeting link. */
  withLinks: ElmsLesson[]
  /** Total lessons seen in the payload, including offline ones. */
  totalLessons: number
}

export class ElmsAuthError extends Error {
  constructor(message = 'ELMS session expired') {
    super(message)
    this.name = 'ElmsAuthError'
  }
}
