/**
 * Stacked toast notifications, bottom-right. Replaces inline banners and is
 * the only notification channel - `alert()` is never used.
 */

import { useEffect } from 'react'
import { Icon, type IconName } from './Icon'

export type ToastKind = 'success' | 'warning' | 'error' | 'info'

export interface ToastItem {
  id: string
  kind: ToastKind
  text: string
}

const TONE: Record<ToastKind, { icon: IconName; color: string }> = {
  success: { icon: 'check', color: 'text-ok' },
  warning: { icon: 'warning', color: 'text-warn' },
  error: { icon: 'warning', color: 'text-danger' },
  info: { icon: 'clock', color: 'text-ink-dim' },
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  // Each toast dismisses itself; the timer is per-toast so a new one does not
  // reset the countdown of the others.
  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(item.id), 4500)
    return () => window.clearTimeout(id)
  }, [item.id, onDismiss])

  const tone = TONE[item.kind]
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-80 items-start gap-2.5 rounded-xl border border-line-strong bg-surface-2/95 px-3.5 py-3 shadow-xl backdrop-blur anim-slide"
    >
      <span className={`mt-0.5 ${tone.color}`}>
        <Icon name={tone.icon} className="h-4 w-4" />
      </span>
      <p className="flex-1 text-[13px] leading-snug text-ink">{item.text}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 rounded-md p-1 text-muted transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toasts({
  items,
  onDismiss,
}: {
  items: ToastItem[]
  onDismiss: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col-reverse gap-2"
    >
      {items.map((item) => (
        <Toast key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
