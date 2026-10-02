# Architecture

StudentHero is a local-first application with three cooperating parts:

1. **React dashboard (`src/`)** manages manual schedules, displays ELMS sync state, and talks to the worker over a loopback HTTP API.
2. **Node worker (`server/`)** syncs the ELMS timetable, stores local state, exposes the dashboard API on `127.0.0.1`, and reconciles Windows tasks.
3. **Windows automation (`scripts/`)** runs per-occurrence wake, Zoom launch, and screenshot tasks through Task Scheduler.

The packaged Electron app in `installer/app/` starts the bundled Node.js runtime and compiled worker directly. It serves the built React dashboard on loopback and opens it in an Electron window. Both Windows release formats include the UI, worker, automation scripts, StudentHero icon, and Node runtime. Normal app startup does not run an installer or download source code.

## Local data and account lifecycle

| Data | Location |
|---|---|
| ELMS configuration | Development `.env.local`; packaged app DPAPI-protected credential file |
| Worker schedules, tokens, and sync state | `data/` (`app.getPath('userData')\data` in the packaged app) |
| Worker and automation logs | `data/` and `%LOCALAPPDATA%\StudentsHero\logs` |
| Zoom screenshots | `screen/<date>/` (`app.getPath('userData')\screen` in the packaged app) |
| Packaged app's mutable configuration and credentials | `app.getPath('userData')` (normally `%APPDATA%\StudentHero`) |

The ELMS account identity is a normalized, non-secret `accountId` derived from the username. It scopes worker state and every imported schedule; manual schedules are local-only but are intentionally included in the same account wipe so they cannot leak into the next login.

Logout is an account reset transaction: the renderer cancels requests and invalidates late callbacks, the worker writes a shared `logout.lock`, aborts active sync, waits for task reconciliation, removes only StudentHero-owned Task Scheduler entries, deletes local account data, resets in-memory configuration, and verifies the empty state before reporting success. Automation scripts honor the same lock, so a launch or screenshot process cannot recreate account data during reset. A subsequent login starts from an empty store and bootstraps only the newly authenticated account.

These paths are local runtime data and must not be committed. In particular, screenshots may contain personal or class information.

## Release artifacts

The Windows release workflow runs `npm run package:release` and attaches:

- `StudentHero-Setup.exe`
- `StudentHero-Windows-x64.zip`
- `checksums.txt`

The ZIP is a self-contained unpacked Electron application. The installer installs or updates the app; neither format depends on a repository checkout or globally installed Node.js.
