# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities in a public issue. If private vulnerability reporting is available on the repository's **Security** tab, use it. Otherwise, contact the repository maintainer through their GitHub profile and include a concise description, impact, and reproduction steps.

Do not include live ELMS credentials, access tokens, or real meeting screenshots in a report. Redact local paths and account details where possible.

## Data and local services

- Keep `.env.local`, `data/`, and `screen/` private. The screenshot feature can capture meeting content.
- The worker API is intended to bind to loopback (`127.0.0.1`), not a public or LAN interface.
- On Windows, `npm run elms:save-credentials` stores credentials using DPAPI. A plain-text `.env.local` is supported for local development but should not be shared.
