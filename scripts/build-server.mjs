/**
 * Bundle the Node worker into plain .js files that Windows Task Scheduler can
 * run with a bare `node dist-server/elms-sync.js` - no TypeScript loader, no
 * Vite, no dev server.
 */

import { build } from 'esbuild'

await build({
  entryPoints: {
    'elms-sync': 'server/elms-sync.ts',
    worker: 'server/worker.ts',
    'zoom-tasks': 'server/zoomTasks.ts',
  },
  outdir: 'dist-server',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: true,
  // Keep the output readable so it can be audited.
  minify: false,
  sourcemap: false,
  // Everything is first-party + node builtins, so nothing to externalize.
  logLevel: 'info',
})

console.log('server bundled -> dist-server/')
