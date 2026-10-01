/**
 * Client for the local worker's HTTP API (127.0.0.1).
 *
 * The browser cannot read the worker's JSON store directly, so the worker
 * exposes a tiny localhost-only API. When the worker is not running every call
 * fails fast and the app keeps working purely from localStorage.
 */

import type { SyncStateResponse, ZoomTaskDiagnostics } from '../types/sync'

/** The worker is a separate local service from the Vite frontend. */
export const WORKER_BASE_URL = 'http://127.0.0.1:8787'
/** Keep this short: a missing worker must not stall the UI. */
const TIMEOUT_MS = 8000
const HEALTH_TIMEOUT_MS = 2500
const SYNC_TIMEOUT_MS = 30_000

export class WorkerUnavailableError extends Error {
  constructor() {
    super('Local sync worker is not running.')
    this.name = 'WorkerUnavailableError'
  }
}

export class WorkerRequestTimeoutError extends Error {
  constructor() {
    super('The worker request timed out.')
    this.name = 'WorkerRequestTimeoutError'
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const isSyncRequest = path === '/api/sync'
  if (isSyncRequest) {
    console.info('[ELMS SYNC] calling worker: /api/sync')
    console.info('[ELMS SYNC] request started')
  }
  try {
    const headers = new Headers(init?.headers)
    if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${WORKER_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    })
    if (isSyncRequest) console.info('[ELMS SYNC] response status:', response.status)
    const responseText = await response.text()
    let body: (T & { message?: string }) | undefined
    try {
      body = JSON.parse(responseText) as T & { message?: string }
    } catch {
      body = undefined
    }
    if (!response.ok) {
      throw new Error(body?.message ?? `Worker error (HTTP ${response.status})`)
    }
    if (!body) throw new Error('Worker returned an invalid JSON response.')
    return body
  } catch (error) {
    if (timedOut) {
      if (path === '/health') throw new WorkerUnavailableError()
      throw new WorkerRequestTimeoutError()
    }
    if (error instanceof TypeError || (error as Error)?.name === 'AbortError') {
      throw new WorkerUnavailableError()
    }
    throw error
  } finally {
    window.clearTimeout(timer)
    if (isSyncRequest) console.info('[ELMS SYNC] request completed')
  }
}

export function fetchSyncState(): Promise<SyncStateResponse> {
  return request<SyncStateResponse>('/api/state')
}

export async function fetchWorkerHealth(): Promise<void> {
  const result = await request<{ ok?: boolean; service?: string }>('/health', undefined, HEALTH_TIMEOUT_MS)
  if (result.ok !== true || result.service !== 'auto-zoom-worker') {
    throw new Error('Worker health check returned an invalid response.')
  }
}

export function triggerSync(): Promise<{ ok: boolean; message?: string; state: SyncStateResponse }> {
  return request('/api/sync', { method: 'POST' }, SYNC_TIMEOUT_MS)
}

export function setAutoSync(
  enabled: boolean,
): Promise<{ ok: boolean; message?: string; state: SyncStateResponse }> {
  return request(
    '/api/auto-sync',
    { method: 'POST', body: JSON.stringify({ enabled }) },
    SYNC_TIMEOUT_MS,
  )
}

export function setWakeOffset(
  wakeOffsetMinutes: number,
): Promise<{ ok: boolean; partial?: boolean; message?: string; state: SyncStateResponse }> {
  return request('/api/wake-offset', {
    method: 'POST',
    body: JSON.stringify({ wakeOffsetMinutes }),
  })
}

export function setScreenshotDelay(
  screenshotDelayMinutes: number,
): Promise<{ ok: boolean; partial?: boolean; message?: string; state: SyncStateResponse }> {
  return request('/api/screenshot-delay', {
    method: 'POST',
    body: JSON.stringify({ screenshotDelayMinutes }),
  })
}

/** Push locally edited schedules back so the worker reconciles against them. */
export function pushSchedules(schedules: unknown[]): Promise<{ ok: boolean }> {
  return request('/api/schedules', {
    method: 'POST',
    body: JSON.stringify({ schedules }),
  })
}

export function testWindowsZoomLaunch(schedule: {
  id: string
  name: string
  url: string
  time: string
}): Promise<{ ok: boolean; message?: string }> {
  return request('/api/test-zoom', {
    method: 'POST',
    body: JSON.stringify({ schedule }),
  })
}

export function recordOccurrenceLaunch(
  occurrenceKey: string,
  status: 'browser-attempted' | 'browser-launched' | 'windows-launched' | 'completed' | 'failed' | 'screenshot-success' | 'screenshot-failed' | 'missed',
): Promise<{ ok: boolean }> {
  return request('/api/occurrence', {
    method: 'POST',
    body: JSON.stringify({ occurrenceKey, status }),
  })
}

export function fetchLaunchDiagnostics(): Promise<ZoomTaskDiagnostics> {
  return request('/api/launch-diagnostics')
}

export function fetchLatestScreenshot(): Promise<{ ok: boolean; latest: { occurrenceKey: string; screenshotPath: string; imageUrl: string } | null } | null> {
  return request('/api/latest-screenshot')
}
