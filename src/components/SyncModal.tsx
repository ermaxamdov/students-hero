/**
 * Sync progress / result drawer.
 *
 * Shows plain-language stages while the worker runs, then a summary. Raw
 * technical output stays hidden behind "View details".
 *
 * The stages are indicative progress feedback: the worker performs the sync
 * as one HTTP call, so the UI advances through the steps it is known to
 * perform rather than receiving per-step events. The final summary is real
 * data returned by the worker.
 */

import { useEffect, useState } from 'react'
import type { SyncStatus } from '../types/sync'
import { formatStamp } from '../utils/presentation'
import { Icon } from './ui/Icon'
import { Button, Modal } from './ui/primitives'

const STAGES = [
  'Authenticating with ELMS',
  'Fetching timetable',
  'Finding Zoom links',
  'Updating schedules',
  'Sync complete',
] as const

interface SyncModalProps {
  open: boolean
  busy: boolean
  status: SyncStatus | undefined
  error: string | null
  onClose: () => void
  onRetry: () => void
}

export function SyncModal({ open, busy, status, error, onClose, onRetry }: SyncModalProps) {
  const [stage, setStage] = useState(0)
  const [showDetails, setShowDetails] = useState(false)

  /**
   * Advance the indicative stage list while a sync is in flight.
   *
   * All state updates happen inside timer callbacks (never synchronously
   * during the effect), so this only ever synchronises with the timer.
   * The first tick is immediate and resets to stage 0, which makes a second
   * sync restart from the beginning.
   */
  useEffect(() => {
    if (!busy) return
    let step = -1
    const advance = () => {
      step = step < 0 ? 0 : Math.min(step + 1, STAGES.length - 2)
      setStage(step)
    }
    const first = window.setTimeout(advance, 0)
    const id = window.setInterval(advance, 700)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [busy])

  const counts = status?.counts
  const taskCounts = status?.taskCounts
  const failed = !busy && (status?.state === 'error' || Boolean(error))
  const succeeded = !busy && status?.state === 'success' && !error

  /** Collapse the details disclosure as the dialog closes. */
  const handleClose = () => {
    setShowDetails(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={busy ? 'Syncing ELMS' : failed ? 'Sync failed' : 'Sync complete'}
      description={
        busy ? 'Fetching your latest timetable\u2026' : failed ? undefined : 'Your timetable is up to date.'
      }
      footer={
        busy ? undefined : (
          <>
            {failed && (
              <Button variant="secondary" icon="refresh" onClick={onRetry}>
                Retry
              </Button>
            )}
            <Button variant="primary" onClick={handleClose}>
              Done
            </Button>
          </>
        )
      }
    >
      <ul className="mb-4 space-y-2.5">
        {STAGES.map((text, index) => {
          const done = succeeded || (failed && index < 3) || (busy && index < stage)
          const active = busy && index === stage
          const failedStep = failed && index === 3
          return (
            <li key={text} className="flex items-center gap-2.5">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  done
                    ? 'border-ok/40 bg-ok/10 text-ok'
                    : failedStep
                      ? 'border-danger/40 bg-danger/10 text-danger'
                      : active
                        ? 'border-accent/50 bg-accent/10 text-accent-soft'
                        : 'border-line text-muted'
                }`}
              >
                {done ? (
                  <Icon name="check" className="h-3 w-3" />
                ) : failedStep ? (
                  <Icon name="warning" className="h-3 w-3" />
                ) : active ? (
                  <Icon name="refresh" className="h-3 w-3 anim-spin" />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-current" />
                )}
              </span>
              <span className={`text-[13.5px] ${done || active || failedStep ? 'text-ink' : 'text-muted'}`}>
                {text}
              </span>
            </li>
          )
        })}
      </ul>

      {busy ? null : failed ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#4a2b2b] bg-[#241a1a]/60 px-3.5 py-3">
          <span className="mt-0.5 text-danger">
            <Icon name="warning" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-ink">Worker sync failed</p>
            <p className="mt-1 break-words text-[13px] text-ink-dim">
              {error ?? status?.message ?? 'Could not connect to ELMS.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { value: counts?.lessonsFound ?? 0, label: 'Lessons' },
              { value: counts?.zoomLinksFound ?? 0, label: 'Zoom links' },
              { value: counts?.added ?? 0, label: 'New' },
              { value: counts?.updated ?? 0, label: 'Updated' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5"
              >
                <div className="text-[18px] font-semibold leading-none tabular-nums text-ink">
                  {stat.value}
                </div>
                <div className="mt-1.5 text-[11.5px] text-muted">{stat.label}</div>
              </div>
            ))}
          </div>

          {succeeded && counts && counts.stale > 0 && (
            <p className="mt-3 text-[12.5px] text-warn">
              {counts.stale} schedule{counts.stale === 1 ? '' : 's'} no longer in the ELMS timetable
              (kept and marked stale).
            </p>
          )}

          {succeeded && taskCounts && (
            <p className={`mt-3 text-[12.5px] ${taskCounts.failed > 0 ? 'text-warn' : 'text-muted'}`}>
              AutoZoom tasks: {taskCounts.created} created, {taskCounts.updated} updated,{' '}
              {taskCounts.removed} removed{taskCounts.failed > 0 ? `, ${taskCounts.failed} failed` : ''}.
            </p>
          )}

          {status?.missingLinkSubjects && status.missingLinkSubjects.length > 0 && (
            <p className="mt-2 text-[12.5px] text-muted">
              Zoom link topilmadi: {status.missingLinkSubjects.length} lesson
              {status.missingLinkSubjects.length === 1 ? '' : 's'}
            </p>
          )}
        </>
      )}

      {!busy && (
        <div className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setShowDetails((open) => !open)}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink-dim"
          >
            <Icon
              name={showDetails ? 'chevron-down' : 'chevron-right'}
              className="h-3.5 w-3.5"
            />
            View details
          </button>

          {showDetails && (
            <dl className="mt-2.5 space-y-1.5 text-[12.5px] anim-fade">
              {[
                ['Finished', formatStamp(status?.at)],
                ['Unchanged', String(counts?.unchanged ?? 0)],
                ['Stale', String(counts?.stale ?? 0)],
                ['Without a link', String(counts?.withoutLink ?? 0)],
                ['Endpoint', 'api-elms.tuit.uz'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted">{label}</dt>
                  <dd className="truncate font-mono text-ink-dim">{value}</dd>
                </div>
              ))}
              {status?.missingLinkSubjects && status.missingLinkSubjects.length > 0 && (
                <div className="pt-1">
                  <dt className="text-muted">Lessons without a link</dt>
                  <dd className="mt-1 space-y-0.5">
                    {status.missingLinkSubjects.map((subject) => (
                      <div key={subject} className="text-ink-dim">
                        {subject}
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </Modal>
  )
}
