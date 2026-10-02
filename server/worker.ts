/**
 * Local HTTP API + in-process daily timer.
 *
 * Two jobs:
 *  1. Serve the sync store to the frontend (which cannot read files itself).
 *  2. Act as a second safety net: while running, it checks every minute
 *     whether the daily slot has passed without a sync and catches up.
 *
 * The Windows scheduled task remains the primary trigger, because it works
 * even when this worker is not running.
 *
 * Binds to 127.0.0.1 only - never exposed to the network.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import type { SyncStateResponse } from '../src/types/sync'
import { CREDENTIALS_DAT, DATA_DIR, DATA_ROOT, hasCredentials, loadConfig, projectRoot, RESET_MARKER } from './config'
import { isSyncDue, nextSyncAt } from './schedule'
import { loadStore, saveStore } from './store'
import { log, runSync } from './sync'
import { getZoomTaskDiagnostics, reconcileZoomLaunchTasks, removeAllManagedTasks, waitForTaskOperations } from './zoomTasks'

let config = loadConfig()

function originIsAllowed(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
  } catch {
    return false
  }
}

let cleanupInProgress = false
let activeSyncController: AbortController | null = null
let activeSyncPromise: Promise<{ ok: boolean; partial?: boolean; message?: string }> | null = null

function corsHeaders(origin: string | undefined): Record<string, string> {
  return {
    ...(origin && originIsAllowed(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
}

function sendJson(res: ServerResponse, origin: string | undefined, code: number, body: unknown) {
  res.writeHead(code, { ...corsHeaders(origin), 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Current state, shaped for the UI. Never includes tokens or credentials. */
function buildState(): SyncStateResponse {
  const store = loadStore(config.syncTime)
  const visibleStore = config.accountId && store.accountId !== config.accountId
    ? { ...store, schedules: [], tokens: undefined, lastSync: { state: 'never' as const } }
    : store
  const next = visibleStore.autoSyncEnabled ? nextSyncAt(visibleStore.syncTime) : null
  return {
    autoSyncEnabled: visibleStore.autoSyncEnabled,
    syncTime: visibleStore.syncTime,
    wakeOffsetMinutes: visibleStore.wakeOffsetMinutes,
    screenshotDelayMinutes: visibleStore.screenshotDelayMinutes,
    lastSync: visibleStore.lastSync,
    nextSync: next ? next.toISOString() : null,
    schedules: visibleStore.schedules,
    credentialsConfigured: hasCredentials(config),
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return {}
  }
}

/** Guarded sync so overlapping requests cannot run two syncs at once. */
async function syncOnce(): Promise<{ ok: boolean; partial?: boolean; message?: string }> {
  if (cleanupInProgress) return { ok: false, message: 'Account cleanup is in progress.' }
  if (activeSyncPromise) return activeSyncPromise
  const controller = new AbortController()
  activeSyncController = controller
  const promise = (async () => {
    try {
      const { status } = await runSync(config, controller.signal)
      return { ok: status.state === 'success', partial: status.partial, message: status.message }
    } finally {
      activeSyncController = null
      activeSyncPromise = null
    }
  })()
  activeSyncPromise = promise
  return promise
}

const server = createServer((req, res) => {
  const origin = req.headers.origin
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    res.end()
    return
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, origin, 200, { ok: true, service: 'auto-zoom-worker' })
    return
  }

  void (async () => {
    try {
      if (url.pathname === '/api/state' && req.method === 'GET') {
        sendJson(res, origin, 200, buildState())
        return
      }

      /**
       * Destructive account reset. The main process invokes this through the
       * packaged-app IPC handler so renderer storage and DPAPI cleanup happen
       * in the same user-visible operation.
       */
      if (url.pathname === '/api/clear-all-user-data' && req.method === 'POST') {
        if (cleanupInProgress) {
          sendJson(res, origin, 409, { ok: false, message: 'Account cleanup is already in progress.' })
          return
        }
        cleanupInProgress = true
        const fs = await import('node:fs')
        try {
          fs.mkdirSync(DATA_ROOT(), { recursive: true })
          fs.writeFileSync(RESET_MARKER(), `${Date.now()}`, 'utf8')
          activeSyncController?.abort()
          if (activeSyncPromise) await activeSyncPromise.catch(() => undefined)
          await waitForTaskOperations()

          const taskResult = await removeAllManagedTasks()
          if (taskResult.failed > 0) {
            sendJson(res, origin, 500, { ok: false, message: 'Some StudentHero Windows tasks could not be removed.' })
            return
          }

          fs.rmSync(DATA_DIR(), { recursive: true, force: true })
          fs.rmSync(`${DATA_ROOT()}\\screen`, { recursive: true, force: true })
          fs.rmSync(CREDENTIALS_DAT(), { force: true })
          if (DATA_ROOT() !== projectRoot()) fs.rmSync(`${DATA_ROOT()}\\.env.local`, { force: true })
          saveStore(loadStore(config.syncTime))
          config = { ...config, username: '', password: '', accountId: null, credentialSource: 'none' }
          sendJson(res, origin, 200, { ok: true, removedTasks: taskResult.removed, state: buildState() })
          return
        } catch {
          if (!res.writableEnded) {
            sendJson(res, origin, 500, { ok: false, message: 'StudentHero account cleanup could not be completed.' })
          }
        } finally {
          fs.rmSync(RESET_MARKER(), { force: true })
          cleanupInProgress = false
        }
      }

      if (cleanupInProgress && req.method === 'POST') {
        sendJson(res, origin, 409, { ok: false, message: 'Account cleanup is in progress.' })
        return
      }

      if (url.pathname === '/api/sync' && req.method === 'POST') {
        if (cleanupInProgress) {
          sendJson(res, origin, 409, { ok: false, message: 'Account cleanup is in progress.' })
          return
        }
        const result = await syncOnce()
        sendJson(res, origin, result.ok ? 200 : 500, { ...result, state: buildState() })
        return
      }

      /** Turn auto-sync on/off. Enabling runs an immediate first sync. */
      if (url.pathname === '/api/auto-sync' && req.method === 'POST') {
        const body = (await readBody(req)) as { enabled?: unknown }
        const enabled = body.enabled === true
        const store = loadStore(config.syncTime)
        saveStore({ ...store, autoSyncEnabled: enabled })
        log(`auto-sync ${enabled ? 'enabled' : 'disabled'}`)

        if (enabled) {
          if (!hasCredentials(config)) {
            sendJson(res, origin, 400, {
              ok: false,
              message: 'ELMS account is not connected. Configure local app credentials before enabling background sync.',
              state: buildState(),
            })
            return
          }
          // Validate credentials by doing a real sync right away.
          const result = await syncOnce()
          sendJson(res, origin, result.ok ? 200 : 500, { ...result, state: buildState() })
          return
        }

        sendJson(res, origin, 200, { ok: true, state: buildState() })
        return
      }

      /** Frontend pushes back user edits (enable/disable, delete, manual adds). */
      if (url.pathname === '/api/schedules' && req.method === 'POST') {
        if (cleanupInProgress) {
          sendJson(res, origin, 409, { ok: false, message: 'Account cleanup is in progress.' })
          return
        }
        const body = (await readBody(req)) as { schedules?: unknown; accountId?: unknown }
        if (!Array.isArray(body.schedules)) {
          sendJson(res, origin, 400, { ok: false, message: 'schedules[] required' })
          return
        }
        const store = loadStore(config.syncTime)
        const nextSchedules = Array.isArray(body.schedules) ? (body.schedules as any[]) : []
        const incomingAccountId = typeof body.accountId === 'string' ? body.accountId : config.accountId
        if (store.accountId && incomingAccountId && store.accountId !== incomingAccountId) {
          sendJson(res, origin, 409, { ok: false, message: 'The local worker belongs to another account. Log out before switching accounts.' })
          return
        }
        const schedulesUnchanged = JSON.stringify(store.schedules) === JSON.stringify(nextSchedules)
        if (schedulesUnchanged && (store.accountId === incomingAccountId || !incomingAccountId)) {
          sendJson(res, origin, 200, { ok: true, unchanged: true })
          return
        }
        const nextStore = { ...store, accountId: incomingAccountId ?? store.accountId, schedules: nextSchedules }
        saveStore(nextStore)
        if (schedulesUnchanged) {
          sendJson(res, origin, 200, { ok: true, unchanged: true })
          return
        }
        const taskReport = await reconcileZoomLaunchTasks(
          nextSchedules as any,
          new Date(),
          store.wakeOffsetMinutes,
          store.screenshotDelayMinutes,
        )
        log(`schedule update reconciled: +${taskReport.created} tasks, ~${taskReport.updated}, -${taskReport.removed}`)
        sendJson(res, origin, 200, { ok: true, partial: taskReport.failed > 0, taskCounts: taskReport })
        return
      }

      if (url.pathname === '/api/wake-offset' && req.method === 'POST') {
        const body = (await readBody(req)) as { wakeOffsetMinutes?: unknown }
        const offset = body.wakeOffsetMinutes
        if (!Number.isInteger(offset) || (offset as number) < 1 || (offset as number) > 60) {
          sendJson(res, origin, 400, {
            ok: false,
            message: 'Wake offset must be a whole number from 1 to 60 minutes.',
          })
          return
        }
        const store = loadStore(config.syncTime)
        const wakeOffsetMinutes = offset as number
        saveStore({ ...store, wakeOffsetMinutes })
        const taskReport = await reconcileZoomLaunchTasks(
          store.schedules,
          new Date(),
          wakeOffsetMinutes,
          store.screenshotDelayMinutes,
        )
        sendJson(res, origin, 200, {
          ok: taskReport.failed === 0,
          partial: taskReport.failed > 0,
          taskCounts: taskReport,
          state: buildState(),
        })
        return
      }

      if (url.pathname === '/api/screenshot-delay' && req.method === 'POST') {
        const body = (await readBody(req)) as { screenshotDelayMinutes?: unknown }
        const delay = body.screenshotDelayMinutes
        if (!Number.isInteger(delay) || (delay as number) < 1 || (delay as number) > 120) {
          sendJson(res, origin, 400, {
            ok: false,
            message: 'Screenshot delay must be a whole number from 1 to 120 minutes.',
          })
          return
        }
        const store = loadStore(config.syncTime)
        const screenshotDelayMinutes = delay as number
        saveStore({ ...store, screenshotDelayMinutes })
        const taskReport = await reconcileZoomLaunchTasks(
          store.schedules,
          new Date(),
          store.wakeOffsetMinutes,
          screenshotDelayMinutes,
        )
        sendJson(res, origin, 200, {
          ok: taskReport.failed === 0,
          partial: taskReport.failed > 0,
          taskCounts: taskReport,
          state: buildState(),
        })
        return
      }

      if (url.pathname === '/api/occurrence' && req.method === 'POST') {
        const body = (await readBody(req)) as { occurrenceKey?: unknown; status?: unknown }
        const allowedStatuses = new Set([
          'browser-attempted',
          'browser-launched',
          'windows-launched',
          'completed',
          'failed',
          'screenshot-success',
          'screenshot-failed',
          'missed',
        ])
        if (
          typeof body.occurrenceKey !== 'string' ||
          !/^[^\r\n]{1,300}$/.test(body.occurrenceKey) ||
          !allowedStatuses.has(String(body.status))
        ) {
          sendJson(res, origin, 400, { ok: false, message: 'Invalid occurrence update.' })
          return
        }
        const fs = await import('node:fs')
        const path = `${DATA_DIR()}\\zoom-occurrences.json`
        let records: Record<string, { status?: string; updatedAt?: string; method?: string }> = {}
        try {
          const raw = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
          records = JSON.parse(raw) as typeof records
        } catch {
          records = {}
        }
        const previous = records[body.occurrenceKey]
        if (!['browser-launched', 'windows-launched', 'completed'].includes(previous?.status ?? '')) {
          records[body.occurrenceKey] = { status: body.status as string, updatedAt: new Date().toISOString() }
          fs.mkdirSync(DATA_DIR(), { recursive: true })
          const tempPath = `${path}.tmp`
          fs.writeFileSync(tempPath, JSON.stringify(records), 'utf8')
          fs.renameSync(tempPath, path)
        }
        sendJson(res, origin, 200, { ok: true })
        return
      }

      if (url.pathname === '/api/launch-diagnostics' && req.method === 'GET') {
        const store = loadStore(config.syncTime)
        const diagnostics = await getZoomTaskDiagnostics(
          store.schedules,
          store.wakeOffsetMinutes,
          new Date(),
          store.screenshotDelayMinutes,
        )
        sendJson(res, origin, 200, diagnostics)
        return
      }

      if (url.pathname === '/api/latest-screenshot' && req.method === 'GET') {
        const fs = await import('node:fs')
        const path = `${DATA_DIR()}\\zoom-occurrences.json`
        let records: Record<string, Record<string, unknown>> = {}
        try {
          const raw = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
          records = JSON.parse(raw) as typeof records
        } catch {
          records = {}
        }

        const matches = Object.entries(records)
          .map(([occurrenceKey, entry]) => ({
            occurrenceKey,
            screenshotPath: typeof entry.screenshotPath === 'string' ? entry.screenshotPath : null,
            screenshotStatus: typeof entry.screenshotStatus === 'string' ? entry.screenshotStatus : null,
            capturedAt: typeof entry.capturedAt === 'string' ? entry.capturedAt : null,
          }))
          .filter((entry): entry is {
            occurrenceKey: string
            screenshotPath: string
            screenshotStatus: string
            capturedAt: string | null
          } => entry.screenshotStatus === 'success' && typeof entry.screenshotPath === 'string')
          .sort((a, b) => {
            const aTime = a.capturedAt ? Date.parse(a.capturedAt) : 0
            const bTime = b.capturedAt ? Date.parse(b.capturedAt) : 0
            return bTime - aTime
          })

        const latest = matches[0]
        if (!latest) {
          sendJson(res, origin, 200, { ok: true, latest: null })
          return
        }

        sendJson(res, origin, 200, {
          ok: true,
          latest: {
            occurrenceKey: latest.occurrenceKey,
            screenshotPath: latest.screenshotPath,
            imageUrl: `http://127.0.0.1:${config.port}/api/screenshot?path=${encodeURIComponent(latest.screenshotPath)}`,
          },
        })
        return
      }

      if (url.pathname === '/api/screenshot' && req.method === 'GET') {
        const rawPath = url.searchParams.get('path')
        const fs = await import('node:fs')
        const { resolve } = await import('node:path')
        if (typeof rawPath !== 'string' || rawPath.trim() === '') {
          sendJson(res, origin, 400, { ok: false, message: 'Missing screenshot path.' })
          return
        }
        const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
        if (!normalized.startsWith('screen/')) {
          sendJson(res, origin, 400, { ok: false, message: 'Invalid screenshot path.' })
          return
        }
        const root = resolve(DATA_ROOT(), 'screen')
        const candidate = resolve(root, normalized.replace(/^screen\//, ''))
        if (!candidate.startsWith(root)) {
          sendJson(res, origin, 400, { ok: false, message: 'Invalid screenshot path.' })
          return
        }
        try {
          const data = fs.readFileSync(candidate)
          res.writeHead(200, {
            ...corsHeaders(origin),
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
          })
          res.end(data)
        } catch {
          sendJson(res, origin, 404, { ok: false, message: 'Screenshot not found.' })
        }
        return
      }

      if (url.pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, origin, 200, { ok: true, service: 'auto-zoom-worker' })
        return
      }

      if (url.pathname === '/api/test-zoom' && req.method === 'POST') {
        const body = (await readBody(req)) as { schedule?: { id?: string; url?: string; time?: string; name?: string } }
        const schedule = body.schedule
        if (!schedule || typeof schedule.url !== 'string' || !schedule.url) {
          sendJson(res, origin, 400, { ok: false, message: 'schedule.url required' })
          return
        }

        const scriptPath = `${projectRoot()}\\scripts\\launch-zoom-task.ps1`
        const occurrenceKey = `${schedule.id ?? 'manual'}@${schedule.time ?? 'manual'}@${new Date().toISOString()}`
        const name = typeof schedule.name === 'string' ? schedule.name : 'Zoom test launch'
        const args = [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-ScheduleId',
          schedule.id ?? 'manual',
          '-OccurrenceKey',
          occurrenceKey,
          '-Name',
          name,
          '-Url',
          schedule.url,
          '-StartTime',
          new Date().toISOString(),
          '-GraceMinutes',
          '10',
          '-DataRoot',
          DATA_ROOT(),
        ]

        try {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'powershell.exe',
              args,
              { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 },
              (error) => (error ? reject(error) : resolve()),
            )
          })
          sendJson(res, origin, 200, { ok: true, message: 'Windows Zoom launch triggered.' })
        } catch (error) {
          sendJson(res, origin, 500, {
            ok: false,
            message: 'Windows Zoom launch failed. Check local launch diagnostics.',
          })
        }
        return
      }

      sendJson(res, origin, 404, { ok: false, message: 'Not found' })
    } catch (error) {
      sendJson(res, origin, 500, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})

/**
 * Safety-net timer: once a minute, catch up if the daily slot was missed
 * (for instance the machine was asleep at 05:00).
 */
const CHECK_MS = 60_000
setInterval(() => {
  const store = loadStore(config.syncTime)
  if (!store.autoSyncEnabled) return
  if (!isSyncDue(store.syncTime, store.lastSync.at)) return
  log('daily slot missed or due - running catch-up sync')
  void syncOnce()
}, CHECK_MS).unref?.()

server.listen(config.port, '127.0.0.1', () => {
  log(
    `worker listening on http://127.0.0.1:${config.port} ` +
      `(sync ${config.syncTime}, credentials: ${config.credentialSource})`,
  )
})
