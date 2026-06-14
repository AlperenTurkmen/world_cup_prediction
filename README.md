# World Cup 2026 Predictions Leaderboard

A small web app where friends upload a filled copy of the Hermann Baum
"WCup_2026" Excel bracket, and a live leaderboard scores their group-stage
scorelines and knockout advancement picks.

**Stack:** Next.js (App Router) + TypeScript + Tailwind · Supabase (Postgres,
server-only) · SheetJS (`xlsx`) for parsing · deployed on Vercel.

The authoritative spec and phased build order live in
[`WORLD_CUP_2026_PLAN.md`](WORLD_CUP_2026_PLAN.md). Architectural rules that are
easy to get wrong are summarized in [`CLAUDE.md`](CLAUDE.md) — most importantly:
**Supabase is server-only; the service-role client is never imported into a
Client Component.**

## Build progress

| Phase | Description                         | Status |
|------:|-------------------------------------|--------|
| 0     | Scaffold (Next.js app, routes, server-only Supabase client) | ✅ Done |
| 1     | Database (schema + live `leaderboard` view) | ✅ Done — [`db/`](db/) |
| 2     | Parser + seed (`lib/parseWorkbook.ts`, `scripts/seed.ts`) | ⬜ Next |
| 3     | Upload flow (`/upload` + `POST /api/upload`) | ⬜ |
| 4     | Leaderboard page (`/`) | ⬜ |
| 5     | Admin results entry (`/admin`) | ⬜ |
| 6     | Polish (mobile, error/empty states) | ⬜ |
| 7     | Deploy to Vercel | ⬜ |

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the four env vars (see below)
npm run dev
```

### Environment variables (`.env.local`, and in Vercel)

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — **server only**, never shipped to the client |
| `ADMIN_PASSWORD` | Password for the `/admin` results-entry page |
| `AUTH_SECRET` | Random string used to sign the admin cookie (`openssl rand -hex 32`) |

## Database

The Postgres schema and the live scoring view are in
[`db/schema.sql`](db/schema.sql). Run it once in the Supabase SQL editor — see
[`db/README.md`](db/README.md) for the run/verify steps and a scoring-rules
reference.
