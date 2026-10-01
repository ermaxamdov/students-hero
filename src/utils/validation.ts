/** Form validation helpers for the schedule form. */

import type { ScheduleFormValues } from '../types/schedule'
import { parseTime } from './scheduler'

export interface FormErrors {
  url?: string
  time?: string
  days?: string
}

/**
 * Accept http(s) links and app deep links (zoommtg://, msteams://, ...).
 * A bare "us05web.zoom.us/j/123" gets an `https://` prefix so the user does
 * not have to type it.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  // Already has a scheme like https:// or zoommtg://
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/** Is this something the browser can actually open? */
export function isValidUrl(input: string): boolean {
  const normalized = normalizeUrl(input)
  if (normalized === '') return false
  try {
    const url = new URL(normalized)
    return url.protocol !== '' && url.href !== ''
  } catch {
    return false
  }
}

export function validateForm(values: ScheduleFormValues): FormErrors {
  const errors: FormErrors = {}

  if (values.url.trim() === '') {
    errors.url = 'Meeting link is required.'
  } else if (!isValidUrl(values.url)) {
    errors.url = 'Enter a valid link, for example https://us05web.zoom.us/j/123456789'
  }

  if (values.time.trim() === '') {
    errors.time = 'Time is required.'
  } else if (!parseTime(values.time)) {
    errors.time = 'Enter a valid time in 24-hour format, for example 07:00.'
  }

  if (values.repeat === 'custom' && values.days.length === 0) {
    errors.days = 'Pick at least one day.'
  }

  return errors
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0
}
