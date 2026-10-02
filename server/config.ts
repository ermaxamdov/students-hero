/**
 * Worker configuration and credential loading.
 *
 * Credentials are read, in order of preference:
 *   1. `elms-credentials.dat` - encrypted with Windows DPAPI, decryptable only
 *      by the current Windows user account on this machine.
 *   2. `.env.local` - plaintext, gitignored.
 *
 * Nothing here is ever exposed to the browser: Vite only inlines `VITE_*`
 * variables, and these are deliberately not named that way.
 *
 * The password is never logged, never written to the store, and never sent
 * anywhere except api-elms.tuit.uz over HTTPS.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accountIdForUsername } from '../src/utils/account'

/** Project root, resolved from this file's location at runtime. */
export function projectRoot(): string {
  // When bundled we sit in <root>/dist-server, when run from source in
  // <root>/server - both are one level below the project root.
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..')
}

export const DATA_ROOT = () => resolve(process.env.STUDENTHERO_DATA_ROOT || projectRoot())
export const DATA_DIR = () => join(DATA_ROOT(), 'data')
export const STORE_PATH = () => join(DATA_DIR(), 'sync-store.json')
export const LOG_PATH = () => join(DATA_DIR(), 'elms-sync.log')
export const CREDENTIALS_DAT = () => join(DATA_ROOT(), 'elms-credentials.dat')
export const RESET_MARKER = () => join(DATA_ROOT(), 'logout.lock')

export interface WorkerConfig {
  username: string
  accountId: string | null
  password: string
  syncTime: string
  port: number
  /** Which source the password came from, for diagnostics (never the value). */
  credentialSource: 'dpapi' | 'env' | 'none'
}

/** Minimal .env parser - avoids adding a dependency for four keys. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  const text = readFileSync(path, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Strip matching surrounding quotes, if any.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Decrypt the DPAPI credential file via PowerShell.
 *
 * DPAPI ties the ciphertext to the current Windows user, so even someone with
 * the file cannot read it from another account. Returns null when unavailable.
 */
function readDpapiPassword(): string | null {
  const path = CREDENTIALS_DAT()
  if (!existsSync(path) || process.platform !== 'win32') return null
  try {
    const script = [
      '$ErrorActionPreference = "Stop";',
      'Add-Type -AssemblyName System.Security;',
      `$b = [Convert]::FromBase64String((Get-Content -Raw -LiteralPath '${path}').Trim());`,
      '$p = [System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, "CurrentUser");',
      '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($p));',
    ].join(' ')
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true },
    )
    const value = out.trim()
    return value === '' ? null : value
  } catch {
    // Wrong user, corrupted file, or PowerShell blocked.
    return null
  }
}

export function loadConfig(): WorkerConfig {
  const env = { ...parseEnvFile(join(DATA_ROOT(), '.env.local')), ...process.env }

  const username = (env.ELMS_USERNAME ?? '').trim()
  const syncTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(env.ELMS_SYNC_TIME ?? '')
    ? (env.ELMS_SYNC_TIME as string)
    : '05:00'
  const port = Number(env.ELMS_API_PORT ?? 8787) || 8787

  // Prefer the Windows-encrypted password over the plaintext env value.
  const dpapi = readDpapiPassword()
  const password = dpapi ?? (env.ELMS_PASSWORD ?? '')

  return {
    username,
    accountId: accountIdForUsername(username),
    password,
    syncTime,
    port,
    credentialSource: dpapi ? 'dpapi' : password ? 'env' : 'none',
  }
}

export function hasCredentials(config: WorkerConfig): boolean {
  return config.username !== '' && config.password !== ''
}
