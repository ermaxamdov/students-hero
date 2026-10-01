/**
 * Local persistence for the ELMS session.
 *
 * Only the tokens issued by ELMS are stored - never the password. The tokens
 * live in this browser's localStorage and are sent exclusively to
 * api-elms.tuit.uz.
 */

import type { ElmsSession } from '../types/elms'

export const ELMS_SESSION_KEY = 'autoZoomElmsSession'

export function loadElmsSession(): ElmsSession | null {
  try {
    const raw = window.localStorage.getItem(ELMS_SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.accessToken !== 'string' || candidate.accessToken === '') return null
    return {
      accessToken: candidate.accessToken,
      refreshToken: typeof candidate.refreshToken === 'string' ? candidate.refreshToken : '',
      savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : new Date().toISOString(),
      semesterId:
        typeof candidate.semesterId === 'number' && Number.isFinite(candidate.semesterId)
          ? candidate.semesterId
          : undefined,
      username: typeof candidate.username === 'string' ? candidate.username : undefined,
    }
  } catch {
    return null
  }
}

export function saveElmsSession(session: ElmsSession): void {
  try {
    window.localStorage.setItem(ELMS_SESSION_KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable - the session simply won't persist.
  }
}

export function clearElmsSession(): void {
  try {
    window.localStorage.removeItem(ELMS_SESSION_KEY)
  } catch {
    // ignore
  }
}
