# Architecture

StudentHero is a local-first application with three cooperating parts:

1. **React dashboard (`src/`)** manages manual schedules, displays ELMS sync state, and talks to the worker over a loopback HTTP API.
2. **Node worker (`server/`)** syncs the ELMS timetable, stores local state, exposes the dashboard API on `127.0.0.1`, and reconciles Windows tasks.
3. **Windows automation (`scripts/`)** runs per-occurrence wake, Zoom launch, and screenshot tasks through Task Scheduler.

The Electron bootstrapper in `installer/app/` checks the latest published GitHub Release (at most once every six hours), downloads that release's tagged source archive, installs a compatible Node runtime and dependencies, then starts the worker and dashboard. The Electron builder configuration packages the bootstrapper as the Windows installer.

## Local data

| Data | Location |
|---|---|
| ELMS configuration | `.env.local` or a DPAPI-protected credential file |
| Worker schedules, tokens, and sync state | `data/` |
| Worker and automation logs | `data/` and `%LOCALAPPDATA%\StudentsHero\logs` |
| Zoom screenshots | `screen/<date>/` |
| Portable Node runtime (installed app) | `%LOCALAPPDATA%\StudentsHero\runtime\` |

These paths are local runtime data and must not be committed. In particular, screenshots may contain personal or class information.

## Release artifacts

The Windows release workflow runs `npm run package:release` and attaches:

- `StudentHero-Setup.exe`
- `StudentHero-Windows-x64.zip`
- `SHA256SUMS.txt`

The ZIP contains the unpacked Electron bootstrapper. On initial setup and update, the bootstrapper retrieves the source archive for the latest published release tag. If the release service is temporarily unavailable, an already-installed copy continues to launch using its current release.
