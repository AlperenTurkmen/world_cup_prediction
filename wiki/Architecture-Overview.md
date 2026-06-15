# Architecture Overview

A high-level tour of how the app fits together. For the exhaustive version —
every API route, the full data model, conventions — read
[`docs/ARCHITECTURE.md`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/docs/ARCHITECTURE.md)
in the repo.

## The big picture

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

Next.js (App Router) serves both the UI and the API routes. All database access
happens **server-side** through a service-role Supabase client. The browser
never talks to Supabase directly.

## The one rule: Supabase is server-only

The service-role key bypasses Row-Level Security, so it must never reach the
browser. It is used only from server code — `lib/supabaseAdmin.ts`, route
handlers under `app/api/**`, and CLI scripts. **The service-role client is never
imported into a Client Component.** This is the single most important constraint
in the codebase.

## Two prediction paths, one storage shape

Whether a user uploads an Excel file or taps through the in-app stepper, the
result is the **same immutable entry**:

- **72 group predictions** (a scoreline for each group-stage match), and
- **advancement predictions** — which teams reach R32, R16, QF, SF, the final,
  and become champion.

One entry per username (case-insensitive), immutable once submitted. Both paths
go through the same `create_entry` Postgres function, so an entry is always
written atomically — never half-saved.

| Path | Module | How it works |
|------|--------|--------------|
| Excel upload | `lib/parseWorkbook.ts` | Anchor-scans the workbook's `World Cup` sheet for match labels 1–104 and reads teams/scores at fixed offsets. |
| Manual entry | `lib/deriveBracket.ts` + `lib/manualEntry.ts` | Derives the 32 R32 teams from the user's predicted group standings, then walks them through knockout winners to a champion. |

## Scoring is computed live in SQL

There are **no precomputed scores**. The `leaderboard` Postgres view (and its
league-scoped sibling) re-derives every dimension on each read, so the standings
reflect newly logged results on the next page load — no recompute job. See
[Scoring System](Scoring-System) for the model.

## Where things live

```
app/        Pages, layouts, and API route handlers (App Router)
  api/      Server endpoints: upload, admin, auth, leagues, sync, user…
  admin/    The results console (password-gated)
lib/        Core logic + unit tests (*.test.ts)
  parseWorkbook.ts   Excel → predictions
  deriveBracket.ts   group standings + picks → bracket advancers
  syncResults.ts     football-data.org → logged results
  supabaseAdmin.ts   the server-only DB client
db/         Re-runnable schema, migrations, the scoring view
scripts/    seed, bracket extraction, backups, checks
docs/       Architecture, scoring design, results-sync references
```

## Data flow at a glance

1. **Seed** — `scripts/seed.ts` loads the 72 fixtures + team→group map from the
   workbook into Postgres.
2. **Predict** — users submit entries via `/upload` or `/upload/manual`.
3. **Log results** — an admin enters scores/advancers at `/admin`, or the
   football-data.org sync writes them automatically.
4. **Score** — the `leaderboard` view computes standings on read, applying
   fairness gating so entries only score results logged after they were
   submitted.
