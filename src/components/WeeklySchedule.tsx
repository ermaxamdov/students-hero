/**
 * Lightweight weekly view.
 *
 * ELMS lessons recur weekly, so a day-tab strip reads far better than one
 * long flat list. Today is highlighted and selected by default.
 */

import type { Schedule } from '../types/schedule'
import { byTimeThenName, DAY_SHORT, occursOnWeekday, WEEK_ORDER } from '../utils/presentation'
import { ScheduleRow } from './ScheduleRow'
import { EmptyState } from './ui/primitives'

interface WeeklyScheduleProps {
  schedules: Schedule[]
  now: Date
  selectedDay: number
  onSelectDay: (day: number) => void
  onOpen: (schedule: Schedule) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onToggleEnabled: (id: string) => void
  onSyncElms: () => void
}

export function WeeklySchedule({
  schedules,
  now,
  selectedDay,
  onSelectDay,
  onOpen,
  onEdit,
  onDelete,
  onToggleEnabled,
  onSyncElms,
}: WeeklyScheduleProps) {
  const today = now.getDay()
  const countFor = (day: number) => schedules.filter((s) => occursOnWeekday(s, day)).length
  const dayLessons = schedules
    .filter((schedule) => occursOnWeekday(schedule, selectedDay))
    .sort(byTimeThenName)

  return (
    <div>
      {/* Day tabs */}
      <div
        role="tablist"
        aria-label="Weekly schedule"
        className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface/60 p-1"
      >
        {WEEK_ORDER.map((day) => {
          const selected = day === selectedDay
          const isToday = day === today
          const count = countFor(day)
          return (
            <button
              key={day}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelectDay(day)}
              className={`relative flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                selected
                  ? 'bg-surface-3 text-ink'
                  : 'text-muted hover:bg-surface-2 hover:text-ink-dim'
              }`}
            >
              <span className={isToday && !selected ? 'text-accent-soft' : undefined}>
                {DAY_SHORT[day]}
              </span>
              {count > 0 && (
                <span
                  className={`ml-1.5 tabular-nums ${selected ? 'text-ink-dim' : 'text-muted'}`}
                >
                  {count}
                </span>
              )}
              {isToday && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-px h-px rounded-full bg-accent"
                />
              )}
            </button>
          )
        })}
      </div>

      {dayLessons.length === 0 ? (
        <EmptyState
          title={
            selectedDay === today ? 'No meetings scheduled today.' : 'Nothing scheduled this day.'
          }
          body="Add a meeting manually or sync your ELMS timetable."
        />
      ) : (
        <ul className="space-y-2">
          {dayLessons.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              now={now}
              showCountdown={selectedDay === today}
              onOpen={onOpen}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleEnabled={onToggleEnabled}
            />
          ))}
        </ul>
      )}

      {dayLessons.length === 0 && schedules.length === 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onSyncElms}
            className="text-[13px] text-accent-soft hover:underline"
          >
            Sync ELMS now
          </button>
        </div>
      )}
    </div>
  )
}
