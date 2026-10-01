/**
 * Daily-sync timing logic.
 *
 * Kept pure and separate so the "runs at 05:00" behaviour can be tested at
 * any time of day without waiting for the clock.
 *
 * All computation uses the machine's local time (Asia/Tashkent on the target
 * machine), never UTC.
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseSyncTime(time: string): { hours: number; minutes: number } | null {
  const match = TIME_RE.exec(time)
  if (!match) return null
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

/** The sync moment on the same local calendar day as `base`. */
export function syncMomentOn(base: Date, time: string, dayOffset = 0): Date | null {
  const parsed = parseSyncTime(time)
  if (!parsed) return null
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    parsed.hours,
    parsed.minutes,
    0,
    0,
  )
}

/**
 * The next time the sync should run.
 *
 * If today's slot is still ahead, that's it; otherwise tomorrow's.
 * `lastSyncAt` is not consulted here - this is purely "when is the next slot".
 */
export function nextSyncAt(time: string, from: Date = new Date()): Date | null {
  const today = syncMomentOn(from, time)
  if (!today) return null
  if (today.getTime() > from.getTime()) return today
  return syncMomentOn(from, time, 1)
}

/**
 * The most recent sync slot at or before `now`.
 *
 * If today's slot has already passed this is today's; otherwise yesterday's.
 * This is the anchor for "have we synced for the current cycle yet?".
 */
export function lastSlotAtOrBefore(time: string, now: Date = new Date()): Date | null {
  const today = syncMomentOn(now, time)
  if (!today) return null
  if (today.getTime() <= now.getTime()) return today
  return syncMomentOn(now, time, -1)
}

/**
 * Should a sync run right now?
 *
 * True when we have not synced since the most recent slot. Expressed this way
 * it handles every case correctly:
 *
 *  - fires exactly at 05:00        -> last sync was before today's slot  -> yes
 *  - fires twice in a row at 05:05 -> last sync is after the slot        -> no
 *  - PC asleep at 05:00, wakes 09:00 -> still before today's slot        -> yes
 *  - invoked at 03:00 having last synced yesterday 05:00 -> anchor is
 *    yesterday's slot, already synced -> no
 *  - invoked at 03:00 having not synced for days -> yes (genuine catch-up)
 *
 * Note it deliberately does NOT reject "before today's slot": the relevant
 * question is whether the current cycle has been covered, not what the wall
 * clock says.
 */
export function isSyncDue(
  time: string,
  lastSyncAt: string | undefined,
  now: Date = new Date(),
): boolean {
  const slot = lastSlotAtOrBefore(time, now)
  if (!slot) return false

  if (!lastSyncAt) return true
  const last = new Date(lastSyncAt)
  if (Number.isNaN(last.getTime())) return true

  return last.getTime() < slot.getTime()
}

/** `29.09.2026 05:00` - the display format the UI asks for. */
export function formatDisplay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
