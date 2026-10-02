/**
 * Application header: identity on the left, live status and the two primary
 * actions on the right.
 *
 * The worker status pill is one of the five things the user must be able to
 * read instantly, so it sits next to the actions rather than buried below.
 */

import { Button, StatusPill, type StatusTone } from './ui/primitives'
import { Icon } from './ui/Icon'

export type WorkerState = 'running' | 'syncing' | 'offline' | 'failed'

const WORKER_LABEL: Record<WorkerState, { text: string; tone: StatusTone; pulse: boolean }> = {
  running: { text: 'Worker running', tone: 'ok', pulse: false },
  syncing: { text: 'Syncing\u2026', tone: 'busy', pulse: true },
  offline: { text: 'Worker offline', tone: 'idle', pulse: false },
  failed: { text: 'Worker error', tone: 'danger', pulse: false },
}

interface AppHeaderProps {
  workerState: WorkerState
  localTime: string
  syncDisabled: boolean
  onSync: () => void
  onAddMeeting: () => void
  onOpenSettings: () => void
  onSleepMode: () => void
}

export function AppHeader({
  workerState,
  localTime,
  syncDisabled,
  onSync,
  onAddMeeting,
  onOpenSettings,
  onSleepMode,
}: AppHeaderProps) {
  const status = WORKER_LABEL[workerState]

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-6">
      <div className="flex items-center gap-3">
        {/* Mark: a simple, restrained glyph rather than a logo image. */}
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-line-strong bg-surface-2 text-accent-soft">
          <Icon name="video" className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            StudentHero
          </h1>
          <p className="text-[12.5px] text-muted">Your classes. Your schedule. Automatically handled.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 hidden text-[12.5px] tabular-nums text-muted sm:inline">
          {localTime}
        </span>
        <StatusPill
          tone={status.tone}
          pulse={status.pulse}
          title={
            workerState === 'offline'
              ? 'Start the local worker with: npm run worker'
              : 'Local ELMS sync worker'
          }
        >
          {status.text}
        </StatusPill>

        <Button
          variant="secondary"
          icon="refresh"
          onClick={onSync}
          disabled={syncDisabled}
          loading={workerState === 'syncing'}
        >
          Sync
        </Button>
        <Button variant="primary" icon="plus" onClick={onAddMeeting}>
          Add meeting
        </Button>
        <Button variant="secondary" onClick={onSleepMode}>
          Sleep Mode
        </Button>
        <Button variant="ghost" size="md" onClick={onOpenSettings} aria-label="Settings">
          <Icon name="gear" className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
