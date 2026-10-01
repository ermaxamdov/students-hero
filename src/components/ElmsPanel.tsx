/**
 * Manual ELMS import (browser-side, credential login).
 *
 * This is the one-click path that predates the background worker, kept for
 * importing without the worker running. Rendered inside the Settings-adjacent
 * modal rather than on the main screen so it no longer competes with the
 * primary flow. All behaviour is unchanged.
 */

import { useState } from 'react'
import type { ElmsImportResult, ElmsSession } from '../types/elms'
import { ELMS_LOGIN_PAGE } from '../utils/elmsClient'
import { Icon } from './ui/Icon'
import { Button, Field, fieldClass } from './ui/primitives'

export type ElmsStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'success'; text: string }

interface ElmsPanelProps {
  session: ElmsSession | null
  status: ElmsStatus
  preview: ElmsImportResult | null
  groupWeekly: boolean
  onGroupWeeklyChange: (value: boolean) => void
  onImport: () => void
  onLogin: (username: string, password: string) => void
  onLogout: () => void
  onConfirmPreview: () => void
  onDismissPreview: () => void
  needsFirstTimeLogin: boolean
}

export function ElmsPanel({
  session,
  status,
  preview,
  groupWeekly,
  onGroupWeeklyChange,
  onImport,
  onLogin,
  onLogout,
  onConfirmPreview,
  onDismissPreview,
  needsFirstTimeLogin,
}: ElmsPanelProps) {
  const [showLogin, setShowLogin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const busy = status.kind === 'loading'

  function handleLoginSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (username.trim() === '' || password === '') return
    onLogin(username.trim(), password)
    setPassword('')
  }

  const loginVisible = showLogin || (!session && status.kind === 'error')

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-sm text-[13px] text-ink-dim">
          Import your timetable directly from the browser. Useful when the local worker is not
          running.
        </p>
        {session && (
          <div className="text-right">
            {session.username && (
              <p className="text-[12.5px] font-medium text-ink">{session.username}</p>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="text-[12.5px] text-muted underline-offset-2 hover:text-ink-dim hover:underline"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <Button
        variant="primary"
        icon="refresh"
        className="mt-3.5 w-full"
        size="lg"
        loading={busy}
        onClick={session ? onImport : () => setShowLogin(true)}
      >
        {busy ? status.text : "ELMS'dan avtomatik olish"}
      </Button>

      {status.kind === 'error' && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#4a2b2b] bg-[#241a1a]/60 px-3 py-2.5">
          <span className="mt-0.5 text-danger">
            <Icon name="warning" className="h-4 w-4" />
          </span>
          <p className="text-[13px] text-ink-dim">{status.text}</p>
        </div>
      )}
      {status.kind === 'success' && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#234436] bg-[#16241e]/60 px-3 py-2.5">
          <span className="mt-0.5 text-ok">
            <Icon name="check" className="h-4 w-4" />
          </span>
          <p className="text-[13px] text-ink-dim">{status.text}</p>
        </div>
      )}

      {/* ELMS demands a first-time password change; we never bypass it. */}
      {needsFirstTimeLogin && (
        <div className="mt-3 rounded-xl border border-[#4a3a20] bg-[#241f14]/60 px-3 py-2.5">
          <p className="text-[13px] text-ink-dim">
            ELMS birinchi kirishda parolni almashtirishni talab qilmoqda. Buni rasmiy ELMS saytida
            bajaring, so'ng shu yerga qaytib qayta kiring.
          </p>
          <a
            href={ELMS_LOGIN_PAGE}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-accent-soft hover:underline"
          >
            ELMS saytini ochish
            <Icon name="external" className="h-3 w-3" />
          </a>
        </div>
      )}

      {!session && loginVisible && (
        <form onSubmit={handleLoginSubmit} className="mt-4 space-y-3">
          <Field label="ELMS login" htmlFor="elms-username">
            <input
              id="elms-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={fieldClass}
              placeholder="student ID or email"
            />
          </Field>
          <Field label="ELMS parol" htmlFor="elms-password">
            <input
              id="elms-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldClass}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            ELMS'ga ulanish
          </Button>
          <p className="text-[11.5px] leading-relaxed text-muted">
            Sent only to <span className="font-mono">api-elms.tuit.uz</span>. The password is not
            stored &mdash; only the token ELMS returns is kept in this browser.
          </p>
        </form>
      )}

      <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[12.5px] text-ink-dim">
        <input
          type="checkbox"
          checked={groupWeekly}
          onChange={(event) => onGroupWeeklyChange(event.target.checked)}
          className="h-3.5 w-3.5 accent-[#5b6cff]"
        />
        Har hafta takrorlanadigan qilib guruhlash
      </label>

      {preview && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2/50 p-3.5">
          <p className="text-[13px] text-ink-dim">
            {preview.totalLessons} ta dars topildi, shundan{' '}
            <span className="font-medium text-ink">{preview.withLinks.length} tasida</span> havola
            bor.
          </p>

          {preview.withLinks.length > 0 ? (
            <>
              <ul className="mt-2.5 max-h-48 space-y-1 overflow-y-auto pr-1">
                {preview.withLinks.slice(0, 40).map((lesson) => (
                  <li
                    key={`${lesson.id}-${lesson.date}-${lesson.startTime}`}
                    className="flex items-center gap-2.5 text-[12.5px] text-ink-dim"
                  >
                    <span className="tabular-nums text-muted">{lesson.date}</span>
                    <span className="tabular-nums text-ink">{lesson.startTime}</span>
                    <span className="truncate">{lesson.subject}</span>
                  </li>
                ))}
              </ul>
              {preview.withLinks.length > 40 && (
                <p className="mt-1 text-[11.5px] text-muted">
                  ... va yana {preview.withLinks.length - 40} ta
                </p>
              )}
              <div className="mt-3.5 flex gap-2">
                <Button variant="secondary" onClick={onDismissPreview}>
                  Bekor qilish
                </Button>
                <Button variant="primary" className="flex-1" onClick={onConfirmPreview}>
                  Jadvalga qo'shish
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[12.5px] text-muted">
                ELMS jadvalida Zoom/onlayn havola topilmadi. Bu odatda o'qituvchi havolani hali
                kiritmaganini bildiradi.
              </p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={onDismissPreview}>
                Yopish
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
