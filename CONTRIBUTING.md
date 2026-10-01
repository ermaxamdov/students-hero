# Contributing

Thanks for helping improve StudentHero. Changes should stay focused, protect user data, and be testable on the platforms they affect.

## Development setup

- Windows 10/11 x64
- Node.js `^20.19.0` or `>=22.12.0`
- Python with Pillow when rebuilding the installer icon

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Run the worker in a second terminal with `npm run worker`. Add ELMS credentials only to your local `.env.local`; it is ignored by Git.

## Before opening a pull request

```powershell
npm run lint
npm run build
```

For changes to the Electron installer or Windows automation, also validate on Windows. Do not commit generated files from `dist/`, `dist-server/`, `win-unpacked/`, `release/`, installer staging/output, `data/`, or `screen/`.

## Pull requests

- Describe the behavior change and how you verified it.
- Link related issues and include screenshots only when they contain no real class, account, or meeting data.
- Keep credentials, access tokens, local state, and captured meeting screenshots out of commits and issue reports.
