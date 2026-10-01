/**
 * "Next meeting" hero.
 *
 * The single most important thing on the screen: what opens next, when, and
 * how long until then.
 */

import type { Schedule } from '../types/schedule'
import type { ZoomTaskDiagnostics } from '../types/sync'
import {
  formatRemaining,
  formatWhen,
  isZoom,
  recurrenceLabel,
  splitName,
} from '../utils/presentation'
import { Icon } from './ui/Icon'
import { Button, Card } from './ui/primitives'

interface NextMeetingCardProps {
  next: { schedule: Schedule; at: Date } | null
  now: Date
  onOpen: (schedule: Schedule) => void
  onTestWindows: (schedule: Schedule) => void
  taskDiagnostics: ZoomTaskDiagnostics | null
  onSyncElms: () => void
}

export function NextMeetingCard({
  next,
  now,
  onOpen,
  onTestWindows,
  taskDiagnostics,
  onSyncElms,
}: NextMeetingCardProps) {
  const taskReadiness = taskDiagnostics?.queryStatus === 'error'
    ? 'Task query failed'
    : taskDiagnostics?.ready === true
      ? 'Ready'
      : taskDiagnostics?.ready === false
        ? 'Tasks missing or disabled'
        : 'Checking'
  const displayTime = (stamp?: string | null) => stamp
    ? new Date(stamp).toLocaleString()
    : 'None'
  const displayResult = (result: ZoomTaskDiagnostics['lastWakeResult']) => {
    if (!result) return 'No run recorded'
    const code = result.resultCode === null ? 'unknown' : String(result.resultCode)
    return `${displayTime(result.at)} · task code ${code}`
  }

  const diagnostics = (
    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-[12px]">
      <span className="col-span-2 font-medium text-ink">Next Automation</span>
      <span className="text-muted">Windows task query</span>
      <span className={`text-right ${taskDiagnostics?.queryStatus === 'error' ? 'text-warn' : 'text-ink'}`}>
        {taskReadiness}
      </span>
      {taskDiagnostics?.queryStatus === 'error' ? (
        <>
          <span className="col-span-2 text-right text-warn">{taskDiagnostics.error}</span>
        </>
      ) : (
        <>
          <span className="text-muted">Installed launch / wake tasks</span>
          <span className="text-right text-ink">
            {taskDiagnostics
              ? `${taskDiagnostics.launchTaskCount ?? 0} / ${taskDiagnostics.wakeTaskCount ?? 0} (expected ${taskDiagnostics.expectedLaunchCount} / ${taskDiagnostics.expectedWakeCount})`
              : 'Checking'}
          </span>
          <span className="text-muted">Next wake task</span>
          <span className="text-right text-ink">
            {taskDiagnostics?.nextWake
              ? `${displayTime(taskDiagnostics.nextWake.at)}${taskDiagnostics.nextWake.installed ? '' : ' · missing'}`
              : 'None'}
          </span>
          <span className="text-muted">Next launch task</span>
          <span className="text-right text-ink">
            {taskDiagnostics?.nextLaunch
              ? `${displayTime(taskDiagnostics.nextLaunch.at)}${taskDiagnostics.nextLaunch.installed ? '' : ' · missing'}`
              : 'None'}
          </span>
          <span className="text-muted">Last wake task result</span>
          <span className="text-right text-ink">{displayResult(taskDiagnostics?.lastWakeResult ?? null)}</span>
          <span className="text-muted">Last launch task result</span>
          <span className="text-right text-ink">{displayResult(taskDiagnostics?.lastLaunchResult ?? null)}</span>
        </>
      )}
      <span className="text-muted">Fallback</span>
      <span className="text-right text-ink">Enabled</span>
    </div>
  )

  if (!next) {
    return (
      <Card className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
          Next meeting
        </p>
        <div className="mt-4 flex flex-col items-start gap-3">
          <div>
            <p className="text-[15px] font-medium text-ink">No upcoming meetings</p>
            <p className="mt-1 text-[13px] text-ink-dim">
              Add a meeting manually or sync your ELMS timetable.
            </p>
          </div>
          <Button variant="secondary" icon="refresh" onClick={onSyncElms}>
            Sync ELMS
          </Button>
        </div>
        {diagnostics}
      </Card>
    )
  }

  const { schedule, at } = next
  const { subject, teacher } = splitName(schedule)
  const remaining = at.getTime() - now.getTime()
  // Within 15 minutes the meeting is effectively "now" - highlight it.
  const imminent = remaining <= 15 * 60 * 1000

  return (
    <Card
      className={`relative overflow-hidden p-5 ${imminent ? 'border-accent/40' : ''}`}
    >
      {/* Very soft accent wash; no loud gradient. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.16]"
        style={{ background: 'radial-gradient(circle, var(--color-accent), transparent 68%)' }}
      />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
            Next meeting
          </p>
          {imminent && (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11.5px] font-medium text-accent-soft">
              Starting soon
            </span>
          )}
        </div>

        <div className="mt-3.5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
              {schedule.time}
            </div>
            <h3 className="mt-2 truncate text-[16px] font-medium text-ink" title={subject}>
              {subject}
            </h3>
            {teacher && <p className="mt-0.5 truncate text-[13px] text-ink-dim">{teacher}</p>}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="calendar" className="h-3.5 w-3.5" />
                {formatWhen(at, now)}
              </span>
              <span className="text-line-strong">|</span>
              <span>{recurrenceLabel(schedule)}</span>
              {isZoom(schedule.url) && (
                <>
                  <span className="text-line-strong">|</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="video" className="h-3.5 w-3.5" />
                    Zoom
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.09em] text-muted">Remaining</div>
              <div className="mt-0.5 text-[22px] font-semibold leading-none tabular-nums text-ink">
                {formatRemaining(remaining)}
              </div>
            </div>
            <Button variant="primary" icon="play" onClick={() => onOpen(schedule)}>
              Open meeting
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onTestWindows(schedule)}>
              Test automatic Zoom launch
            </Button>
          </div>
        </div>
        <p className="mt-4 text-[12px] text-muted">Automatic launch: Browser + Windows fallback</p>
        {diagnostics}
      </div>
    </Card>
  )
}
