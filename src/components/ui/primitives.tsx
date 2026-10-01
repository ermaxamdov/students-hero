/**
 * Shared UI primitives: Button, Card, SectionTitle, StatusDot, Toggle, Modal.
 *
 * Purely presentational - they hold no app state and no scheduling logic.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/* ------------------------------------------------------------------ */
/* Button                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-soft active:brightness-95 shadow-[0_1px_2px_rgba(0,0,0,.4)]',
  secondary:
    'bg-surface-3 text-ink border border-line-strong hover:bg-[#252a34] hover:border-[#39404c]',
  ghost: 'text-ink-dim hover:text-ink hover:bg-surface-3',
  danger: 'bg-transparent text-danger border border-[#4a2b2b] hover:bg-[#2a1b1b]',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[14.5px] gap-2 rounded-xl',
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading ? (
        <Icon name="refresh" className="h-3.5 w-3.5 anim-spin" />
      ) : icon ? (
        <Icon name={icon} className="h-3.5 w-3.5" />
      ) : null}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Card                                                               */
/* ------------------------------------------------------------------ */

interface CardProps {
  children: ReactNode
  className?: string
  /** Adds a hover treatment; use for interactive rows. */
  interactive?: boolean
}

export function Card({ children, className = '', interactive = false }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-line glass ${interactive ? 'card-hover' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

/** Small uppercase label that opens a section. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
        {children}
      </h2>
      {aside}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Status                                                             */
/* ------------------------------------------------------------------ */

export type StatusTone = 'ok' | 'warn' | 'danger' | 'idle' | 'busy'

const DOT_TONE: Record<StatusTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  idle: 'bg-muted',
  busy: 'bg-accent-soft',
}

export function StatusDot({ tone, pulse = false }: { tone: StatusTone; pulse?: boolean }) {
  return (
    <span
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${DOT_TONE[tone]} ${pulse ? 'anim-pulse' : ''}`}
    />
  )
}

/** Subtle pill used for the worker/connection status. */
export function StatusPill({
  tone,
  children,
  pulse = false,
  title,
}: {
  tone: StatusTone
  children: ReactNode
  pulse?: boolean
  title?: string
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2/70 px-2.5 py-1 text-[12.5px] text-ink-dim"
    >
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Toggle                                                             */
/* ------------------------------------------------------------------ */

interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
}

export function Toggle({ checked, onChange, disabled = false, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-50 ${
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-[left] duration-200 ${
          checked ? 'left-[19px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Modal                                                              */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** Wider variant for the settings panel. */
  size?: 'md' | 'lg'
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes; focus moves into the dialog for keyboard users.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 anim-fade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-md'} overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl outline-none anim-pop`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-dim">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-line bg-surface-2/40 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Form field                                                         */
/* ------------------------------------------------------------------ */

export const fieldClass =
  'w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[13.5px] text-ink ' +
  'placeholder:text-muted transition-colors focus:border-accent focus:outline-none'

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-ink-dim">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[12.5px] text-danger">{error}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Empty state                                                        */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = 'calendar',
  title,
  body,
  action,
}: {
  icon?: IconName
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mb-3 rounded-xl border border-line bg-surface-2 p-2.5 text-muted">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-dim">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
