/**
 * The sync operation itself: login -> semester -> timetable -> reconcile ->
 * persist. Shared by the scheduled task, the long-running worker and the
 * "Sync Now" button, so all three behave identically.
 */

import { appendFileSync, existsSync } from 'node:fs'
import type { SyncStatus, SyncStore } from '../src/types/sync'
import { hasCredentials, LOG_PATH, RESET_MARKER, type WorkerConfig } from './config'
import {
  ElmsAuthFailure,
  fetchSemesterId,
  fetchTimetable,
  login,
  reconcile,
  type AuthContext,
  type ElmsTokens,
} from './elmsCore'
import { ensureDataDir, loadStore, saveStore } from './store'
import { createEmptyStore } from '../src/types/sync'
import { reconcileZoomLaunchTasks } from './zoomTasks'

/** Append a line to the worker log. Never contains credentials. */
export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try {
    ensureDataDir()
    appendFileSync(LOG_PATH(), line, 'utf8')
  } catch {
    // Logging must never break a sync.
  }
  process.stdout.write(line)
}

export interface SyncOutcome {
  status: SyncStatus
  store: SyncStore
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('ELMS sync cancelled during account logout.')
}

function resetIsActive(): boolean {
  return existsSync(RESET_MARKER())
}

/**
 * Run one full sync and persist the result.
 *
 * On failure nothing is deleted: existing schedules and their Zoom links are
 * left exactly as they were, and only the status is updated.
 */
export async function runSync(config: WorkerConfig, signal?: AbortSignal): Promise<SyncOutcome> {
  if (resetIsActive()) return { status: { state: 'never' }, store: loadStore(config.syncTime) }
  throwIfAborted(signal)
  const loadedStore = loadStore(config.syncTime)
  const store = config.accountId && loadedStore.accountId !== config.accountId
    ? createEmptyStore(config.syncTime)
    : loadedStore

  if (!hasCredentials(config)) {
    const status: SyncStatus = {
      state: 'error',
      at: new Date().toISOString(),
      message:
        'ELMS account is not connected. Configure local app credentials before enabling background sync.',
    }
    const next = { ...store, lastSync: status }
    saveStore(next)
    log('sync failed: credentials not configured')
    return { status, store: next }
  }

  const now = new Date()
  let tokens: ElmsTokens | null = store.tokens ?? null

  try {
    // Reuse stored tokens when present; only log in with the password when
    // there is nothing usable cached.
    if (!tokens?.accessToken) {
      log('[ELMS SYNC] authenticating with ELMS')
      tokens = await login(config.username, config.password, signal)
    }

    const ctx: AuthContext = {
      tokens,
      setTokens: (updated: ElmsTokens) => {
        ctx.tokens = updated
      },
      // Called when the refresh token is also dead.
      relogin: async (requestSignal?: AbortSignal) => {
        log('refresh failed - re-login with saved credentials')
        return login(config.username, config.password, requestSignal)
      },
    }

    const semesterId = ctx.tokens.semesterId ?? (await fetchSemesterId(ctx, signal))
    if (!semesterId) throw new Error('Could not determine the active semester from ELMS profile.')
    log('[ELMS SYNC] auth ✅')

    const timetable = await fetchTimetable(ctx, semesterId, signal)
    log('[ELMS SYNC] timetable ✅')
    log('[ELMS SYNC] zoom links ✅')
    log(
      `semester ${semesterId}${timetable.semesterName ? ` (${timetable.semesterName})` : ''}: ` +
        `${timetable.lessons.length} lessons, ${timetable.withLinks.length} with links`,
    )

    if (resetIsActive()) return { status: { state: 'never' }, store }
    throwIfAborted(signal)
    const { schedules, counts, changes } = reconcile(
      store.schedules,
      timetable.withLinks,
      now,
      config.accountId ?? undefined,
    )
    counts.lessonsFound = timetable.lessons.length
    counts.zoomLinksFound = timetable.withLinks.length
    counts.withoutLink = timetable.lessons.length - timetable.withLinks.length
    for (const change of changes) log(`  ${change}`)

    const status: SyncStatus = {
      state: 'success',
      at: new Date().toISOString(),
      counts,
      missingLinkSubjects: [...new Set(timetable.missingLinkSubjects)],
    }

    const next: SyncStore = {
      ...store,
      accountId: config.accountId ?? undefined,
      schedules,
      lastSync: status,
      tokens: { ...ctx.tokens, semesterId },
    }
    if (resetIsActive()) return { status: { state: 'never' }, store }
    throwIfAborted(signal)
    saveStore(next)
    const taskReport = await reconcileZoomLaunchTasks(
      next.schedules,
      now,
      next.wakeOffsetMinutes,
      next.screenshotDelayMinutes,
    )
    if (resetIsActive()) return { status: { state: 'never' }, store }
    throwIfAborted(signal)
    status.taskCounts = {
      created: taskReport.created,
      updated: taskReport.updated,
      removed: taskReport.removed,
      failed: taskReport.failed,
    }
    status.partial = taskReport.failed > 0
    next.lastSync = status
    if (resetIsActive()) return { status: { state: 'never' }, store }
    saveStore(next)
    if (taskReport.failed > 0) {
      log(`[ELMS SYNC] AutoZoom task reconciliation partial: ${taskReport.failed} failed`)
    }
    log(
      `sync ok: +${counts.added} new, ~${counts.updated} updated, ` +
        `=${counts.unchanged} unchanged, !${counts.stale} stale; ` +
        `zoom tasks: +${taskReport.created} ~${taskReport.updated} -${taskReport.removed}`,
    )
    return { status, store: next }
  } catch (error) {
    if (signal?.aborted || resetIsActive()) {
      return { status: { state: 'never' }, store }
    }
    const message = error instanceof Error ? error.message : String(error)
    const status: SyncStatus = {
      state: 'error',
      at: new Date().toISOString(),
      message,
      // Keep the previous run's counts visible so the UI still shows context.
      counts: store.lastSync.counts,
    }
    // Drop tokens on an auth failure so the next run does a clean login.
    const next: SyncStore = {
      ...store,
      lastSync: status,
      tokens: error instanceof ElmsAuthFailure ? undefined : store.tokens,
    }
    saveStore(next)
    log(`sync failed: ${message}`)
    return { status, store: next }
  }
}
