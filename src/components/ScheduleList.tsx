/** Renders every saved schedule, sorted by time of day. */

import type { Schedule, ScheduleFormValues } from '../types/schedule'
import { ScheduleCard } from './ScheduleCard'

interface ScheduleListProps {
  schedules: Schedule[]
  now: Date
  editingId: string | null
  onToggleEnabled: (id: string) => void
  onTest: (schedule: Schedule) => void
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onSaveEdit: (id: string, values: ScheduleFormValues) => void
  onDelete: (id: string) => void
}

export function ScheduleList({ schedules, ...handlers }: ScheduleListProps) {
  if (schedules.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        No schedules yet. Add one above.
      </p>
    )
  }

  const sorted = [...schedules].sort((a, b) => a.time.localeCompare(b.time))

  return (
    <ul className="space-y-3">
      {sorted.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          now={handlers.now}
          isEditing={handlers.editingId === schedule.id}
          onToggleEnabled={handlers.onToggleEnabled}
          onTest={handlers.onTest}
          onStartEdit={handlers.onStartEdit}
          onCancelEdit={handlers.onCancelEdit}
          onSaveEdit={handlers.onSaveEdit}
          onDelete={handlers.onDelete}
        />
      ))}
    </ul>
  )
}
