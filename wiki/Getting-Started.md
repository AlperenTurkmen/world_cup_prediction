# Getting Started (local development)

This page gets the app running on your machine. To put it on the internet, see
[Deployment](Deployment).

## Prerequisites

- **Node 18+** and npm.
- A **Supabase** project (free tier is fine) — for the database.
- A **Google Cloud OAuth client** — for player sign-in.
- *(optional)* A **football-data.org** API key — for results auto-sync.

## 1. Clone and install

```bash
git clone https://github.com/AlperenTurkmen/world_cup_prediction.git
cd world_cup_prediction
npm install
```

## 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Required | Where to get it |
|----------|:--------:|-----------------|
| `SUPABASE_URL` | ✅ | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Same page (the `service_role` secret) |
| `ADMIN_PASSWORD` | ✅ | You choose it — used to log into `/admin` |
| `AUTH_SECRET` | ✅ | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | ✅ | Google Cloud Console → OAuth client |
| `GOOGLE_CLIENT_SECRET` | ✅ | Same OAuth client |
| `FOOTBALL_DATA_API_KEY` | ⬜ | [football-data.org](https://www.football-data.org/) |
| `SYNC_SECRET` | ⬜ | `openssl rand -hex 32` |

> ⚠️ `.env.local` is gitignored and must stay that way. The service-role key
> bypasses Postgres Row-Level Security and is **server-only**.

For Google OAuth, add this authorized redirect URI to your OAuth client:
`http://localhost:3000/api/auth/google/callback`.

## 3. Create the database

1. In the Supabase dashboard → **SQL Editor → New query**.
2. Paste the entire contents of
   [`db/schema.sql`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/db/schema.sql)
   and **Run**. It's idempotent — safe to re-run.

## 4. Seed the fixtures

The schema creates tables but not data. Load the 72 group fixtures and the
team→group map from the master workbook:

```bash
npm run seed
```

Expected: `Seeded 72 group fixtures into "matches".`

## 5. Run it

```bash
npm run dev      # http://localhost:3000
```

## Useful commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server with hot reload. |
| `npm run build` | Production build + the most thorough typecheck. |
| `npm test` | Parser, bracket, scoring, and sync unit tests. |
| `npm run seed` | (Re)load fixtures + team→group map. |
| `npx tsx scripts/extractBracket.ts` | Regenerate `lib/bracketData.ts` (only if the workbook changes). |

## Running the tests

```bash
npm test
```

These validate the load-bearing logic against the master workbook fixture: the
parser must extract 72 group rows and the correct advancer counts with champion
"Spain"; bracket derivation must reproduce the workbook's exact Round-of-32
field. Run them after any change to parsing, scoring, or bracket logic.
