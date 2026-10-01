/**
 * One-shot sync entry point. This is what Windows Task Scheduler runs at
 * 05:00, and it works with no browser and no Vite dev server running.
 *
 *   node dist-server/elms-sync.js            # sync if due (used by the task)
 *   node dist-server/elms-sync.js --force    # sync regardless of timing
 *   node dist-server/elms-sync.js --status   # print current state, no network
 */

import { loadConfig } from './config'
import { formatDisplay, isSyncDue, nextSyncAt } from './schedule'
import { loadStore } from './store'
import { log, runSync } from './sync'

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2))
  const config = loadConfig()
  const store = loadStore(config.syncTime)

  if (args.has('--status')) {
    const next = nextSyncAt(store.syncTime)
    process.stdout.write(
      JSON.stringify(
        {
          autoSyncEnabled: store.autoSyncEnabled,
          syncTime: store.syncTime,
          wakeOffsetMinutes: store.wakeOffsetMinutes,
          lastSync: store.lastSync,
          nextSync: next ? next.toISOString() : null,
          nextSyncDisplay: next ? formatDisplay(next) : null,
          scheduleCount: store.schedules.length,
          credentialSource: config.credentialSource,
        },
        null,
        2,
      ) + '\n',
    )
    return 0
  }

  const force = args.has('--force')

  // The scheduled task fires at 05:00, so timing is already correct; the
  // due-check matters for catch-up runs (e.g. the PC woke up late).
  if (!force) {
    if (!store.autoSyncEnabled) {
      log('auto-sync is disabled - nothing to do')
      return 0
    }
    if (!isSyncDue(store.syncTime, store.lastSync.at)) {
      log(`not due yet (sync time ${store.syncTime}, last ${store.lastSync.at ?? 'never'})`)
      return 0
    }
  }

  const { status } = await runSync(config)
  return status.state === 'success' ? 0 : 1
}

main()
  .then((code) => {
    // Set the exit code instead of calling process.exit(): an abrupt exit
    // while Node's undici/keep-alive sockets are still closing triggers a
    // libuv assertion on Windows. Letting the loop drain avoids it.
    process.exitCode = code
  })
  .catch((error: unknown) => {
    log(`fatal: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
