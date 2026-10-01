/**
 * Compact horizontal schedule row.
 *
 * The time is the visual anchor on the left; the URL is hidden behind a
 * details disclosure rather than shown in full.
 */

import { useEffect, useRef, useState } from 'react'
import type { Schedule } from '../types/schedule'
import { getNextOccurrence } from '../utils/scheduler'
import {
  formatRemaining,
  isZoom,
  prettyUrl,
  recurrenceLabel,
  splitName,
} from '../utils/presentation'
import { Icon } from './ui/Icon'
import { StatusDot } from './ui/primitives'

interface ScheduleRowProps {
  schedule: Schedule
  now: Date
  /** Show the live countdown (suppressed in the weekly day view). */
  showCountdown?: boolean
  /**
   * Narrow column variant: drops the countdown and the "Enabled" wording so
   * the subject keeps enough room in the sidebar list.
   */
  compact?: boolean
  onOpen: (schedule: Schedule) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onToggleEnabled: (id: string) => void
}

export function ScheduleRow({
  schedule,
  now,
  showCountdown = true,
  compact = false,
  onOpen,
  onEdit,
  onDelete,
  onToggleEnabled,
}: ScheduleRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the row menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const { subject, teacher } = splitName(schedule)
  const next = schedule.enabled ? getNextOccurrence(schedule, now) : null
  const completed = schedule.repeat === 'once' && !schedule.enabled && Boolean(schedule.lastRun)

  return (
    <li
      className={`group relative rounded-xl border border-line bg-surface/60 px-3.5 py-3 card-hover ${
        schedule.enabled ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center gap-3.5">
        {/* Time anchor */}
        <div className="w-[52px] shrink-0">
          <div className="text-[16px] font-semibold leading-none tabular-nums text-ink">
            {schedule.time}
          </div>
        </div>

        {/* Subject + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-medium text-ink" title={subject}>
              {subject}
            </h3>
            {schedule.stale && (
              <span
                title="No longer in the ELMS timetable"
                className="shrink-0 rounded-md border border-[#4a3a20] bg-[#241f14] px-1.5 py-0.5 text-[10.5px] font-medium text-warn"
              >
                Stale
              </span>
            )}
          </div>
          {teacher && <p className="truncate text-[12.5px] text-ink-dim">{teacher}</p>}
          <div className="mt-1 flex items-center gap-2 truncate text-[12px] text-muted">
            <span className="shrink-0">{recurrenceLabel(schedule)}</span>
            <span className="text-line-strong">|</span>
            <span className="shrink-0">Automatic · Browser + Windows</span>
            {isZoom(schedule.url) && (
              <>
                <span className="text-line-strong">|</span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <Icon name="video" className="h-3 w-3" />
                  Zoom
                </span>
              </>
            )}
            {schedule.source === 'elms' && !compact && (
              <>
                <span className="text-line-strong">|</span>
                <span className="shrink-0">ELMS</span>
              </>
            )}
            {/* In the narrow column the countdown rides along with the meta. */}
            {compact && next && (
              <>
                <span className="text-line-strong">|</span>
                <span className="shrink-0 tabular-nums text-ink-dim">
                  {formatRemaining(next.getTime() - now.getTime())}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Countdown */}
        {showCountdown && !compact && (
          <div className="hidden w-[74px] shrink-0 text-right sm:block">
            {next ? (
              <span className="text-[12.5px] tabular-nums text-ink-dim">
                {formatRemaining(next.getTime() - now.getTime())}
              </span>
            ) : (
              <span className="text-[12.5px] text-muted">{completed ? 'Done' : '\u2014'}</span>
            )}
          </div>
        )}

        {/* Enabled state */}
        <button
          type="button"
          onClick={() => onToggleEnabled(schedule.id)}
          aria-pressed={schedule.enabled}
          aria-label={`${schedule.enabled ? 'Disable' : 'Enable'} ${subject}`}
          title={schedule.enabled ? 'Enabled' : 'Disabled'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink-dim transition-colors hover:bg-surface-3"
        >
          <StatusDot tone={schedule.enabled ? 'ok' : 'idle'} />
          {!compact && (
            <span className="hidden md:inline">{schedule.enabled ? 'Enabled' : 'Disabled'}</span>
          )}
        </button>

        {/* Row actions */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={`Actions for ${subject}`}
            aria-expanded={menuOpen}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="dots" className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-line-strong bg-surface-2 py-1 shadow-xl anim-pop">
              {[
                { icon: 'play', label: 'Open now', run: () => onOpen(schedule) },
                {
                  icon: 'link',
                  label: detailsOpen ? 'Hide link' : 'Show link',
                  run: () => setDetailsOpen((open) => !open),
                },
                { icon: 'edit', label: 'Edit', run: () => onEdit(schedule.id) },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    item.run()
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <Icon name={item.icon as 'play'} className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              ))}
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete(schedule.id)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-[#2a1b1b]"
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* The full URL only appears on request. */}
      {detailsOpen && (
        <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5 anim-fade">
          <Icon name="link" className="h-3.5 w-3.5 shrink-0 text-muted" />
          <a
            href={schedule.url}
            target="_blank"
            rel="noopener noreferrer"
            title={schedule.url}
            className="truncate font-mono text-[12px] text-accent-soft hover:underline"
          >
            {prettyUrl(schedule.url)}
          </a>
          <Icon name="external" className="h-3 w-3 shrink-0 text-muted" />
        </div>
      )}
    </li>
  )
}
