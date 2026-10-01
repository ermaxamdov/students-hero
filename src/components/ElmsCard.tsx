/**
 * Compact ELMS integration card.
 *
 * Answers three of the five "must be obvious" questions: is ELMS connected,
 * when is the next sync, and what did the last sync produce.
 */

import type { SyncStateResponse } from '../types/sync'
import { formatClock, formatRelativeStamp } from '../utils/presentation'
import { Icon } from './ui/Icon'
import { Button, Card, StatusDot, Toggle, type StatusTone } from './ui/primitives'

interface ElmsCardProps {
  state: SyncStateResponse | null
  workerOffline: boolean
  busy: boolean
  error: string | null
  now: Date
  onSyncNow: () => void
  onToggleAutoSync: (enabled: boolean) => void
  onShowDetails: () => void
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
      <div className="text-[19px] font-semibold leading-none tabular-nums text-ink">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-muted">{label}</div>
    </div>
  )
}

export function ElmsCard({
  state,
  workerOffline,
  busy,
  error,
  now,
  onSyncNow,
  onToggleAutoSync,
  onShowDetails,
}: ElmsCardProps) {
  const last = state?.lastSync
  const counts = last?.counts
  const failed = last?.state === 'error'

  /* Worker down: elegant warning, not a wall of red. */
  if (workerOffline) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-warn">
            <Icon name="warning" className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink">ELMS</h2>
              <span className="text-[12.5px] text-warn">Worker offline</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
              Start the local worker to manage syncing from here. The daily sync still runs through
              Windows Task Scheduler without it.
            </p>
            <code className="mt-2.5 inline-block rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-[12.5px] text-ink-dim">
              npm run worker
            </code>
          </div>
        </div>
      </Card>
    )
  }

  const connected = state?.credentialsConfigured ?? false
  const tone: StatusTone = failed ? 'danger' : connected ? 'ok' : 'warn'
  const statusText = failed ? 'Sync failed' : connected ? 'Connected' : 'Not configured'

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-ink">ELMS</h2>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-dim">
              <StatusDot tone={tone} pulse={busy} />
              {busy ? 'Syncing\u2026' : statusText}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-ink-dim">
            {connected
              ? 'Your timetable is synced automatically.'
              : 'Add your credentials to .env.local to enable syncing.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] text-muted">Auto-sync</span>
          <Toggle
            checked={state?.autoSyncEnabled ?? false}
            disabled={busy || !connected}
            onChange={onToggleAutoSync}
            label="Toggle ELMS auto-sync"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Stat value={String(counts?.lessonsFound ?? 0)} label="Lessons" />
        <Stat value={String(counts?.zoomLinksFound ?? 0)} label="Zoom links" />
        <Stat
          value={state?.autoSyncEnabled ? formatClock(state.nextSync) : '\u2014'}
          label="Next sync"
        />
      </div>

      {/* Compact error row instead of a giant red block. */}
      {(failed || error) && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#4a2b2b] bg-[#241a1a]/60 px-3 py-2.5">
          <span className="mt-0.5 text-danger">
            <Icon name="warning" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">ELMS sync failed</p>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-dim">
              {error ?? last?.message ?? 'Could not connect to ELMS.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="secondary" onClick={onSyncNow} disabled={busy}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={onShowDetails}>
              Details
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">
          Last synced{' '}
          <span className="text-ink-dim">{formatRelativeStamp(last?.at, now)}</span>
          {counts && (counts.added > 0 || counts.updated > 0) && (
            <span className="text-ink-dim">
              {' \u00b7 '}
              {counts.added > 0 && `${counts.added} new`}
              {counts.added > 0 && counts.updated > 0 && ', '}
              {counts.updated > 0 && `${counts.updated} updated`}
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onShowDetails}>
            View details
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            onClick={onSyncNow}
            loading={busy}
            disabled={busy || !connected}
          >
            Sync now
          </Button>
        </div>
      </div>
    </Card>
  )
}
