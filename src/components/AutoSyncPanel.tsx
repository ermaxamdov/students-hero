/**
 * ELMS Auto Sync panel: status, counts, and the manual controls.
 *
 * All the heavy lifting happens in the local Node worker; this component only
 * reflects the worker's state and sends commands to it.
 */

import type { SyncStateResponse } from '../types/sync'

interface AutoSyncPanelProps {
  state: SyncStateResponse | null
  /** True when the worker could not be reached. */
  workerOffline: boolean
  busy: boolean
  error: string | null
  onSyncNow: () => void
  onToggleAutoSync: (enabled: boolean) => void
}

/** `2026-09-29T05:00:00` -> `29.09.2026 05:00` in local time. */
function formatStamp(iso: string | undefined): string {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/** "Today at 05:00" / "Tomorrow at 05:00" for the next run. */
function formatNext(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  const now = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(date) - startOf(now)) / 86_400_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (days === 0) return `Today at ${time}`
  if (days === 1) return `Tomorrow at ${time}`
  return `${formatStamp(iso)}`
}

const buttonClass =
  'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60'

export function AutoSyncPanel({
  state,
  workerOffline,
  busy,
  error,
  onSyncNow,
  onToggleAutoSync,
}: AutoSyncPanelProps) {
  const last = state?.lastSync
  const counts = last?.counts

  /* Worker not running: explain exactly how to start it. */
  if (workerOffline) {
    return (
      <section className="rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium text-gray-900">ELMS Auto Sync</h2>
        <p className="mt-2 text-sm text-gray-600">
          <span className="text-gray-400">&#9679;</span> Local sync worker is not running.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Start it with <span className="font-mono text-gray-800">npm run worker</span>. The daily
          05:00 sync is handled by Windows Task Scheduler and works without this page being open.
        </p>
      </section>
    )
  }

  const statusDot = () => {
    if (busy || last?.state === 'running') return <span className="text-amber-500">&#9679;</span>
    if (last?.state === 'success') return <span className="text-green-600">&#9679;</span>
    if (last?.state === 'error') return <span className="text-red-600">&#9679;</span>
    return <span className="text-gray-400">&#9679;</span>
  }

  const statusText = () => {
    if (busy) return 'Syncing...'
    if (last?.state === 'success') return 'Sync successful'
    if (last?.state === 'error') return 'Last sync failed'
    return 'Never synced'
  }

  return (
    <section className="rounded-xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-gray-900">ELMS Auto Sync</h2>
          <p className="mt-1 text-sm text-gray-600">
            {statusDot()}{' '}
            <span className="font-medium">{state?.autoSyncEnabled ? 'ON' : 'OFF'}</span>
            {' \u2014 '}
            {statusText()}
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={state?.autoSyncEnabled ?? false}
            disabled={busy}
            onChange={(event) => onToggleAutoSync(event.target.checked)}
            className="h-4 w-4 accent-gray-900"
          />
          Auto sync
        </label>
      </div>

      {!state?.credentialsConfigured && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ELMS credentials are not configured. Add them to{' '}
          <span className="font-mono">.env.local</span> (see{' '}
          <span className="font-mono">.env.example</span>).
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-gray-500">Last sync</dt>
          <dd className="font-mono text-gray-900">{formatStamp(last?.at)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Next sync</dt>
          <dd className="font-mono text-gray-900">
            {state?.autoSyncEnabled ? formatNext(state.nextSync) : 'Auto sync is off'}
          </dd>
        </div>
      </dl>

      {last?.state === 'error' && last.message && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {last.message}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {counts && (
        <ul className="mt-4 space-y-0.5 text-sm text-gray-700">
          <li>{counts.lessonsFound} lessons found</li>
          <li>{counts.zoomLinksFound} Zoom links found</li>
          <li>{counts.added} new</li>
          <li>{counts.updated} updated</li>
          <li>{counts.unchanged} unchanged</li>
          {counts.stale > 0 && (
            <li className="text-amber-700">
              {counts.stale} no longer in ELMS (kept, marked stale)
            </li>
          )}
          {counts.withoutLink > 0 && (
            <li className="text-gray-500">{counts.withoutLink} without a Zoom link</li>
          )}
        </ul>
      )}

      {/* Lessons ELMS listed with no meeting link at all. */}
      {last?.missingLinkSubjects && last.missingLinkSubjects.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-gray-600">
            Zoom link topilmadi ({last.missingLinkSubjects.length})
          </summary>
          <ul className="mt-1 list-inside list-disc text-gray-600">
            {last.missingLinkSubjects.map((subject) => (
              <li key={subject}>{subject}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onSyncNow} disabled={busy} className={buttonClass}>
          {busy ? 'Syncing...' : last?.state === 'error' ? 'Retry' : 'Sync Now'}
        </button>
        {state?.autoSyncEnabled ? (
          <button
            type="button"
            onClick={() => onToggleAutoSync(false)}
            disabled={busy}
            className={buttonClass}
          >
            Disable Auto Sync
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggleAutoSync(true)}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Enable Auto Sync
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        The daily {state?.syncTime ?? '05:00'} sync runs via Windows Task Scheduler, so it works
        with the browser closed. It cannot start a PC that is fully powered off; if the PC was off,
        the sync runs at the next opportunity.
      </p>
    </section>
  )
}
