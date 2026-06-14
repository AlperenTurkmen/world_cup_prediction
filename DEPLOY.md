# Deployment runbook (Phase 7)

Step-by-step to take this app live on **Supabase (Postgres)** + **Vercel
(Next.js)**. End to end it's ~30–45 minutes. Commands assume you run them from
the repo root.

---

## 0. Prerequisites

- A **GitHub** repo with this code (already done: `AlperenTurkmen/world_cup_prediction`).
- A **Supabase** account (free tier is fine).
- A **Vercel** account (Hobby tier is fine).
- Node 18+ locally (for the one-time seed step).

---

## 1. Create the Supabase project & database

1. In the Supabase dashboard → **New project**. Pick a region close to your
   users. Wait for it to provision.
2. Open **SQL Editor → New query**, paste the **entire** contents of
   [`db/schema.sql`](db/schema.sql), and **Run**. This creates the 5 tables,
   `round_weights`, the `leaderboard` view, and the `create_entry` /
   `replace_actual_advancers` / `apply_master_results` functions. It is
   idempotent — safe to re-run after any schema change.
3. Verify a clean install (should return **zero rows, no error**):
   ```sql
   select * from leaderboard;
   select * from round_weights order by weight;   -- 6 rows: R32..CHAMPION
   ```

### Grab your keys

From **Project Settings → API**:

| Value | Used as |
|-------|---------|
| Project URL | `SUPABASE_URL` |
| `service_role` secret key | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ The `service_role` key bypasses Row-Level Security. It is **server-only** —
> never expose it to the browser or commit it. This app never sends it to the
> client (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#3-the-one-rule-supabase-is-server-only)).

---

## 2. Choose the other two secrets

| Var | How to set it |
|-----|---------------|
| `ADMIN_PASSWORD` | Any strong password — this is what you type at `/admin`. |
| `AUTH_SECRET` | A random string that signs the admin cookie. Generate with: `openssl rand -hex 32` |

---

## 3. Seed the 72 group fixtures

The schema does **not** insert fixtures — that's a one-time data load from the
master workbook. Run it locally against production with the two Supabase values:

```bash
npm install
SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR-SERVICE-ROLE-KEY" \
npm run seed
```

Expected output:

```
Seeded 72 group fixtures into "matches".
  e.g. match 1: Mexico vs South Africa
```

(Alternatively put the two values in `.env.local` and just run `npm run seed` —
the script auto-loads `.env.local`.)

Verify in Supabase:

```sql
select count(*) from matches;          -- 72
select match_no, home_team, away_team from matches order by match_no limit 3;
```

---

## 4. Deploy to Vercel

### Via the dashboard (simplest)

1. **Add New… → Project**, import the GitHub repo.
2. Framework preset auto-detects **Next.js**. Leave build settings default
   (`next build`).
3. **Environment Variables** — add all four (for Production, and Preview if you
   want PR previews to work):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD`
   - `AUTH_SECRET`
4. **Deploy**. You'll get a URL like `https://world-cup-prediction.vercel.app`.

### Via the CLI (alternative)

```bash
npm i -g vercel
vercel link            # link to a Vercel project
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add ADMIN_PASSWORD production
vercel env add AUTH_SECRET production
vercel --prod          # build & deploy
```

> If you change env vars after a deploy, **redeploy** for them to take effect.

---

## 5. Smoke test (confirm the scoring math)

Do this on the **live URL** right after deploy.

1. **Upload an entry.** Go to `/upload`, enter a username like `test_user`, and
   upload a filled `WCup_2026` workbook (the master file
   `WCup_2026_4.2.7_en.xlsx` works — its champion is Spain). You should see
   "Entry submitted" with the champion. The leaderboard at `/` now shows the
   player with **0 points** (no results logged yet).
2. **Log a couple of group results.** Go to `/admin`, sign in with
   `ADMIN_PASSWORD`. In **Group results**, set match 1 to exactly the score the
   user predicted (→ should score **3**, exact), and set another match to a
   different score but the same winner (→ **1**, correct result). Save each.
3. **Log a few advancers.** In **Advancement actuals → Finalists**, tick the
   two teams the user predicted to reach the final, Save. A correct finalist is
   worth **8** each.
4. **Check the leaderboard** at `/`. Refresh. Confirm:
   - "Results logged: 2 / 72 group games"
   - the user's **Group** = 3 + 1 = 4, **Bonus** = 8 × (finalists you ticked),
     **Total** = group + bonus, **Exact** = 1.
   - The **Champion pick** column shows their predicted champion.

If those numbers line up, the live scoring pipeline is correct.

### Optional: the admin accelerator

Instead of manual entry, in `/admin` use **Quick import** to upload the filled
master *results* workbook — it sets all 72 group scores and every round's
advancers in one shot (same parser, `apply_master_results`).

---

## 6. How the admin uses it (hand to whoever runs the pool)

1. Collect everyone's filled workbooks; each person uploads their own at
   `/upload` (one entry per name, immutable).
2. As real results come in, go to `/admin` → **Group results** and save scores
   per game. Tick **Advancement actuals** as teams progress (R32 → … →
   Champion).
3. The leaderboard at `/` updates live on every page load. No deploy or
   recompute needed — all scoring is computed on read.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Upload says *"open the file in Excel and save it once"* | The uploaded workbook's knockout cells are blank because Excel never recalculated the bracket. Open + save in Excel/LibreOffice, re-upload. |
| Leaderboard shows *"temporarily unavailable"* | The server can't reach Supabase — check the two `SUPABASE_*` env vars in Vercel, then redeploy. |
| Admin pages show *"No fixtures found"* | The `matches` table isn't seeded — run step 3. |
| `/admin` login always fails | `ADMIN_PASSWORD` not set (or changed without redeploy). |
| Build fails locally with *Missing SUPABASE_URL* | You're on an old build; the client is lazily initialised now — pull latest. |
