/**
 * Settings panel.
 *
 * Holds the technical configuration that used to clutter the main screen:
 * worker details, ELMS session, scheduling info, browser limitations.
 */

import { useEffect, useState } from 'react'
import type { ElmsSession } from '../types/elms'
import type { AppDataEntry } from '../types/electron'
import type { SyncStateResponse, ZoomTaskDiagnostics } from '../types/sync'
import { formatStamp } from '../utils/presentation'
import { WORKER_BASE_URL } from '../utils/syncApi'
import { Icon } from './ui/Icon'
import { Button, Modal, StatusDot, Toggle } from './ui/primitives'

type Tab = 'general' | 'elms' | 'scheduling' | 'about'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'elms', label: 'ELMS' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'about', label: 'About' },
]

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  state: SyncStateResponse | null
  workerOffline: boolean
  busy: boolean
  elmsSession: ElmsSession | null
  scheduleCount: number
  elmsCount: number
  onToggleAutoSync: (enabled: boolean) => void
  onWakeOffsetChange: (minutes: number) => void
  onScreenshotDelayChange: (minutes: number) => void
  onElmsLogout: () => void
  onElmsConnect: () => void
  taskDiagnostics: ZoomTaskDiagnostics | null
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[13px] text-ink-dim">{label}</span>
      <span className={`text-[13px] text-ink ${mono ? 'font-mono text-[12.5px]' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
        {title}
      </h3>
      <div className="divide-y divide-line rounded-xl border border-line bg-surface-2/40 px-3.5">
        {children}
      </div>
    </section>
  )
}

export function SettingsModal({
  open,
  onClose,
  state,
  workerOffline,
  busy,
  elmsSession,
  scheduleCount,
  elmsCount,
  onToggleAutoSync,
  onWakeOffsetChange,
  onScreenshotDelayChange,
  onElmsLogout,
  onElmsConnect,
  taskDiagnostics,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('general')
  const [appData, setAppData] = useState<Record<string, AppDataEntry> | null>(null)

  useEffect(() => {
    if (!open || !window.electronAPI?.getAppDataInfo) return
    void window.electronAPI.getAppDataInfo().then(setAppData).catch(() => setAppData(null))
  }, [open])

  const openPath = (key: string) => {
    if (window.electronAPI?.openAppDataPath) void window.electronAPI.openAppDataPath(key)
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="lg">
      <div className="flex gap-1 border-b border-line pb-3">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              tab === item.id
                ? 'bg-surface-3 text-ink'
                : 'text-muted hover:bg-surface-2 hover:text-ink-dim'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="max-h-[52vh] overflow-y-auto pt-4">
        {tab === 'general' && (
          <>
            <Group title="Worker">
              <Row
                label="Local sync worker"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot tone={workerOffline ? 'idle' : 'ok'} />
                    {workerOffline ? 'Offline' : 'Running'}
                  </span>
                }
              />
              <Row label="API" value={WORKER_BASE_URL.replace('http://', '')} mono />
              {workerOffline && <Row label="Start with" value="npm run worker" mono />}
            </Group>

            <Group title="Schedules">
              <Row label="Total" value={scheduleCount} />
              <Row label="From ELMS" value={elmsCount} />
              <Row label="Manual" value={scheduleCount - elmsCount} />
            </Group>

            <Group title="App data">
              {appData ? (
                <>
                  <Row label="App data" value={appData.appData?.path ?? '\u2014'} mono />
                  {appData.logs?.exists && <Row label="Logs" value={appData.logs.path} mono />}
                  {appData.screenshots?.exists && <Row label="Screenshots" value={appData.screenshots.path} mono />}
                  {appData.localState?.exists && <Row label="Local database/state" value={appData.localState.path} mono />}
                  {appData.credentials?.exists && <Row label="Credential storage" value={appData.credentials.path} mono />}
                  <div className="flex flex-wrap gap-2 py-3">
                    <Button size="sm" variant="secondary" onClick={() => openPath('appData')}>Open app data folder</Button>
                    <Button size="sm" variant="ghost" onClick={() => openPath('logs')}>Open logs folder</Button>
                    <Button size="sm" variant="ghost" onClick={() => openPath('screenshots')}>Open screenshots folder</Button>
                  </div>
                </>
              ) : (
                <p className="py-3 text-[12.5px] text-muted">Available in the packaged Windows app.</p>
              )}
            </Group>
          </>
        )}

        {tab === 'elms' && (
          <>
            <Group title="Connection">
              <Row
                label="Credentials"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot tone={state?.credentialsConfigured ? 'ok' : 'warn'} />
                    {state?.credentialsConfigured ? 'Configured' : 'Not configured'}
                  </span>
                }
              />
              <Row label="Endpoint" value="api-elms.tuit.uz" mono />
              <div className="flex items-center justify-between gap-4 py-2">
                <span className="text-[13px] text-ink-dim">Auto-sync</span>
                <Toggle
                  checked={state?.autoSyncEnabled ?? false}
                  disabled={busy || workerOffline}
                  onChange={onToggleAutoSync}
                  label="Toggle auto-sync"
                />
              </div>
            </Group>

            <Group title="Last sync">
              <Row label="Finished" value={formatStamp(state?.lastSync.at)} mono />
              <Row label="Result" value={state?.lastSync.state ?? 'never'} />
              {state?.lastSync.message && (
                <Row label="Message" value={state.lastSync.message} />
              )}
            </Group>

            <Group title="ELMS account">
              {elmsSession ? (
                <>
                  <Row
                    label="Status"
                    value={<span className="inline-flex items-center gap-1.5"><StatusDot tone="ok" />Connected</span>}
                  />
                  {elmsSession.username && <Row label="Account" value={elmsSession.username} />}
                  <div className="flex items-center justify-between gap-4 py-2">
                    <span className="text-[13px] text-ink-dim">ELMS session</span>
                    <Button size="sm" variant="secondary" onClick={onElmsLogout}>
                      Logout
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-4 py-2">
                  <span className="text-[13px] text-ink-dim">ELMS account not connected</span>
                  <Button size="sm" variant="secondary" onClick={onElmsConnect}>
                    Connect ELMS
                  </Button>
                </div>
              )}
            </Group>

            <p className="text-[12.5px] leading-relaxed text-muted">
              In the packaged app, background credentials are read from the per-user app-data
              directory and the password can be protected with Windows DPAPI. The worker reads
              them locally; they are never included in the browser bundle. Source-checkout
              development may still use <span className="font-mono text-ink-dim">.env.local</span>.
            </p>
          </>
        )}

        {tab === 'scheduling' && (
          <>
            <Group title="Daily ELMS sync">
              <Row label="Time" value={state?.syncTime ?? '05:00'} mono />
              <Row label="Next run" value={formatStamp(state?.nextSync)} mono />
              <Row label="Runs via" value="Windows Task Scheduler" />
            </Group>

            <Group title="Meeting opening">
              <Row label="Launch mode" value="Browser → Windows fallback" />
              <Row label="Browser check" value="Every second while open" />
            </Group>

            <Group title="ELMS wake tasks">
              <div className="flex items-center justify-between gap-4 py-2">
                <span className="text-[13px] text-ink-dim">Wake before class</span>
                <select
                  aria-label="Wake offset before class"
                  value={state?.wakeOffsetMinutes ?? 5}
                  disabled={busy || workerOffline}
                  onChange={(event) => onWakeOffsetChange(Number(event.target.value))}
                  className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-50"
                >
                  {[1, 3, 5, 10, 15, 30].map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes} minutes</option>
                  ))}
                </select>
              </div>
              <Row
                label="Windows task readiness"
                value={
                  taskDiagnostics?.queryStatus === 'error'
                    ? 'Task query failed'
                    : taskDiagnostics?.ready === true
                      ? 'Ready'
                      : taskDiagnostics?.ready === false
                        ? 'Tasks missing or disabled'
                        : 'Checking'
                }
              />
              <Row
                label="Task query"
                value={taskDiagnostics?.queryStatus === 'error' ? taskDiagnostics.error : 'Windows Task Scheduler'}
              />
            </Group>

            <Group title="Screenshots">
              <div className="flex items-center justify-between gap-4 py-2">
                <span className="text-[13px] text-ink-dim">Screenshot delay</span>
                <select
                  aria-label="Screenshot delay after lesson start"
                  value={state?.screenshotDelayMinutes ?? 10}
                  disabled={busy || workerOffline}
                  onChange={(event) => onScreenshotDelayChange(Number(event.target.value))}
                  className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-50"
                >
                  {[1, 3, 5, 10, 15, 30, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes} minutes</option>
                  ))}
                </select>
              </div>
              <Row
                label="Autocapture"
                value={taskDiagnostics?.nextScreenshot ? `${taskDiagnostics.nextScreenshot.at}` : 'Not scheduled'}
              />
            </Group>

            <div className="space-y-2 text-[12.5px] leading-relaxed text-muted">
              <p>
                When this dashboard is open, it tries the browser first. If the browser cannot
                open the meeting, the scheduled Windows task launches it after a short grace period.
              </p>
              <p>
                Upcoming ELMS occurrences get a separate wake task and an independent launch task.
                Manual schedules keep their launch task but do not get wake tasks. These tasks are
                prepared through the next 56 days and run without the dashboard or worker.
              </p>
              <p>
                A scheduled task cannot power on a PC that is shut down. Whether Hibernate wake
                works depends on Windows power settings and firmware; task readiness does not prove
                that the computer physically woke.
              </p>
              <p>
                Your browser may ask for permission before opening Zoom. Allow it, and allow popups
                for this site so scheduled links are not blocked.
              </p>
            </div>
          </>
        )}

        {tab === 'about' && (
          <>
            <Group title="Application">
              <Row label="Name" value="Auto Zoom Scheduler" />
              <Row label="Mode" value="Local only" />
              <Row label="Storage" value="localStorage + local JSON" />
            </Group>
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
              <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No backend, no account, and no third-party service. Credentials are sent only to
              api-elms.tuit.uz over HTTPS.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
