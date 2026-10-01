# Windows setup and automation

For a quick install, use the latest [GitHub Release](https://github.com/sardor1411/students-hero/releases). For source setup, dashboard usage, and the release asset list, see the [README](README.md).

## ELMS credentials

For a source checkout, copy `.env.example` to `.env.local` and set `ELMS_USERNAME` and `ELMS_PASSWORD`. The worker reads these server-side; do not add a `VITE_` prefix or commit the file.

On Windows, you can instead use `npm run elms:save-credentials` to save the password using the current Windows account's DPAPI protection. This protects the file at rest, but does not protect it from software running as that same account.

## Background tasks

Run `npm run worker` to start the local API and its catch-up timer. The worker syncs ELMS when auto-sync is enabled and reconciles upcoming wake, Zoom launch, and screenshot occurrences with Windows Task Scheduler.

The ELMS sync task can be installed or removed with:

```powershell
npm run elms:install-task
npm run elms:uninstall-task
```

To refresh upcoming Zoom tasks from the current schedule store:

```powershell
npm run zoom:install-tasks
npm run zoom:remove-tasks
```

Task Scheduler requests wake timers and starts the launch process for the signed-in user. It cannot power on a fully shut-down PC. Whether Windows wakes from Sleep or Hibernate depends on the active power plan, firmware, and device capabilities. Verify behavior on the target machine; task registration alone does not prove that the hardware will wake.

## Runtime data

- In a source checkout, sync state and logs live under `data/`.
- Captured screenshots live under `screen/<date>/` and may contain meeting content.
- The installed app keeps mutable data and logs under `%LOCALAPPDATA%\StudentsHero`.

Keep these directories private and out of commits. For troubleshooting, inspect the dashboard's task diagnostics and local worker logs before reinstalling tasks.

## Build on Windows

Install Node.js `^20.19.0` or `>=22.12.0`, Python with Pillow, and project dependencies. Then:

```powershell
npm ci
npm run lint
npm run build
npm run package:release
```

The release files are generated under `release/`; they are not source files and must not be committed.
