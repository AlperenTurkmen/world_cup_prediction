# AGENTS.md

Guidance for AI coding agents working in this repository. (Claude Code reads
[`CLAUDE.md`](CLAUDE.md), which carries the same rules in more detail; keep the
two in sync.)

## Current state

This is a **working Next.js application**, not a greenfield repo. Stack:
**Next.js 16 (App Router) + TypeScript + Tailwind**, Supabase (Postgres) for
data, SheetJS (`xlsx`) for parsing, deployed on Vercel. What's built:
Excel-upload predictions, manual game-by-game entry, Google login with an
optional password fallback, player profiles + follows, private/public leagues,
an admin console for logging results, auto-sync of real results from
football-data.org, and a live multi-dimensional leaderboard.

Read the relevant reference before non-trivial work:

- [`WORLD_CUP_2026_PLAN.md`](WORLD_CUP_2026_PLAN.md) — the original build spec
  (PLAN.md). Historical, but still the source of the parser cell-offset details.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the running app fits
  together.
- [`docs/SCORING_DESIGN.md`](docs/SCORING_DESIGN.md) — **authoritative** scoring
  model (supersedes PLAN §S3).
- [`docs/RESULTS_SYNC.md`](docs/RESULTS_SYNC.md) — the football-data.org
  auto-sync (`POST /api/sync`).
- `WCup_2026_4.2.7_en.xlsx` — the master Hermann Baum workbook; doubles as the
  test fixture (champion "Spain"), the seed source for the 72 group fixtures +
  team→group map, and the source for the generated knockout-bracket data. It is
  a third-party file — see [`NOTICE.md`](NOTICE.md).

### Commands

- `npm run dev` — local dev server.
- `npm run build` — production build (best full typecheck; `npx tsc --noEmit`
  for a fast check).
- `npm test` — runs `tsx --test lib/*.test.ts` (node:test). All logic with a
  `*.test.ts` is gated here.
- `npm run seed` — seed `matches` + `team_groups` from the workbook (needs
  Supabase env vars / `.env.local`).
- `npx tsx scripts/extractBracket.ts` — regenerate `lib/bracketData.ts` from the
  workbook (only if the workbook changes).

## Critical architectural constraints

### Supabase is server-only
The service-role key talks to Postgres **only from server code**
(`lib/supabaseAdmin.ts`, route handlers, scripts). The browser never touches
Supabase directly — there is no RLS. **Never import the service-role client into
a Client Component.** This is the single rule to restate every session.

### Two ways to enter predictions, one storage shape
Both paths produce the **same immutable entry** via the `create_entry` Postgres
function (72 group predictions + `advancement_predictions` for R32→CHAMPION).
One entry per username (case-insensitive), immutable once submitted.

1. **Excel upload** (`lib/parseWorkbook.ts`): anchor-scan the `World Cup` sheet —
   find each cell holding an integer 1–104 (a match anchor), then read
   teams/scores at fixed offsets. Column offset changes by round
   (groups/R32/R16 at `c+1`/`c+2`; QF and deeper at `c+1`/`c+3`; champion at
   `c+7` from the match-104 anchor). SheetJS reads cached formula values, so a
   workbook never recalced in Excel has blank knockout cells → reject with an
   "open and save first" message.
2. **Manual entry** (`lib/deriveBracket.ts` + `lib/manualEntry.ts`): a stepper
   that derives the 32 R32 teams from predicted group standings, then takes the
   user's picked knockout winners through to the champion. Progress autosaves to
   `entry_drafts`.

### Team-name canonicalization
The canonical 48-team list is the unique teams across group matches 1–72 in the
`Matches` sheet (columns I/J). Every parsed name, admin-entered actual, and
advancer must validate against it exactly — mismatches are rejected, never
silently coerced.

### Scoring lives in SQL, computed live
The `leaderboard` VIEW computes everything on read — no precomputed scores.
Weights are tunable only in `scoring_weights` (A/B) and `round_weights` (C/D).
Preserve the **fairness gating**: a result scores a prediction only if the entry
predates `result_logged_at`. Full model in
[`docs/SCORING_DESIGN.md`](docs/SCORING_DESIGN.md).

### Database changes
`db/schema.sql` is the full re-runnable schema; `db/migration.sql` holds
incremental migrations to paste into the Supabase SQL editor. **DDL cannot be
applied from app code** — when you add a table/function, update both files and
tell the user to run the migration.

## Validation gates

Run `npm test` after any change to parsing, scoring derivation, or bracket
logic. Against `WCup_2026_4.2.7_en.xlsx` the parser must produce 72 group rows,
advancer counts R32=32/R16=16/QF=8/SF=4/FINAL=2/CHAMPION=1, and champion ===
"Spain"; `deriveBracket` must reproduce the workbook's exact R32 field.
