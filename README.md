# World Cup 2026 Prediction Leaderboard

**🔗 Live demo: [world-cup-prediction-kappa.vercel.app](https://world-cup-prediction-kappa.vercel.app)**

A web app for running a **FIFA World Cup 2026 prediction pool** with your
friends. Everyone forecasts all 104 matches — group-stage scorelines plus who
advances through every knockout round to the champion — and a live,
multi-dimensional leaderboard scores them as real results come in.

Predictions can be entered two ways: by **uploading a filled copy of the
[Hermann Baum "World Cup" Excel workbook](https://hermann-baum.de/excel/WorldCup/de)**,
or through a **guided in-app stepper** that builds the bracket for you. Results
can be logged by hand in an admin console or **auto-synced from
[football-data.org](https://www.football-data.org/)**.

> **Tech stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS ·
> Supabase (Postgres, server-only) · SheetJS (`xlsx`) · deployed on Vercel.

---

## Features

- **Two ways to predict, one immutable entry**
  - **Excel upload** — upload a filled copy of the master workbook; an
    anchor-scanning parser extracts all 104 predictions.
  - **Manual entry** — a tap-friendly stepper that starts at the next
    un-played game, auto-derives the 32 Round-of-32 teams from your predicted
    group standings, and walks you to a champion. Progress autosaves and is
    resumable across devices.
- **Live multi-dimensional scoring**, computed on read in SQL — exact
  scorelines, goal difference, per-team goals, group rankings, and progressive
  knockout advancement. See [the scoring model](docs/SCORING_DESIGN.md).
- **Fairness gating** — a prediction only scores a result that was logged
  *after* it was submitted, so late entries can't cheat off known outcomes.
- **Accounts & social** — Google sign-in (with an optional username/password
  fallback), player profiles, and follows.
- **Leagues** — public and private (invite-code) leagues, each with its own
  leaderboard and an optional "ignore games before X" start cutoff.
- **Admin console** — log group scores and round-by-round advancers by hand, or
  use the one-click **master-results upload** to populate everything at once.
- **Results auto-sync** — pull real fixtures and scores from football-data.org
  on a schedule. See [`docs/RESULTS_SYNC.md`](docs/RESULTS_SYNC.md).
- **Mobile-friendly** responsive UI.

## How it works

```
            ┌──────────────┐        ┌──────────────────────┐
 Excel ───▶ │ parseWorkbook │──┐    │  Supabase (Postgres) │
            └──────────────┘  │     │                      │
                              ├───▶ │  entries (immutable)  │
 Manual ──▶ deriveBracket ────┘     │  + predictions        │
                                    │  + advancement picks  │
 Admin / football-data.org ───────▶ │  matches / advancers  │
                                    │                      │
                                    │  leaderboard  VIEW ───┼──▶ live scores
                                    └──────────────────────┘
```

Every prediction becomes the **same immutable entry** (72 group scorelines plus
R32→Champion advancement picks) regardless of how it was entered. Nothing is
pre-scored: the `leaderboard` Postgres view recomputes every dimension on each
read, so the standings reflect newly logged results on the next page load with
no recompute step.

For the full picture, start with
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

Requires **Node 18+**.

```bash
git clone https://github.com/AlperenTurkmen/world_cup_prediction.git
cd world_cup_prediction
npm install
cp .env.example .env.local   # fill in the values — see below
npm run dev                  # http://localhost:3000
```

To put data behind it you'll need a Supabase project: run
[`db/schema.sql`](db/schema.sql) in its SQL editor, then `npm run seed` to load
the 72 group fixtures. Full walk-through in [`DEPLOY.md`](DEPLOY.md).

### Environment variables

Copy [`.env.example`](.env.example) to `.env.local` and fill in:

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `SUPABASE_URL` | ✅ | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service-role key — **server-only**, never shipped to the browser. |
| `ADMIN_PASSWORD` | ✅ | Password for the `/admin` results console. |
| `AUTH_SECRET` | ✅ | Random string that signs admin/player/Google-link cookies (`openssl rand -hex 32`). |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client id for player sign-in. |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret for the server-side token exchange. |
| `FOOTBALL_DATA_API_KEY` | ⬜ | Free [football-data.org](https://www.football-data.org/) key for results auto-sync. |
| `SYNC_SECRET` | ⬜ | Bearer token the sync scheduler presents to `POST /api/sync` (`openssl rand -hex 32`). |

> **Never commit `.env.local`** — it's gitignored. The service-role key bypasses
> Postgres Row-Level Security and must stay server-side.

### Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server. |
| `npm run build` | Production build (also the most thorough typecheck). |
| `npm test` | Run the parser, bracket, scoring, and sync unit tests (`node:test`). |
| `npm run seed` | Load the 72 group fixtures + team→group map from the workbook (needs Supabase env vars). |

## Documentation

| Doc | Read it for |
|-----|-------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **Start here as a developer.** Architecture, data model, the parser, scoring, every API route, and conventions. |
| [`docs/SCORING_DESIGN.md`](docs/SCORING_DESIGN.md) | The authoritative scoring model with worked examples. |
| [`docs/RESULTS_SYNC.md`](docs/RESULTS_SYNC.md) | The football-data.org auto-sync: name mapping, advancement writes, scheduling. |
| [`db/README.md`](db/README.md) | Running/verifying the SQL schema and a scoring quick-reference. |
| [`DEPLOY.md`](DEPLOY.md) | Step-by-step Supabase + Vercel deployment and a live smoke test. |
| [`WORLD_CUP_2026_PLAN.md`](WORLD_CUP_2026_PLAN.md) | The original product spec (historical, but still the source of parser cell-offset details). |

A more reader-friendly version of these pages also lives in the
[project Wiki](../../wiki).

## Project structure

```
app/        Next.js App Router — pages, layouts, and API route handlers
lib/        Core logic: workbook parser, bracket derivation, scoring helpers,
            auth, Supabase admin client, football-data sync  (+ *.test.ts)
db/         Re-runnable Postgres schema, migrations, and SQL scoring view
scripts/    One-off tooling: seed, bracket extraction, backups, checks
docs/       Architecture, scoring design, and results-sync references
```

## Security model

The single most important rule:

> **Supabase is server-only.** The service-role key talks to Postgres only from
> server code (`lib/supabaseAdmin.ts`, route handlers, scripts). The browser
> never touches Supabase directly, and the service-role client is **never**
> imported into a Client Component.

Admin and player sessions are signed, httpOnly cookies (HMAC keyed by
`AUTH_SECRET`); every privileged API verifies the cookie server-side.

## License & attribution

The source code is released under the [MIT License](LICENSE).

The bundled `WCup_2026_4.2.7_en.xlsx` workbook is a **third-party work by
Hermann Baum** ([hermann-baum.de](https://hermann-baum.de/excel/WorldCup/de)),
redistributed here for the app to function and **not** covered by the MIT
license. See [`NOTICE.md`](NOTICE.md).
