/**
 * localStorage persistence layer.
 *
 * All reads are defensive: a corrupted / hand-edited localStorage value must
 * never crash the app, it should just fall back to "no schedules".
 */

import type { RepeatMode, Schedule, WeekdayIndex } from '../types/schedule'

export const STORAGE_KEY = 'autoZoomSchedules'
/** Remembers that we already showed the one-time popup/permission notice. */
export const POPUP_NOTICE_KEY = 'autoZoomPopupNoticeSeen'

const REPEAT_MODES: RepeatMode[] = ['once', 'daily', 'weekdays', 'custom']

/** `true` when the string is a valid 24h `HH:mm` time. */
export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/** Narrow an unknown value coming out of localStorage into a `Schedule`. */
function parseSchedule(raw: unknown): Schedule | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>

  if (typeof candidate.id !== 'string' || candidate.id === '') return null
  if (typeof candidate.url !== 'string' || candidate.url === '') return null
  if (!isValidTime(candidate.time)) return null

  const repeat = REPEAT_MODES.includes(candidate.repeat as RepeatMode)
    ? (candidate.repeat as RepeatMode)
    : 'once'

  const days = Array.isArray(candidate.days)
    ? (candidate.days.filter(
        (day): day is WeekdayIndex =>
          typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6,
      ) as WeekdayIndex[])
    : undefined

  return {
    id: candidate.id,
    accountId: typeof candidate.accountId === 'string' ? candidate.accountId : undefined,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    url: candidate.url,
    time: candidate.time,
    repeat,
    days,
    // Default to enabled so an older/partial record still works.
    enabled: candidate.enabled !== false,
    lastRun: typeof candidate.lastRun === 'string' ? candidate.lastRun : undefined,
    // Sync provenance. Missing `source` => manual, so pre-sync records are
    // never mistaken for ELMS data and thus never overwritten by a sync.
    source: candidate.source === 'elms' ? 'elms' : 'manual',
    sourceLessonId:
      typeof candidate.sourceLessonId === 'string' ? candidate.sourceLessonId : undefined,
    sourceSubject: typeof candidate.sourceSubject === 'string' ? candidate.sourceSubject : undefined,
    syncedAt: typeof candidate.syncedAt === 'string' ? candidate.syncedAt : undefined,
    stale: candidate.stale === true ? true : undefined,
  }
}

/** Load every stored schedule. Returns `[]` on any problem. */
export function loadSchedules(): Schedule[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(parseSchedule)
      .filter((schedule): schedule is Schedule => schedule !== null)
  } catch {
    return []
  }
}

/** Persist the full list of schedules (single source of truth). */
export function saveSchedules(schedules: Schedule[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules))
  } catch {
    // Storage can be full or blocked (private mode). Scheduling still works
    // for the current session, so there is nothing useful to do here.
  }
}

/** Remove every renderer-owned persistence key for the current app origin. */
export function clearLocalAppStorage(): void {
  try { window.localStorage.clear() } catch { /* ignore */ }
  try { window.sessionStorage.clear() } catch { /* ignore */ }
}

export function hasSeenPopupNotice(): boolean {
  try {
    return window.localStorage.getItem(POPUP_NOTICE_KEY) === 'true'
  } catch {
    return false
  }
}

export function markPopupNoticeSeen(): void {
  try {
    window.localStorage.setItem(POPUP_NOTICE_KEY, 'true')
  } catch {
    // ignore
  }
}

/** Small id helper; `crypto.randomUUID` is not available in every context. */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
