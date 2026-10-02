/**
 * Types shared between the browser UI and the local Node sync worker.
 *
 * This file is imported by BOTH sides, so it must stay free of any
 * browser-only or Node-only API usage.
 */

import type { Schedule } from './schedule'

/** Outcome counters for one sync run - what the UI shows the user. */
export interface SyncCounts {
  lessonsFound: number
  zoomLinksFound: number
  added: number
  updated: number
  unchanged: number
  /** ELMS schedules that are no longer present in the timetable. */
  stale: number
  /** Lessons ELMS listed without any usable meeting link. */
  withoutLink: number
}

export const EMPTY_COUNTS: SyncCounts = {
  lessonsFound: 0,
  zoomLinksFound: 0,
  added: 0,
  updated: 0,
  unchanged: 0,
  stale: 0,
  withoutLink: 0,
}

/** Result of the most recent sync attempt. */
export interface SyncStatus {
  state: 'never' | 'success' | 'error' | 'running'
  /** ISO timestamp of when the attempt finished. */
  at?: string
  /** Error message when `state === 'error'`. Never contains credentials. */
  message?: string
  counts?: SyncCounts
  taskCounts?: { created: number; updated: number; removed: number; failed: number }
  partial?: boolean
  /** Subjects ELMS listed with no meeting link, for display. */
  missingLinkSubjects?: string[]
}

/**
 * The full persisted state owned by the worker.
 *
 * Stored as a JSON file on disk (not localStorage) so the 05:00 background
 * sync works with no browser running.
 */
export interface SyncStore {
  version: 1
  autoSyncEnabled: boolean
  /** Daily sync time, local wall clock, `HH:mm`. */
  syncTime: string
  /** Minutes before an ELMS occurrence when Windows should wake. */
  wakeOffsetMinutes: number
  /** Minutes after a lesson start when the automatic screenshot is taken. */
  screenshotDelayMinutes: number
  schedules: Schedule[]
  /** Account owner of this worker store; absent only for legacy empty state. */
  accountId?: string
  lastSync: SyncStatus
  /** ELMS tokens, so routine syncs skip the password login. */
  tokens?: {
    accessToken: string
    refreshToken: string
    semesterId?: number
    savedAt: string
  }
}

export function createEmptyStore(syncTime = '05:00'): SyncStore {
  return {
    version: 1,
    autoSyncEnabled: false,
    syncTime,
    wakeOffsetMinutes: 5,
    screenshotDelayMinutes: 10,
    schedules: [],
    lastSync: { state: 'never' },
  }
}

/** Payload returned by the worker's HTTP API to the frontend. */
export interface SyncStateResponse {
  autoSyncEnabled: boolean
  syncTime: string
  wakeOffsetMinutes: number
  screenshotDelayMinutes: number
  lastSync: SyncStatus
  /** Next scheduled sync as an ISO timestamp, or null when auto-sync is off. */
  nextSync: string | null
  schedules: Schedule[]
  /** Whether credentials are configured at all. */
  credentialsConfigured: boolean
}

export interface ZoomTaskRunResult {
  at: string | null
  resultCode: number | null
  state: string | null
}

export interface ZoomTaskDiagnostics {
  queryStatus: 'ok' | 'error'
  error?: string
  launchTaskCount: number | null
  wakeTaskCount: number | null
  screenshotTaskCount: number | null
  expectedLaunchCount: number
  expectedWakeCount: number
  expectedScreenshotCount: number
  ready: boolean | null
  nextWake: { at: string; installed: boolean } | null
  nextLaunch: { at: string; installed: boolean } | null
  nextScreenshot: { at: string; installed: boolean } | null
  lastWakeResult: ZoomTaskRunResult | null
  lastLaunchResult: ZoomTaskRunResult | null
  lastScreenshotResult: ZoomTaskRunResult | null
}
