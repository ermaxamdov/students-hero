/**
 * One saved schedule, rendered as a simple card.
 *
 * When the card is in edit mode the parent swaps the body for a
 * `<ScheduleForm />` - this component only renders the read-only view plus its
 * action buttons.
 */

import { DAY_LABELS, REPEAT_LABELS, type Schedule, type ScheduleFormValues } from '../types/schedule'
import {
  formatCountdown,
  formatNextOpening,
  getNextOccurrence,
  isCompletedOnce,
} from '../utils/scheduler'
import { ScheduleForm } from './ScheduleForm'

interface ScheduleCardProps {
  schedule: Schedule
  /** Shared "now", ticked once per second by `App` so countdowns stay in sync. */
  now: Date
  isEditing: boolean
  onToggleEnabled: (id: string) => void
  onTest: (schedule: Schedule) => void
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onSaveEdit: (id: string, values: ScheduleFormValues) => void
  onDelete: (id: string) => void
}

function repeatDescription(schedule: Schedule): string {
  if (schedule.repeat === 'custom') {
    const days = schedule.days ?? []
    if (days.length === 0) return 'Custom days (none selected)'
    return days.map((day) => DAY_LABELS[day]).join(', ')
  }
  return REPEAT_LABELS[schedule.repeat]
}

const actionButtonClass =
  'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'

export function ScheduleCard({
  schedule,
  now,
  isEditing,
  onToggleEnabled,
  onTest,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: ScheduleCardProps) {
  if (isEditing) {
    const initialValues: ScheduleFormValues = {
      name: schedule.name,
      url: schedule.url,
      time: schedule.time,
      repeat: schedule.repeat,
      days: schedule.days ?? [],
    }
    return (
      <li className="rounded-xl border border-gray-300 bg-white p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-500">Edit schedule</h3>
        <ScheduleForm
          initialValues={initialValues}
          submitLabel="Save changes"
          onSubmit={(values) => onSaveEdit(schedule.id, values)}
          onCancel={onCancelEdit}
        />
      </li>
    )
  }

  const next = schedule.enabled ? getNextOccurrence(schedule, now) : null
  const completed = isCompletedOnce(schedule)

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-gray-900">
            {schedule.name || 'Untitled meeting'}
          </h3>
          <p className="mt-0.5 text-sm text-gray-600">
            <span className="font-mono">{schedule.time}</span>
            {' \u2022 '}
            {repeatDescription(schedule)}
          </p>
        </div>

        {/* Enable / disable toggle */}
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={() => onToggleEnabled(schedule.id)}
            className="h-4 w-4 accent-gray-900"
          />
          {schedule.enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>

      <a
        href={schedule.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 block truncate text-sm text-blue-700 hover:underline"
        title={schedule.url}
      >
        {schedule.url}
      </a>

      <div className="mt-3 text-sm">
        {next ? (
          <>
            <p className="text-gray-500">Next opening in:</p>
            <p className="font-mono text-base text-gray-900">
              {formatCountdown(next.getTime() - now.getTime())}
            </p>
            <p className="text-gray-500">{formatNextOpening(next, now)}</p>
          </>
        ) : completed ? (
          <p className="text-gray-500">Completed &mdash; this one-time schedule already opened.</p>
        ) : schedule.enabled ? (
          <p className="text-gray-500">No upcoming opening.</p>
        ) : (
          <p className="text-gray-500">Disabled &mdash; it will not open automatically.</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onTest(schedule)} className={actionButtonClass}>
          Test
        </button>
        <button
          type="button"
          onClick={() => onStartEdit(schedule.id)}
          className={actionButtonClass}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(schedule.id)}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </li>
  )
}
