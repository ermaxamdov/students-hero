/**
 * Auto Zoom Scheduler - a purely local, browser-based meeting link scheduler.
 *
 * How the scheduling works:
 *  - all schedules live in React state and are mirrored into localStorage;
 *  - a single `setInterval` ticks once per second and updates `now`, which
 *    both drives the countdowns and triggers the due-check;
 *  - `findDueSchedules()` (see utils/scheduler.ts) decides what should open,
 *    using the local system clock - never UTC;
 *  - after opening, the schedule is stamped with `lastRun` so it can only
 *    fire once per occurrence, and a "once" schedule disables itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader, type WorkerState } from './components/AppHeader'
import { ElmsCard } from './components/ElmsCard'
import { ElmsPanel, type ElmsStatus } from './components/ElmsPanel'
import { NextMeetingCard } from './components/NextMeetingCard'
import { ScheduleForm } from './components/ScheduleForm'
import { ScheduleRow } from './components/ScheduleRow'
import { SettingsModal } from './components/SettingsModal'
import { SyncModal } from './components/SyncModal'
import { WeeklySchedule } from './components/WeeklySchedule'
import { Icon } from './components/ui/Icon'
import {
  Button,
  Card,
  EmptyState,
  Modal,
  SectionTitle,
} from './components/ui/primitives'
import { Toasts, type ToastItem, type ToastKind } from './components/ui/Toasts'
import { byTimeThenName, findNextMeeting } from './utils/presentation'
import { ElmsAuthError, type ElmsImportResult, type ElmsSession } from './types/elms'
import type { Schedule, ScheduleFormValues } from './types/schedule'
import { elmsLogin, importFromElms } from './utils/elmsClient'
import { lessonsToSchedules, lessonsToWeeklySchedules, mergeSchedules } from './utils/elmsImport'
import { clearElmsSession, loadElmsSession, saveElmsSession } from './utils/elmsStorage'
import { findDueSchedules, getNextOccurrence, openMeeting } from './utils/scheduler'
import {
  fetchWorkerHealth,
  fetchLaunchDiagnostics,
  fetchLatestScreenshot,
  fetchSyncState,
  pushSchedules,
  setAutoSync,
  setWakeOffset,
  setScreenshotDelay,
  recordOccurrenceLaunch,
  testWindowsZoomLaunch,
  triggerSync,
  WorkerRequestTimeoutError,
  WorkerUnavailableError,
} from './utils/syncApi'
import type { SyncStateResponse, ZoomTaskDiagnostics } from './types/sync'
import {
  createId,
  hasSeenPopupNotice,
  loadSchedules,
  markPopupNoticeSeen,
  saveSchedules,
} from './utils/storage'

/** How often the clock ticks. 1s keeps the countdown smooth. */
const TICK_MS = 1000

/** Stable id source for stacked toasts. */
let toastSeq = 0

function formValuesToSchedule(values: ScheduleFormValues, base?: Schedule): Schedule {
  return {
    id: base?.id ?? createId(),
    name: values.name,
    url: values.url,
    time: values.time,
    repeat: values.repeat,
    days: values.repeat === 'custom' ? values.days : undefined,
    enabled: base?.enabled ?? true,
    // Editing the time/repeat means past runs are no longer relevant.
    lastRun: base && base.time === values.time && base.repeat === values.repeat
      ? base.lastRun
      : undefined,
    // Mark provenance explicitly. Editing an ELMS-imported schedule keeps its
    // ELMS identity so the next sync still recognises (and can correct) it.
    source: base?.source ?? 'manual',
    sourceLessonId: base?.sourceLessonId,
    sourceSubject: base?.sourceSubject,
    syncedAt: base?.syncedAt,
    stale: base?.stale,
  }
}

export default function App() {
  const [schedules, setSchedules] = useState<Schedule[]>(() => loadSchedules())
  const [now, setNow] = useState<Date>(() => new Date())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [showPopupNotice, setShowPopupNotice] = useState(false)

  /* Redesign-only UI state */
  const [selectedDay, setSelectedDay] = useState<number>(() => new Date().getDay())
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  /* ELMS integration state */
  const [elmsSession, setElmsSession] = useState<ElmsSession | null>(() => loadElmsSession())
  const [elmsStatus, setElmsStatus] = useState<ElmsStatus>({ kind: 'idle' })
  const [elmsPreview, setElmsPreview] = useState<ElmsImportResult | null>(null)
  const [elmsFirstTimeLogin, setElmsFirstTimeLogin] = useState(false)
  const [groupWeekly, setGroupWeekly] = useState(true)

  /* Local worker (05:00 auto-sync) state */
  const [syncState, setSyncState] = useState<SyncStateResponse | null>(null)
  const [workerOffline, setWorkerOffline] = useState(true)
  const [workerError, setWorkerError] = useState(false)
  const [zoomTaskDiagnostics, setZoomTaskDiagnostics] = useState<ZoomTaskDiagnostics | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [latestScreenshot, setLatestScreenshot] = useState<{ occurrenceKey: string; screenshotPath: string; imageUrl: string } | null>(null)

  /**
  * Occurrences already attempted during this page session, keyed by
  * `${id}@${occurrenceISO}`. This also prevents retrying a blocked popup
  * every second during the trigger window.
   */
  const firedRef = useRef<Set<string>>(new Set())

  /**
   * Latest schedules, readable from inside the interval callback without
   * making the interval depend on (and restart with) every state change.
   */
  const schedulesRef = useRef<Schedule[]>(schedules)
  const workerStateRefreshRef = useRef(false)

  /* -------------------------------------------------------------- */
  /* Toasts                                                          */
  /* -------------------------------------------------------------- */

  /** Push a toast. Each one dismisses itself (see components/ui/Toasts). */
  const pushToast = useCallback((kind: ToastKind, text: string) => {
    toastSeq += 1
    const id = `t${toastSeq}`
    // Cap the stack so a burst of events cannot cover the screen.
    setToasts((current) => [...current.slice(-3), { id, kind, text }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  /* -------------------------------------------------------------- */
  /* Persistence                                                     */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    // Keep the ref used by the timer in sync, and mirror to localStorage.
    schedulesRef.current = schedules
    saveSchedules(schedules)
  }, [schedules])

  /* -------------------------------------------------------------- */
  /* The trigger: check every due schedule and open it               */
  /* -------------------------------------------------------------- */

  const checkSchedules = useCallback((current: Date) => {
    const due = findDueSchedules(schedulesRef.current, current)
    if (due.length === 0) return

    for (const schedule of due) {
      const occurrenceAt = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate(),
        Number(schedule.time.slice(0, 2)),
        Number(schedule.time.slice(3, 5)),
      )
      const key = `${schedule.id}@${occurrenceAt.toISOString()}`
      if (firedRef.current.has(key)) continue
      firedRef.current.add(key)
      void recordOccurrenceLaunch(key, 'browser-attempted').catch(() => undefined)
      const launched = openMeeting(schedule.url)
      if (launched) {
        void recordOccurrenceLaunch(key, 'browser-launched').catch(() => undefined)
        setSchedules((items) => items.map((item) => item.id === schedule.id
          ? { ...item, lastRun: occurrenceAt.toISOString(), enabled: item.repeat === 'once' ? false : item.enabled }
          : item))
      }
      pushToast(launched ? 'success' : 'warning', launched
        ? `Browser opened ${schedule.name || 'the Zoom meeting'}.`
        : 'Browser could not open the meeting. Windows automation is available.')
    }
  }, [pushToast])

  /* -------------------------------------------------------------- */
  /* The clock: one interval drives both the check and the countdown */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const tick = () => {
      const current = new Date()
      setNow(current)
      checkSchedules(current)
    }

    // Check straight away so a schedule that became due while the page was
    // loading (or reloading) is not missed.
    tick()

    const id = window.setInterval(tick, TICK_MS)
    // Re-check immediately when the tab becomes visible/focused again:
    // background tabs get their timers throttled, so ticks may have been
    // delayed while the user was elsewhere.
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [checkSchedules])

  /* -------------------------------------------------------------- */
  /* Handlers                                                        */
  /* -------------------------------------------------------------- */

  const handleAdd = useCallback((values: ScheduleFormValues) => {
    setSchedules((current) => [...current, formValuesToSchedule(values)])
    setAddOpen(false)
    pushToast('success', 'Schedule saved.')
    // One-time informational note, shown only for the very first schedule.
    if (!hasSeenPopupNotice()) {
      markPopupNoticeSeen()
      setShowPopupNotice(true)
    }
  }, [pushToast])

  const handleSaveEdit = useCallback((id: string, values: ScheduleFormValues) => {
    setSchedules((current) =>
      current.map((schedule) =>
        schedule.id === id ? formValuesToSchedule(values, schedule) : schedule,
      ),
    )
    setEditingId(null)
    pushToast('success', 'Schedule updated.')
  }, [pushToast])

  const handleToggleEnabled = useCallback((id: string) => {
    setSchedules((current) =>
      current.map((schedule) =>
        schedule.id === id
          ? {
              ...schedule,
              enabled: !schedule.enabled,
              // Re-enabling a finished one-time schedule should let it run again.
              lastRun:
                !schedule.enabled && schedule.repeat === 'once' ? undefined : schedule.lastRun,
            }
          : schedule,
      ),
    )
  }, [])

  const handleTest = useCallback(
    (schedule: Schedule) => {
      const occurrenceKey = `${schedule.id}@manual-${new Date().toISOString()}`
      void recordOccurrenceLaunch(occurrenceKey, 'browser-attempted').catch(() => undefined)
      if (openMeeting(schedule.url)) {
        void recordOccurrenceLaunch(occurrenceKey, 'browser-launched').catch(() => undefined)
      } else {
        pushToast('warning', 'Browser could not open the meeting. Windows automation is available.')
      }
    },
    [pushToast],
  )

  const handleWakeOffsetChange = useCallback(async (wakeOffsetMinutes: number) => {
    setSyncBusy(true)
    try {
      const result = await setWakeOffset(wakeOffsetMinutes)
      setSyncState(result.state)
      if (result.ok) {
        pushToast('success', `Wake offset set to ${wakeOffsetMinutes} minutes.`)
      } else {
        pushToast('warning', 'Wake offset saved, but Windows tasks need attention.')
      }
    } catch (error) {
      pushToast('warning', error instanceof Error ? error.message : 'Could not update wake offset.')
    } finally {
      setSyncBusy(false)
    }
  }, [pushToast])

  const handleScreenshotDelayChange = useCallback(async (screenshotDelayMinutes: number) => {
    setSyncBusy(true)
    try {
      const result = await setScreenshotDelay(screenshotDelayMinutes)
      setSyncState(result.state)
      if (result.ok) {
        pushToast('success', `Screenshot delay set to ${screenshotDelayMinutes} minutes.`)
      } else {
        pushToast('warning', 'Screenshot delay saved, but Windows tasks need attention.')
      }
    } catch (error) {
      pushToast('warning', error instanceof Error ? error.message : 'Could not update screenshot delay.')
    } finally {
      setSyncBusy(false)
    }
  }, [pushToast])

  const handleTestWindows = useCallback(async (schedule: Schedule) => {
    try {
      const result = await testWindowsZoomLaunch({
        id: schedule.id,
        name: schedule.name,
        url: schedule.url,
        time: schedule.time,
      })
      if (result.ok) pushToast('success', 'Windows Zoom launch triggered.')
      else pushToast('warning', result.message ?? 'Windows Zoom launch failed.')
    } catch (error) {
      pushToast('warning', error instanceof Error ? error.message : 'Windows Zoom launch failed.')
    }
  }, [pushToast])

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDeleteId) return
    setSchedules((current) => current.filter((schedule) => schedule.id !== pendingDeleteId))
    if (editingId === pendingDeleteId) setEditingId(null)
    setPendingDeleteId(null)
    pushToast('success', 'Schedule deleted.')
  }, [pendingDeleteId, editingId, pushToast])

  const localTime = useMemo(
    () =>
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(
        now.getSeconds(),
      ).padStart(2, '0')}`,
    [now],
  )

  /* -------------------------------------------------------------- */
  /* Local worker: 05:00 auto-sync                                   */
  /* -------------------------------------------------------------- */

  /**
   * Adopt the worker's state.
   *
   * The worker owns ELMS schedules (it writes them at 05:00 with no browser
   * running); the browser owns manual ones. So we take ELMS entries from the
   * worker and keep local manual entries as they are.
   */
  const applyWorkerState = useCallback((state: SyncStateResponse) => {
    setSyncState(state)
    setWorkerOffline(false)

    const workerElms = state.schedules.filter((schedule) => schedule.source === 'elms')
    const current = schedulesRef.current
    const localManual = current.filter((schedule) => schedule.source !== 'elms')
    const localElms = current.filter((schedule) => schedule.source === 'elms')

    // Preserve the browser's `lastRun` for a schedule already fired today:
    // the worker does not observe openings, so its copy may be behind.
    const byId = new Map(localElms.map((schedule) => [schedule.id, schedule]))
    const merged = workerElms.map((schedule) => {
      const local = byId.get(schedule.id)
      if (!local) return schedule
      const newer =
        local.lastRun && (!schedule.lastRun || local.lastRun > schedule.lastRun)
          ? local.lastRun
          : schedule.lastRun
      return { ...schedule, lastRun: newer }
    })
    const next = [...localManual, ...merged]
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      workerStateRefreshRef.current = true
      setSchedules(next)
    }
  }, [])

  /** Poll the worker so the UI reflects background syncs while open. */
  useEffect(() => {
    let cancelled = false

    const pollHealth = async () => {
      try {
        await fetchWorkerHealth()
        if (cancelled) return
        setWorkerOffline(false)
        setWorkerError(false)
      } catch (error) {
        if (cancelled) return
        if (error instanceof WorkerUnavailableError) {
          setWorkerOffline(true)
          setWorkerError(false)
        } else {
          setWorkerOffline(false)
          setWorkerError(true)
        }
      }
    }

    const pollState = async () => {
      try {
        const state = await fetchSyncState()
        if (!cancelled) applyWorkerState(state)
      } catch {
        // /health is authoritative for process status; state loading can retry next poll.
      }
    }

    const pollLaunchDiagnostics = async () => {
      try {
        const diagnostics = await fetchLaunchDiagnostics()
        if (!cancelled) setZoomTaskDiagnostics(diagnostics)
      } catch {
        if (!cancelled) {
          setZoomTaskDiagnostics({
            queryStatus: 'error',
            error: 'Windows task diagnostics could not be loaded.',
            launchTaskCount: null,
            wakeTaskCount: null,
            screenshotTaskCount: null,
            expectedLaunchCount: 0,
            expectedWakeCount: 0,
            expectedScreenshotCount: 0,
            ready: null,
            nextWake: null,
            nextLaunch: null,
            nextScreenshot: null,
            lastWakeResult: null,
            lastLaunchResult: null,
            lastScreenshotResult: null,
          })
        }
      }
    }

    const pollLatestScreenshot = async () => {
      try {
        const result = await fetchLatestScreenshot()
        if (!cancelled) setLatestScreenshot(result?.latest ?? null)
      } catch {
        if (!cancelled) setLatestScreenshot(null)
      }
    }

    void pollHealth()
    void pollState()
    void pollLaunchDiagnostics()
    void pollLatestScreenshot()
    const healthId = window.setInterval(() => void pollHealth(), 5000)
    const stateId = window.setInterval(() => void pollState(), 30_000)
    const diagnosticsId = window.setInterval(() => void pollLaunchDiagnostics(), 30_000)
    const screenshotId = window.setInterval(() => void pollLatestScreenshot(), 15_000)
    return () => {
      cancelled = true
      window.clearInterval(healthId)
      window.clearInterval(stateId)
      window.clearInterval(diagnosticsId)
      window.clearInterval(screenshotId)
    }
  }, [applyWorkerState])

  /**
   * Mirror local schedule edits back to the worker, so its 05:00
   * reconciliation sees the user's disables/deletes and manual entries.
   */
  useEffect(() => {
    if (workerOffline) return
    if (workerStateRefreshRef.current) {
      workerStateRefreshRef.current = false
      return
    }
    const id = window.setTimeout(() => {
      void pushSchedules(schedules).catch(() => {
        // Non-critical: the next successful push will carry the same data.
      })
    }, 1500)
    return () => window.clearTimeout(id)
  }, [schedules, workerOffline])

  const handleSyncNow = useCallback(async () => {
    setSyncBusy(true)
    setSyncError(null)
    setSyncModalOpen(true)
    try {
      const result = await triggerSync()
      applyWorkerState(result.state)
      if (result.ok) {
        const counts = result.state.lastSync.counts
        pushToast(
          'success',
          counts
            ? `Sync complete · ${counts.added} new, ${counts.updated} updated`
            : 'Sync complete.',
        )
      } else {
        setSyncError(result.message ?? 'Sync failed.')
        pushToast('error', 'ELMS sync failed.')
      }
    } catch (error) {
      if (error instanceof WorkerUnavailableError) {
        setWorkerOffline(true)
        setSyncError('Worker sync failed. The worker did not respond; retry after checking it is running.')
        pushToast('warning', 'Local sync worker did not respond.')
      } else if (error instanceof WorkerRequestTimeoutError) {
        setSyncError(error.message)
        pushToast('error', 'ELMS sync timed out.')
      } else {
        setSyncError(error instanceof Error ? error.message : 'Sync failed.')
        pushToast('error', 'ELMS sync failed.')
      }
    } finally {
      setSyncBusy(false)
    }
  }, [applyWorkerState, pushToast])

  const handleToggleAutoSync = useCallback(
    async (enabled: boolean) => {
      setSyncBusy(true)
      setSyncError(null)
      try {
        // Enabling validates credentials by running a real sync immediately.
        const result = await setAutoSync(enabled)
        applyWorkerState(result.state)
        if (!result.ok) setSyncError(result.message ?? 'Could not enable auto sync.')
        else if (enabled) {
          pushToast('success', `Auto sync enabled. Next sync: ${result.state.syncTime}.`)
        }
      } catch (error) {
        if (error instanceof WorkerUnavailableError) setWorkerOffline(true)
        else setSyncError(error instanceof Error ? error.message : 'Could not change auto sync.')
      } finally {
        setSyncBusy(false)
      }
    },
    [applyWorkerState, pushToast],
  )

  /* -------------------------------------------------------------- */
  /* ELMS integration                                                */
  /* -------------------------------------------------------------- */

  /** Persist a renewed session (used by the 401-refresh path too). */
  const persistSession = useCallback((session: ElmsSession) => {
    setElmsSession(session)
    saveElmsSession(session)
  }, [])

  /** Fetch the timetable with an existing session and show a preview. */
  const runImport = useCallback(
    async (session: ElmsSession) => {
      setElmsStatus({ kind: 'loading', text: 'ELMS jadvali yuklanmoqda...' })
      setElmsPreview(null)
      try {
        const { result, semesterId, session: effective } = await importFromElms(
          session,
          persistSession,
        )
        // Cache the semester so later imports skip the profile round-trip.
        // Base this on `effective`, not `session`: the token may have been
        // refreshed during the import and must not be rolled back.
        persistSession({ ...effective, semesterId })
        setElmsPreview(result)
        setElmsStatus({ kind: 'idle' })
      } catch (error) {
        if (error instanceof ElmsAuthError) {
          // Session is dead - drop it so the login form comes back.
          clearElmsSession()
          setElmsSession(null)
          setElmsStatus({ kind: 'error', text: error.message })
          return
        }
        setElmsStatus({
          kind: 'error',
          text: error instanceof Error ? error.message : 'ELMS xatosi',
        })
      }
    },
    [persistSession],
  )

  const handleElmsImport = useCallback(() => {
    if (!elmsSession) return
    void runImport(elmsSession)
  }, [elmsSession, runImport])

  const handleElmsLogin = useCallback(
    (username: string, password: string) => {
      setElmsFirstTimeLogin(false)
      setElmsStatus({ kind: 'loading', text: 'ELMS\u2019ga ulanmoqda...' })
      void (async () => {
        const result = await elmsLogin(username, password)
        switch (result.kind) {
          case 'ok':
            persistSession(result.session)
            // Straight into the import: one click is the whole point.
            await runImport(result.session)
            break
          case 'firstTimeLogin':
            setElmsFirstTimeLogin(true)
            setElmsStatus({ kind: 'idle' })
            break
          case 'invalidCredentials':
          case 'error':
            setElmsStatus({ kind: 'error', text: result.message })
            break
        }
      })()
    },
    [persistSession, runImport],
  )

  const handleElmsLogout = useCallback(() => {
    clearElmsSession()
    setElmsSession(null)
    setElmsPreview(null)
    setElmsStatus({ kind: 'idle' })
  }, [])

  /** Write the previewed lessons into the schedule list. */
  const handleConfirmElmsImport = useCallback(() => {
    if (!elmsPreview) return
    const imported = groupWeekly
      ? lessonsToWeeklySchedules(elmsPreview.withLinks)
      : lessonsToSchedules(elmsPreview.withLinks)

    if (imported.length === 0) {
      setElmsStatus({
        kind: 'error',
        text: 'Qo\u2018shish uchun kelgusi darslar topilmadi (barchasi o\u2018tib ketgan).',
      })
      setElmsPreview(null)
      return
    }

    // Merge against the current list up front: doing this inside the state
    // updater would make the summary unreliable (updaters may run twice).
    const { merged, added, updated } = mergeSchedules(schedulesRef.current, imported)
    setSchedules(merged)
    setElmsPreview(null)
    setElmsStatus({
      kind: 'success',
      text: `${added} ta yangi dars qo\u2018shildi${updated > 0 ? `, ${updated} tasi yangilandi` : ''}.`,
    })
    if (!hasSeenPopupNotice()) {
      markPopupNoticeSeen()
      setShowPopupNotice(true)
    }
  }, [elmsPreview, groupWeekly])

  /* -------------------------------------------------------------- */
  /* Derived view data                                               */
  /* -------------------------------------------------------------- */

  /** Soonest upcoming meeting across all enabled schedules. */
  const nextMeeting = useMemo(() => findNextMeeting(schedules, now), [schedules, now])

  const elmsCount = useMemo(
    () => schedules.filter((schedule) => schedule.source === 'elms').length,
    [schedules],
  )

  /**
   * Sidebar list: everything ordered by when it actually fires next, so the
   * column complements the weekday view instead of repeating it.
   */
  const upcomingSchedules = useMemo(() => {
    const withNext = schedules.map((schedule) => ({
      schedule,
      at: schedule.enabled ? getNextOccurrence(schedule, now) : null,
    }))
    withNext.sort((a, b) => {
      if (a.at && b.at) return a.at.getTime() - b.at.getTime()
      if (a.at) return -1
      if (b.at) return 1
      return byTimeThenName(a.schedule, b.schedule)
    })
    return withNext.map((item) => item.schedule)
  }, [schedules, now])

  const editing = useMemo(
    () => schedules.find((schedule) => schedule.id === editingId) ?? null,
    [schedules, editingId],
  )

  /** Header status pill: one glance tells the user what the worker is doing. */
  const workerState: WorkerState = syncBusy
    ? 'syncing'
    : workerOffline
      ? 'offline'
      : workerError
        ? 'failed'
        : 'running'

  /* -------------------------------------------------------------- */
  /* Render                                                          */
  /* -------------------------------------------------------------- */

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1180px] px-5 py-7 xl:px-8">
        <AppHeader
          workerState={workerState}
          localTime={localTime}
          syncDisabled={syncBusy || workerOffline}
          onSync={() => void handleSyncNow()}
          onAddMeeting={() => setAddOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* One-time popup guidance, kept compact. */}
        {showPopupNotice && (
          <Card className="mb-5 flex items-start gap-3 px-4 py-3 anim-fade">
            <span className="mt-0.5 text-warn">
              <Icon name="warning" className="h-4 w-4" />
            </span>
            <p className="flex-1 text-[13px] text-ink-dim">
              Keep this tab open for browser-first launch. If a browser popup is blocked, Windows
              automation remains available as the fallback.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setShowPopupNotice(false)}>
              Got it
            </Button>
          </Card>
        )}

        {/* Primary two-column area: what's next + integration status. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <NextMeetingCard
            next={nextMeeting}
            now={now}
            onOpen={handleTest}
            onTestWindows={handleTestWindows}
            taskDiagnostics={zoomTaskDiagnostics}
            onSyncElms={() => void handleSyncNow()}
          />
          <ElmsCard
            state={syncState}
            workerOffline={workerOffline}
            busy={syncBusy}
            error={syncError}
            now={now}
            onSyncNow={() => void handleSyncNow()}
            onToggleAutoSync={(enabled) => void handleToggleAutoSync(enabled)}
            onShowDetails={() => setSyncModalOpen(true)}
          />
        </div>

        {/* Secondary area: the week on the left, everything else on the right. */}
        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section>
            <SectionTitle
              aside={
                <span className="text-[12px] text-muted">
                  {schedules.length} total
                  {elmsCount > 0 ? ` \u00b7 ${elmsCount} from ELMS` : ''}
                </span>
              }
            >
              Weekly schedule
            </SectionTitle>
            <WeeklySchedule
              schedules={schedules}
              now={now}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onOpen={handleTest}
              onEdit={setEditingId}
              onDelete={setPendingDeleteId}
              onToggleEnabled={handleToggleEnabled}
              onSyncElms={() => void handleSyncNow()}
            />
          </section>

          <div className="space-y-6">
            <section>
              <SectionTitle>Latest screenshot</SectionTitle>
              {latestScreenshot ? (
                <Card className="overflow-hidden p-3">
                  <img
                    src={latestScreenshot.imageUrl}
                    alt={`Latest screenshot for ${latestScreenshot.occurrenceKey}`}
                    className="h-auto max-h-[280px] w-full rounded-md border border-line object-contain bg-black/5"
                  />
                  <p className="mt-2 text-[12px] text-muted">{latestScreenshot.screenshotPath}</p>
                </Card>
              ) : (
                <EmptyState
                  title="No screenshot yet"
                  body="When a Zoom lesson launches and the scheduled screenshot task runs, the PNG appears here."
                />
              )}
            </section>

            <section>
              <SectionTitle>Up next</SectionTitle>
              {upcomingSchedules.length === 0 ? (
                <EmptyState
                  title="No meetings scheduled"
                  body="Add a meeting manually or sync your ELMS timetable."
                  action={
                    <Button variant="secondary" icon="refresh" onClick={() => void handleSyncNow()}>
                      Sync ELMS
                    </Button>
                  }
                />
              ) : (
                <ul className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                  {upcomingSchedules.map((schedule) => (
                    <ScheduleRow
                      key={schedule.id}
                      schedule={schedule}
                      now={now}
                      compact
                      onOpen={handleTest}
                      onEdit={setEditingId}
                      onDelete={setPendingDeleteId}
                      onToggleEnabled={handleToggleEnabled}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionTitle>Add</SectionTitle>
              <div className="flex flex-col gap-2">
                <Button variant="secondary" icon="plus" onClick={() => setAddOpen(true)}>
                  Add manual meeting
                </Button>
                <Button variant="ghost" icon="link" onClick={() => setImportOpen(true)}>
                  Import from ELMS manually
                </Button>
              </div>
            </section>
          </div>
        </div>

        <footer className="mt-10 border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
          Keep this tab open for meetings to open automatically &mdash; the browser cannot launch
          links while fully closed. The daily ELMS sync runs without it.
        </footer>
      </div>

      {/* ---------------- Modals ---------------- */}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add meeting"
        description="Schedule a link to open automatically."
      >
        <ScheduleForm onSubmit={handleAdd} onCancel={() => setAddOpen(false)} />
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditingId(null)}
        title="Edit schedule"
        description={editing?.source === 'elms' ? 'Synced from ELMS.' : undefined}
      >
        {editing && (
          <ScheduleForm
            initialValues={{
              name: editing.name,
              url: editing.url,
              time: editing.time,
              repeat: editing.repeat,
              days: editing.days ?? [],
            }}
            submitLabel="Save changes"
            onSubmit={(values) => handleSaveEdit(editing.id, values)}
            onCancel={() => setEditingId(null)}
          />
        )}
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import from ELMS"
        description="Browser-side import using your ELMS login."
      >
        <ElmsPanel
          session={elmsSession}
          status={elmsStatus}
          preview={elmsPreview}
          groupWeekly={groupWeekly}
          onGroupWeeklyChange={setGroupWeekly}
          onImport={handleElmsImport}
          onLogin={handleElmsLogin}
          onLogout={handleElmsLogout}
          onConfirmPreview={handleConfirmElmsImport}
          onDismissPreview={() => setElmsPreview(null)}
          needsFirstTimeLogin={elmsFirstTimeLogin}
        />
      </Modal>

      <SyncModal
        open={syncModalOpen}
        busy={syncBusy}
        status={syncState?.lastSync}
        error={syncError}
        onClose={() => setSyncModalOpen(false)}
        onRetry={() => void handleSyncNow()}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={syncState}
        workerOffline={workerOffline}
        busy={syncBusy}
        elmsSession={elmsSession}
        scheduleCount={schedules.length}
        elmsCount={elmsCount}
        onToggleAutoSync={(enabled) => void handleToggleAutoSync(enabled)}
        onWakeOffsetChange={(minutes: number) => void handleWakeOffsetChange(minutes)}
        onScreenshotDelayChange={(minutes: number) => void handleScreenshotDelayChange(minutes)}
        taskDiagnostics={zoomTaskDiagnostics}
        onElmsLogout={handleElmsLogout}
      />

      <Modal
        open={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        title="Delete this schedule?"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon="trash" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-dim">
          The schedule will be removed. If it came from ELMS it may reappear on the next sync.
        </p>
      </Modal>

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  )
}
