# Deployment

Take the app live on **Supabase (Postgres)** + **Vercel (Next.js)**. End to end
it's about 30–45 minutes. This page is the overview; the full runbook with every
command and a scoring smoke-test is in
[`DEPLOY.md`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/DEPLOY.md).

## Prerequisites

- A **GitHub** repo with this code.
- A **Supabase** account (free tier is fine).
- A **Vercel** account (Hobby tier is fine).
- **Node 18+** locally (for the one-time seed step).

## 1. Create the database

In Supabase → **SQL Editor → New query**, paste the entire
[`db/schema.sql`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/db/schema.sql)
and **Run**. It creates the tables, the scoring view, and the functions, and is
idempotent (safe to re-run). Verify with `select * from leaderboard;` — it should
return zero rows, no error.

Grab from **Project Settings → API**: the **Project URL** (`SUPABASE_URL`) and
the **`service_role` secret** (`SUPABASE_SERVICE_ROLE_KEY`).

> ⚠️ The `service_role` key bypasses Row-Level Security. It's **server-only** —
> never expose it to the browser or commit it.

## 2. Choose your secrets

| Var | How to set it |
|-----|---------------|
| `ADMIN_PASSWORD` | Any strong password — what you type at `/admin`. |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From a Google Cloud OAuth client (web app). |
| `FOOTBALL_DATA_API_KEY` | *(optional)* For [results auto-sync](Results-Auto-Sync). |
| `SYNC_SECRET` | *(optional)* `openssl rand -hex 32` for the sync scheduler. |

For Google OAuth, add these authorized redirect URIs to your client:

```
http://localhost:3000/api/auth/google/callback
https://<your-vercel-domain>/api/auth/google/callback
```

## 3. Seed the fixtures

The schema doesn't insert fixtures — load them once from the workbook against
your production database:

```bash
npm install
SUPABASE_URL="YOUR_URL" SUPABASE_SERVICE_ROLE_KEY="YOUR_KEY" npm run seed
```

Expected: `Seeded 72 group fixtures into "matches".`

## 4. Deploy to Vercel

1. **Add New… → Project**, import the GitHub repo. The Next.js preset
   auto-detects.
2. Add the environment variables (Production, and Preview if you want PR
   previews): the six required, plus the two optional sync vars if you want
   auto-sync.
3. **Deploy.** You'll get a URL like `https://<your-app>.vercel.app`.

> Changed an env var after deploying? **Redeploy** for it to take effect.

## 5. Smoke test

On the **live URL**: upload an entry at `/upload`, log a couple of group results
and a few advancers at `/admin`, then confirm the numbers on the leaderboard at
`/`. The full step-by-step with expected point values is in
[`DEPLOY.md`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/DEPLOY.md#5-smoke-test-confirm-the-scoring-math).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Upload says *"open the file in Excel and save it once"* | The workbook's knockout cells are blank — open, save (so formulas recalc), re-upload. |
| Leaderboard *"temporarily unavailable"* | Server can't reach Supabase — check the two `SUPABASE_*` vars, redeploy. |
| Admin *"No fixtures found"* | The `matches` table isn't seeded — run step 3. |
| `/admin` login always fails | `ADMIN_PASSWORD` not set (or changed without a redeploy). |
