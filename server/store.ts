/**
 * On-disk JSON store.
 *
 * A JSON file is the right choice here rather than SQLite: the dataset is a
 * handful of schedules, there are no queries or concurrent writers, and it
 * keeps the dependency list empty. Writes are atomic (temp file + rename) so
 * a crash mid-write cannot corrupt the store.
 *
 * This is deliberately NOT localStorage: the 05:00 sync must work with no
 * browser running.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createEmptyStore, type SyncStore } from '../src/types/sync'
import { DATA_DIR, STORE_PATH } from './config'

function readJsonFile<T>(path: string): T | null {
  try {
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export function ensureDataDir(): void {
  const dir = DATA_DIR()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadStore(syncTime = '05:00'): SyncStore {
  const path = STORE_PATH()
  if (!existsSync(path)) return createEmptyStore(syncTime)
  try {
    const parsed = readJsonFile<unknown>(path)
    if (typeof parsed !== 'object' || parsed === null) return createEmptyStore(syncTime)
    const candidate = parsed as Partial<SyncStore>
    return {
      version: 1,
      autoSyncEnabled: candidate.autoSyncEnabled === true,
      syncTime:
        typeof candidate.syncTime === 'string' &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.syncTime)
          ? candidate.syncTime
          : syncTime,
      wakeOffsetMinutes:
        Number.isInteger(candidate.wakeOffsetMinutes) &&
        (candidate.wakeOffsetMinutes as number) >= 1 &&
        (candidate.wakeOffsetMinutes as number) <= 60
          ? candidate.wakeOffsetMinutes as number
          : 5,
      screenshotDelayMinutes:
        Number.isInteger(candidate.screenshotDelayMinutes) &&
        (candidate.screenshotDelayMinutes as number) >= 1 &&
        (candidate.screenshotDelayMinutes as number) <= 120
          ? candidate.screenshotDelayMinutes as number
          : 10,
      schedules: Array.isArray(candidate.schedules) ? candidate.schedules : [],
      accountId: typeof candidate.accountId === 'string' ? candidate.accountId : undefined,
      lastSync:
        candidate.lastSync && typeof candidate.lastSync === 'object'
          ? candidate.lastSync
          : { state: 'never' },
      tokens: candidate.tokens,
    }
  } catch {
    // Corrupt file: start clean rather than crashing the scheduled task.
    return createEmptyStore(syncTime)
  }
}

export function saveStore(store: SyncStore): void {
  ensureDataDir()
  const path = STORE_PATH()
  const temp = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8')
  // Atomic replace so readers never see a half-written file.
  renameSync(temp, path)
}
