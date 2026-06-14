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

## Documentation

| Doc | Read it for |
|-----|-------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **Start here as a developer.** Full architecture, data model, the parser, scoring, every API route, conventions, and how to make common changes. |
| [`DEPLOY.md`](DEPLOY.md) | Step-by-step Supabase + Vercel deployment and the live smoke test. |
| [`db/README.md`](db/README.md) | Running/verifying the SQL schema; scoring reference. |
| [`WORLD_CUP_2026_PLAN.md`](WORLD_CUP_2026_PLAN.md) | The original product spec. |

## Build progress

| Phase | Description                         | Status |
|------:|-------------------------------------|--------|
| 0     | Scaffold (Next.js app, routes, server-only Supabase client) | ✅ Done |
| 1     | Database (schema + live `leaderboard` view) | ✅ Done — [`db/`](db/) |
| 2     | Parser + seed (`lib/parseWorkbook.ts`, `scripts/seed.ts`) | ✅ Done — [`lib/`](lib/parseWorkbook.ts), [`scripts/`](scripts/seed.ts) |
| 3     | Upload flow (`/upload` + `POST /api/upload`) | ✅ Done — [`app/upload`](app/upload/page.tsx), [`app/api/upload`](app/api/upload/route.ts) |
| 4     | Leaderboard page (`/`) | ✅ Done — [`app/page.tsx`](app/page.tsx) |
| 5     | Admin results entry (`/admin`) | ✅ Done — [`app/admin`](app/admin/page.tsx), [`app/api/admin`](app/api/admin/login/route.ts) |
| 6     | Polish (mobile, error/empty states) | ✅ Done — [`app/Header.tsx`](app/Header.tsx) |
| 7     | Deploy to Vercel | 📘 Runbook ready — [`DEPLOY.md`](DEPLOY.md) (your action: create Supabase + Vercel, run schema, seed, smoke test) |

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the four env vars (see below)
npm run dev
```

### Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build + typecheck |
| `npm test` | Run the parser fixture test against the master workbook |
| `npm run seed` | Insert the 72 group fixtures into the `matches` table (needs Supabase env vars) |

## The Excel parser

`lib/parseWorkbook.ts` extracts predictions from a filled copy of the master
workbook by **anchor-scanning** the `World Cup` sheet (PLAN §S2): each match has
a static integer label 1–104, and teams/scores sit at fixed offsets from it.
Group/R32/R16 read teams at `c+1`/`c+2`; QF and deeper at `c+1`/`c+3`; the
champion at `c+7` from the match-104 anchor. Every name is validated against the
canonical 48-team list built from the `Matches` sheet. A non-recalced file
(blank knockout formulas) is rejected with a "open and save in Excel" message.

The parser fixture test (`lib/parseWorkbook.test.ts`, run via `npm test`)
guards this against the master workbook: 72 group rows, advancer counts
32/16/8/4/2, champion = Spain, and group names equal to the `Matches` pairs.

## Admin (`/admin`)

`/admin` is gated by a password (`ADMIN_PASSWORD`). A successful login sets a
signed, httpOnly session cookie (HMAC keyed by `AUTH_SECRET`, 7-day expiry);
every admin API verifies it server-side. Once in, the admin can:

- **Quick import** — upload the filled master *results* workbook to set all 72
  group scores and every round's advancers at once (runs the same
  `parseWorkbook`, then `apply_master_results` in one transaction).
- **Group results** — enter/clear each game's score (saved per row).
- **Advancement actuals** — tick the teams that reached each round; each Save
  replaces that round's set (`replace_actual_advancers`).

The leaderboard reflects all of these live on the next page load.

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
