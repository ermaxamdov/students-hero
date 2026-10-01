/**
 * The add/edit form. The same component is reused for both cases:
 * pass `initialValues` + `submitLabel="Save changes"` to edit.
 */

import { useId, useState } from 'react'
import {
  DAY_LABELS,
  REPEAT_LABELS,
  WEEKDAY_INDEXES,
  type RepeatMode,
  type ScheduleFormValues,
  type WeekdayIndex,
} from '../types/schedule'
import { hasErrors, normalizeUrl, validateForm, type FormErrors } from '../utils/validation'

const EMPTY_FORM: ScheduleFormValues = {
  name: '',
  url: '',
  time: '',
  repeat: 'daily',
  days: [],
}

const REPEAT_OPTIONS: RepeatMode[] = ['once', 'daily', 'weekdays', 'custom']

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[13.5px] text-ink ' +
  'placeholder:text-muted transition-colors focus:border-accent focus:outline-none'

const labelClass = 'mb-1.5 block text-[12.5px] font-medium text-ink-dim'
const errorClass = 'mt-1 text-[12.5px] text-danger'

interface ScheduleFormProps {
  /** Pre-filled values when editing an existing schedule. */
  initialValues?: ScheduleFormValues
  submitLabel?: string
  onSubmit: (values: ScheduleFormValues) => void
  onCancel?: () => void
}

export function ScheduleForm({
  initialValues,
  submitLabel = 'Save schedule',
  onSubmit,
  onCancel,
}: ScheduleFormProps) {
  const [values, setValues] = useState<ScheduleFormValues>(initialValues ?? EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  // Unique per form instance: the add form and an inline edit form are both
  // mounted at the same time, so hard-coded ids would collide and break the
  // <label for> association.
  const uid = useId()
  const fieldId = (field: string) => `${uid}-${field}`

  // NOTE: `initialValues` is intentionally only read for the initial state.
  // The parent re-renders once per second to drive the countdowns, so syncing
  // props into state in an effect would wipe out whatever the user is typing.
  // A different schedule being edited means a different component instance
  // (the cards are keyed by id), so there is nothing to sync.

  function update<K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function toggleDay(day: WeekdayIndex) {
    setValues((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((value) => value !== day)
        : [...current.days, day].sort((a, b) => a - b),
    }))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateForm(values)
    setErrors(nextErrors)
    if (hasErrors(nextErrors)) return

    onSubmit({
      ...values,
      name: values.name.trim(),
      url: normalizeUrl(values.url),
      days: values.repeat === 'custom' ? values.days : [],
    })

    // Only reset when adding; while editing the parent closes the form.
    if (!initialValues) {
      setValues(EMPTY_FORM)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
      <div>
        <label htmlFor={fieldId('name')} className={labelClass}>
          Meeting name <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={fieldId('name')}
          type="text"
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          placeholder="English Lesson"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={fieldId('url')} className={labelClass}>
          Meeting link
        </label>
        <input
          id={fieldId('url')}
          type="url"
          value={values.url}
          onChange={(event) => update('url', event.target.value)}
          placeholder="https://us05web.zoom.us/j/..."
          className={inputClass}
          required
        />
        {errors.url && <p className={errorClass}>{errors.url}</p>}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="sm:w-40">
          <label htmlFor={fieldId('time')} className={labelClass}>
            Time
          </label>
          <input
            id={fieldId('time')}
            type="time"
            value={values.time}
            onChange={(event) => update('time', event.target.value)}
            className={inputClass}
            required
          />
          {errors.time && <p className={errorClass}>{errors.time}</p>}
        </div>

        <div className="flex-1">
          <label htmlFor={fieldId('repeat')} className={labelClass}>
            Repeat
          </label>
          <select
            id={fieldId('repeat')}
            value={values.repeat}
            onChange={(event) => update('repeat', event.target.value as RepeatMode)}
            className={inputClass}
          >
            {REPEAT_OPTIONS.map((mode) => (
              <option key={mode} value={mode}>
                {REPEAT_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {values.repeat === 'custom' && (
        <div>
          <span className={labelClass}>Days</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_INDEXES.map((day) => {
              const selected = values.days.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={selected}
                  className={
                    'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ' +
                    (selected
                      ? 'border-accent bg-accent text-white'
                      : 'border-line-strong bg-surface-2 text-ink-dim hover:border-[#39404c] hover:text-ink')
                  }
                >
                  {DAY_LABELS[day]}
                </button>
              )
            })}
          </div>
          {errors.days && <p className={errorClass}>{errors.days}</p>}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg border border-line-strong bg-surface-3 px-3.5 text-[13.5px] text-ink transition-colors hover:bg-[#252a34]"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="h-9 flex-1 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-soft"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
