# Security Policy

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Instead,
report it privately via GitHub's
[private vulnerability reporting](https://github.com/AlperenTurkmen/world_cup_prediction/security/advisories/new)
(repo → **Security** tab → **Report a vulnerability**).

Please include steps to reproduce and the potential impact. You'll get a
response as soon as reasonably possible.

## Handling of secrets

This app relies on several secrets, all kept in environment variables and
**never** committed:

- `SUPABASE_SERVICE_ROLE_KEY` — bypasses Postgres Row-Level Security; used
  **server-side only** and never sent to the browser.
- `AUTH_SECRET` — signs admin/player session cookies (HMAC).
- `ADMIN_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `FOOTBALL_DATA_API_KEY`,
  `SYNC_SECRET`.

`.env.local` is gitignored. If you fork this repo, generate your **own** secrets
— never reuse the example values, and treat the service-role key like a database
password.

## Design notes relevant to security

- All database access goes through a server-only Supabase client
  (`lib/supabaseAdmin.ts`); the browser never talks to the database directly.
- Privileged API routes verify a signed, httpOnly session cookie server-side.
- The results-sync endpoint (`POST /api/sync`) requires either an admin session
  or a bearer `SYNC_SECRET`, checked in constant time.
