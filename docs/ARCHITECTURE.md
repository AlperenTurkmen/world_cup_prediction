# Architecture & developer guide

Everything a future developer needs to understand, run, and extend this app.
For deployment specifically, see [`DEPLOY.md`](../DEPLOY.md). For the original
product spec, see [`WORLD_CUP_2026_PLAN.md`](../WORLD_CUP_2026_PLAN.md) (referred
to as "PLAN" below).

---

## 1. What this is

A small web app for a friends-sized World Cup 2026 prediction pool:

- Each participant fills in a copy of the **Hermann Baum "WCup_2026" Excel
  workbook** (a self-calculating bracket) and **uploads it** at `/upload`.
- An **admin** enters the real results at `/admin` (or bulk-imports them from a
  filled master workbook).
- A **leaderboard** at `/` ranks everyone, with all scoring computed live.

One upload per username (immutable). Knockouts are scored by **advancement
only**, never by knockout scoreline.

---

## 2. Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | **Next.js 15** (App Router) + React 19 | Server Components by default |
| Language | **TypeScript** (strict) | |
| Styling | **Tailwind CSS v4** | tokens in `app/globals.css` |
| Database | **Supabase (Postgres)** | accessed **server-only** via service-role key |
| Excel parsing | **SheetJS (`xlsx`)** | reads cached cell values |
| Scripts/tests | **tsx** + `node:test` | `npm run seed`, `npm test` |
| Hosting | **Vercel** (Hobby) | env vars set in project settings |

Runtime: all DB-touching routes set `export const runtime = "nodejs"` (the
`xlsx` parser and `node:crypto` need Node, not Edge).

---

## 3. The one rule: Supabase is server-only

**The service-role key talks to Postgres only from server code. The browser
never touches Supabase.** There is therefore no RLS.

This is enforced mechanically:

- `lib/supabaseAdmin.ts` starts with `import "server-only"` — importing it from
  a Client Component is a **build error**.
- The client is created **lazily** via `getSupabaseAdmin()` (not at module
  load) so that `next build` — which imports route modules during page-data
  collection — doesn't require the env vars to exist at build time. The throw
  for missing vars happens at first use (request time) instead.

If you need data in the browser, fetch it through a server route or a Server
Component — never import `supabaseAdmin` into a `"use client"` file. The same
applies to `lib/adminData.ts` and `lib/adminAuth.ts` (both `server-only`). When
a client component needs a shared *constant or type* from those modules, put it
in a neutral module instead — that's exactly why `lib/rounds.ts` exists.

---

## 4. Data flow at a glance

```
        ┌──────────── PARTICIPANT ────────────┐
        │  fills WCup_2026.xlsx, opens+saves   │
        │  in Excel (recalculates bracket)     │
        └───────────────┬──────────────────────┘
                        │ POST multipart
                        ▼
   /upload (client) ──────► POST /api/upload (server, node)
                                │  parseWorkbook(buffer)  ── lib/parseWorkbook.ts
                                │  → 72 group predictions + advancers
                                ▼
                          rpc create_entry(...)  ── one transaction
                                │  entries + predictions + advancement_predictions
                                ▼
                          ┌───────────── Postgres ─────────────┐
                          │ matches  entries  predictions       │
        ADMIN ──────────► │ advancement_predictions             │
   /admin (server-gated)  │ actual_advancers  round_weights     │
     ├ result   ─────────►│                                     │
     ├ advancers ────────►│  leaderboard VIEW  (live scoring)   │
     └ upload-results ───►│  champion_pick included             │
                          └───────────────┬─────────────────────┘
                                          │ select * (ordered)
                                          ▼
                         / (Server Component) ── renders the table
```

---

## 5. Directory map

```
app/
  layout.tsx            Root layout; mounts the site <Header/>
  Header.tsx            Title + Leaderboard/Upload nav (every page)
  globals.css           Tailwind import + light/dark color tokens
  page.tsx              "/"  Leaderboard (Server Component, force-dynamic)
  upload/page.tsx       "/upload" client form → POST /api/upload
  admin/
    page.tsx            "/admin" server auth gate → login form OR dashboard
    LoginForm.tsx       client: POST /api/admin/login
    LogoutButton.tsx    client: POST /api/admin/logout
    ResultsUpload.tsx   client: master-results import (the accelerator)
    GroupResults.tsx    client: 72-row score table, per-row save
    Advancers.tsx       client: per-round advancer checklists
  api/
    upload/route.ts             POST: parse + create_entry
    admin/login/route.ts        POST: password → signed cookie
    admin/logout/route.ts       POST: clear cookie
    admin/result/route.ts       POST: one group score (cookie-protected)
    admin/advancers/route.ts    POST: replace a round's advancers (protected)
    admin/upload-results/route.ts POST: master import (protected)

lib/
  supabaseAdmin.ts      server-only lazy service-role client
  parseWorkbook.ts      the anchor-scan Excel parser (pure, no DB)
  parseWorkbook.test.ts fixture test (npm test)
  adminAuth.ts          server-only: cookie signing/verify + password check
  adminData.ts          server-only: matches / canonical teams / advancers reads
  rounds.ts             neutral: ADV_ROUNDS + AdvRound (safe for client)

db/
  schema.sql            the whole migration (tables, view, functions)
  README.md             how to run/verify it

scripts/
  seed.ts               load the 72 group fixtures from the master workbook

WCup_2026_4.2.7_en.xlsx The master workbook — parser fixture AND seed source
```

---

## 6. Data model

Full DDL in [`db/schema.sql`](../db/schema.sql). Summary:

| Table | Holds | Key columns |
|-------|-------|-------------|
| `matches` | 72 group fixtures + actual results | `match_no` (1–72, unique), `home_team`, `away_team`, `home_goals`/`away_goals` (NULL until logged) |
| `entries` | one per uploaded sheet | `username` (unique **case-insensitive** via `lower(username)` index), `created_at` |
| `predictions` | a user's 72 group scorelines | `(entry_id, match_id)` unique, `pred_home`/`pred_away` |
| `advancement_predictions` | teams a user predicts per round | PK `(entry_id, round, team)`, `round ∈ {R32,R16,QF,SF,FINAL,CHAMPION}` |
| `actual_advancers` | admin ground truth per round | PK `(round, team)` |
| `round_weights` | the **single source of truth** for knockout weights | `round` PK, `weight` |

Knockout matches are **not** stored in `matches`. There is exactly one
`CHAMPION` row per entry; the other rounds hold many teams.

### Functions (RPCs)

| Function | Called by | What it does |
|----------|-----------|--------------|
| `create_entry(username, predictions jsonb, advancers jsonb)` | `POST /api/upload` | Inserts entry + 72 predictions + all advancers **atomically**. Duplicate username → `unique_violation (23505)`. Raises + rolls back if `matches` isn't seeded (guard: prediction count must be 72). |
| `replace_actual_advancers(round, teams[])` | `POST /api/admin/advancers` | Atomically replaces one round's `actual_advancers`. |
| `apply_master_results(results jsonb, advancers jsonb)` | `POST /api/admin/upload-results` | Updates all provided group scores **and** replaces every round's advancers in one transaction. |

Atomicity matters because Supabase-js can't wrap multiple statements in a
transaction from the client; a plpgsql function is one transaction by default.

### The `leaderboard` view (live scoring)

A single VIEW computes everything on read — **nothing is precomputed or cached**.
Columns: `entry_id, username, champion_pick, group_points, bonus_points, total,
exact_count, created_at`.

- **group_points**: over `predictions ⋈ matches` where both goals are non-null —
  `3` if exact, else `1` if `sign(pred_home-pred_away) = sign(home_goals-away_goals)`
  (so draws compare `sign(0)=sign(0)`), else `0`.
- **bonus_points**: over `advancement_predictions ⋈ actual_advancers`, sum of
  `round_weights.weight`.
- **exact_count**: count of exact group scorelines (the tiebreak metric).
- **champion_pick**: the user's `CHAMPION` advancement pick (left-joined).

> The view contains an `ORDER BY`, but PostgREST does **not** preserve a view's
> internal ordering, so `app/page.tsx` re-applies `.order("total",…)`,
> `.order("exact_count",…)`, `.order("created_at",…)`. Keep both in sync.

---

## 7. Scoring model

| Stage | Rule | Points |
|-------|------|-------:|
| Group (per match w/ result) | exact scoreline | 3 |
| Group | correct W/D/L only | 1 |
| Group | wrong | 0 |
| Knockout | reached Round of 32 | 1 / team |
| Knockout | reached Round of 16 | 2 / team |
| Knockout | reached Quarter-final | 4 / team |
| Knockout | reached Semi-final | 6 / team |
| Knockout | reached Final | 8 / team |
| Knockout | correct Champion | 12 |

**Total = group + bonus.** Tiebreak: total → `exact_count` → earliest
`created_at`.

To **change the weights**, edit the `round_weights` rows (e.g. via the Supabase
SQL editor) — that's the only place they live. To change the group 3/1/0 rule,
edit the `case` in the `leaderboard` view in `db/schema.sql` and re-run it
(`create or replace view`).

---

## 8. The Excel workbook & parser (the tricky core)

The upload is a **self-calculating bracket**, not a flat table. Parsing lives in
[`lib/parseWorkbook.ts`](../lib/parseWorkbook.ts) — pure (no DB), so it runs in
routes, the seed script, and tests.

### Two sheets matter

- **`Matches`** — canonical fixture list. Row 4+: `B` = match no. (1–104),
  `I` = team 1, `J` = team 2, `E` = kickoff (Excel date serial). Group matches
  are 1–72.
- **`World Cup`** — where users type scores and where the bracket auto-computes
  knockout teams.

### Anchor-scan algorithm

Each match has a **static integer label 1–104** somewhere in the `World Cup`
sheet (the "anchor" at `(r, c)`). Teams and scores sit at fixed offsets:

| Match no. | Round | Team 1 | Team 2 | Score (home/away) |
|-----------|-------|--------|--------|-------------------|
| 1–72 | Group | `(r+2, c+1)` | `(r+2, c+2)` | `(r+3, c+1)` / `(r+3, c+2)` |
| 73–88 | R32 | `(r+2, c+1)` | `(r+2, c+2)` | — |
| 89–96 | R16 | `(r+2, c+1)` | `(r+2, c+2)` | — |
| 97–100 | QF | `(r+2, c+1)` | `(r+2, **c+3**)` | — |
| 101–102 | SF | `(r+2, c+1)` | `(r+2, **c+3**)` | — |
| 103 | 3rd place | `(r+2, c+1)` | `(r+2, **c+3**)` | — (ignored) |
| 104 | Final | `(r+2, c+1)` | `(r+2, **c+3**)` | — |
| Champion | — | `(r+2, **c+7**)` from the match-104 anchor | | |

Note the **+1/+3** column offset for QF and deeper (one empty column between the
two teams) vs **+1/+2** for groups/R32/R16.

### Three gotchas baked into the parser

1. **Venue/score collisions.** A naive "every integer 1–104" scan hits ~273
   cells (venue numbers, score cells, group-allocation codes like `3-CDFGH`).
   Only match values **1–7 and 9** actually collide; the parser disambiguates by
   the one thing that distinguishes a real match from a venue cell: **the offset
   cells hold canonical team names.** It picks, per match number, the candidate
   whose team offsets validate.
2. **Cached formula values.** SheetJS reads the *last saved* computed values.
   Knockout team names are Excel formulas, so a file never opened/recalced in
   Excel has **blank knockout cells**. The parser detects this (knockout anchor
   present, team cells blank) and throws *"open the file in Excel and save it
   once"*. Group team cells are static, so they're always present.
3. **Team-name canonicalization.** Names must match exactly across the parse,
   the `Matches` sheet, and admin actuals (`Bosnia/Herzeg.`, `Rep. of Korea`,
   `IR Iran`, `Curaçao`, …). The parser builds a **canonical 48-team list** from
   `Matches` rows 1–72 (cols I/J) and rejects any non-canonical name rather than
   silently coercing.

### Output

```ts
parseWorkbook(buffer) → {
  groupPredictions: { matchNo, team1, team2, predHome, predAway }[],  // 72
  advancers: { R32:string[32], R16:[16], QF:[8], SF:[4], FINAL:[2], CHAMPION:string },
  canonicalTeams: string[48],
}
```

It throws `WorkbookParseError` (user-facing message) for: unreadable file,
missing sheet, blank knockout cells, non-canonical names, bad/missing group
scores, or wrong round counts.

### The validation gate

`lib/parseWorkbook.test.ts` (run `npm test`) asserts against the master
workbook: 72 group rows, advancer counts **32/16/8/4/2**, champion **=== "Spain"**,
group names equal the `Matches` pairs, and all names canonical. **Any change to
`parseWorkbook.ts` must keep this green.**

### Note on the master *results* file

The same parser is reused by the admin accelerator. In a filled **results**
workbook, the cells the parser calls "predictions" are actually the **real
scores**, and the bracket holds the **real advancers** — so
`POST /api/admin/upload-results` maps `groupPredictions → actual scores` and
`advancers → actual_advancers`.

---

## 9. Request flows

### Upload (`/upload` → `POST /api/upload`)

Client posts `multipart/form-data` (`username` + `file`). Server validates the
username (non-empty, ≤40 chars) and file (present, ≤15 MB), parses, then calls
`create_entry`. Status codes: parse/validation → **400**, duplicate username →
**409**, DB/config failure → **500** (clean JSON), success → `{ ok, entryId,
predictionsSaved, champion }`.

### Leaderboard (`/`)

Server Component, `force-dynamic`. Reads the `leaderboard` view (ordered) +
counts logged results (`matches` where both goals non-null). Renders rank,
player, **champion pick**, total, group, bonus, exact. Shows an empty state, a
"results logged X/72" line, a last-updated timestamp, and degrades to a friendly
message (not a 500) if the DB is unreachable.

### Admin auth

`POST /api/admin/login` compares the password to `ADMIN_PASSWORD` in
**constant time** and, on success, sets a signed **httpOnly** cookie
(`wc_admin`): value = `<expiry>.<HMAC-SHA256(expiry, AUTH_SECRET)>`, 7-day
expiry, `SameSite=Lax`, `Secure` in production. Every admin route calls
`isAdminAuthenticated()` (verifies the HMAC + expiry, constant-time) and returns
**401** if it fails. `/admin` itself is a Server Component that renders the login
form or the dashboard based on the same check.

### Admin writes

- `POST /api/admin/result` — `{ match_no(1–72), home_goals, away_goals }`; both
  goals together (0–99) or both null to clear.
- `POST /api/admin/advancers` — `{ round, teams[] }`; names validated against the
  canonical list, then `replace_actual_advancers`.
- `POST /api/admin/upload-results` — multipart master file → `apply_master_results`.

All three are cookie-protected and wrap DB calls to return clean JSON 500s.

---

## 10. Environment variables

| Var | Used by | Notes |
|-----|---------|-------|
| `SUPABASE_URL` | server DB client | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server DB client | **secret, server-only** |
| `ADMIN_PASSWORD` | `/api/admin/login` | the `/admin` password |
| `AUTH_SECRET` | admin cookie signing | random; `openssl rand -hex 32` |

Locally they live in `.env.local` (gitignored). `scripts/seed.ts` auto-loads
`.env.local`; Next loads it for `dev`/`build`. In Vercel, set all four in
project settings and redeploy after changes. Template: `.env.example`.

---

## 11. Local development

```bash
npm install
cp .env.example .env.local      # fill in the four vars (Supabase optional for some work)
npm run dev                     # http://localhost:3000

npm test                        # parser fixture test (no DB needed)
npm run build                   # production build + typecheck + lint
npm run seed                    # load 72 fixtures (needs SUPABASE_* )
npx tsc --noEmit                # typecheck only
```

You can do a lot **without** a live database: the parser and its test, builds,
and the no-DB route paths (validation/parse errors, auth) all run offline. The
SQL itself can be validated against a throwaway local Postgres (see the commit
history for the pattern) — but the **actual** Supabase REST round-trips require a
real project.

---

## 12. Testing & verification strategy

- **Parser** — unit-tested against the real fixture (`npm test`). This is the
  contract; keep it green.
- **SQL** — validated by running `db/schema.sql` against a temporary local
  Postgres 15 and exercising the view + functions (`create_entry` counts &
  duplicate rejection, `replace_actual_advancers`, `apply_master_results`).
- **Routes** — validation/auth paths are exercised against the dev server with
  `curl` (no DB needed). Full DB writes are confirmed in the Phase 7 live smoke
  test (see [`DEPLOY.md`](../DEPLOY.md#5-smoke-test-confirm-the-scoring-math)).

There is no live-DB integration test in CI because there's no Postgres/PostgREST
in the dev environment. If you add one, point it at a local `supabase start`
(Docker) instance.

---

## 13. Conventions & gotchas for future devs

- **Never** import a `server-only` module (`supabaseAdmin`, `adminData`,
  `adminAuth`) into a `"use client"` component. Share constants/types via a
  neutral module like `lib/rounds.ts`.
- **Round weights** live only in `round_weights`. **Scoring rules** live only in
  the `leaderboard` view. Don't duplicate either in TypeScript.
- The **canonical team list** is derived two ways that must agree: from the
  `Matches` sheet (parser/seed) and from the seeded `matches` table
  (`lib/adminData.getCanonicalTeams`). Both yield the same 48 names.
- The view's `ORDER BY` is **not** authoritative over PostgREST — always order
  in the query too.
- DB-touching routes must `export const runtime = "nodejs"`.
- `getSupabaseAdmin()` is lazy; don't "fix" it back to a top-level client or you
  reintroduce the build-time `Missing SUPABASE_URL` failure.
- Re-running `db/schema.sql` is the supported way to ship schema changes — keep
  every object `create … if not exists` / `create or replace`.

---

## 14. How to make common changes

| You want to… | Do this |
|--------------|---------|
| Re-tune knockout weights | Update rows in `round_weights` (SQL editor). No deploy needed. |
| Change the 3/1/0 group rule | Edit the `case` in the `leaderboard` view in `db/schema.sql`, re-run it. |
| Add a leaderboard column | Add it to the view's `select`, re-run; add the column to `app/page.tsx`. |
| Support a new workbook version | Re-verify the offset table in §8 against the new file; update `parseWorkbook.ts`; keep `npm test` green (you may need a new fixture). |
| Allow editing an entry | Today entries are immutable (one per username). You'd add an update path + relax the unique handling in `create_entry`/route — consider the product implications first. |
| Add real admin accounts | Replace the single-password scheme in `adminAuth.ts` with a user table + proper sessions. |

---

## 15. Known limitations / future work

- **Single admin password**, not per-user accounts.
- **No automated live-DB test** (see §12).
- **No rate limiting** on `/api/upload` or login — fine for a private pool,
  revisit for public use.
- **Kickoff times** are stored from the sheet's wall-clock components as UTC
  (informational only; never used in scoring).
- The master workbook (with the answer key) is committed — keep the repo
  **private**, or strip it from history before going public.
