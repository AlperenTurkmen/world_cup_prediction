# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This is a **working Next.js application**, not a greenfield repo. The stack is **Next.js 16 (App Router) + TypeScript + Tailwind**, Supabase (Postgres) for data, SheetJS (`xlsx`) for parsing, deployed on Vercel. What's built: Excel-upload predictions, **manual game-by-game prediction entry**, Google login + optional password fallback, player profiles + follows, private/public leagues with their own boards, an admin console for logging results, and a live multi-dimensional leaderboard.

Reference docs (read the relevant one before non-trivial work):
- `WORLD_CUP_2026_PLAN.md` — the original build spec (PLAN.md). Historical but still the source of the parser/cell-offset details and product decisions.
- `docs/ARCHITECTURE.md` — how the running app fits together.
- `docs/SCORING_DESIGN.md` — **authoritative** scoring model (supersedes PLAN §S3).
- `WCup_2026_4.2.7_en.xlsx` — the master Hermann Baum workbook (v4.2.7). Doubles as the test fixture (champion "Spain", fully simulated), the seed source for the 72 group fixtures + team→group map, and the source for the generated knockout-bracket data.

### Commands
- `npm run dev` — local dev server.
- `npm run build` — production build (also the best full typecheck of routes/RSC; `npx tsc --noEmit` for a fast check).
- `npm test` — runs `tsx --test lib/*.test.ts` (node:test). All logic with a `*.test.ts` is gated here.
- `npm run seed` — seed `matches` + `team_groups` from the workbook (needs Supabase env vars / `.env.local`).
- `npx tsx scripts/extractBracket.ts` — regenerate `lib/bracketData.ts` from the workbook (only if the workbook changes).
- `next lint` is currently broken under Next 16 (passes `lint` as a bad path arg); rely on `tsc` + `build`.

## Critical architectural constraints

These are easy to get wrong and span multiple areas, so they're summarized here.

### Supabase is server-only
The service-role key talks to Postgres **only from server code** (`lib/supabaseAdmin.ts`, route handlers, scripts). The browser never touches Supabase directly — so there is no RLS. **Never import the service-role client into a Client Component.** This is the single rule to restate at the start of every session.

### Two ways to enter predictions, one storage shape
Both paths produce the **same immutable entry** via the `create_entry` Postgres function (72 group predictions + `advancement_predictions` for R32→CHAMPION). One entry per username (case-insensitive), immutable once submitted.
1. **Excel upload** (`/upload`, `app/api/upload`): users upload a *filled* copy of the master workbook; `lib/parseWorkbook.ts` extracts predictions by an **anchor-scan** of the `World Cup` sheet (PLAN §S2): find each cell holding an integer 1–104 (a match anchor), then read teams/scores at fixed offsets. Two gotchas:
   - **Column offset changes by round:** groups/R32/R16 read team cells at `c+1`/`c+2`; QF and deeper (97–104) at `c+1`/`c+3` (one empty column between teams); champion at `c+7` from the match-104 anchor.
   - **Cached formula values:** SheetJS reads last-saved computed values. Knockout team names are formulas, so a file never opened/recalced in Excel has blank knockout cells → reject with a "open and save first" message.
2. **Manual entry** (`/upload/manual`, `app/api/upload/manual`): a stepper that starts at the next game that hasn't kicked off (past games are hidden and auto-filled 0–0), with 0–4 tap rails + keyboard. The 32 R32 teams are **auto-derived from predicted group standings**; the user then taps knockout winners through to the champion. Progress autosaves to the `entry_drafts` table keyed by Google account (resumable cross-device); the draft is deleted on finalize.

### Bracket derivation (`lib/deriveBracket.ts`)
Pure module (no `server-only`) shared by the manual-entry UI, the manual submit route, and tests. Turns predicted group scorelines + picked knockout winners into the same advancer shape `parseWorkbook` produces. `lib/bracketData.ts` is **generated** by `scripts/extractBracket.ts` and holds the knockout slot defs (matches 73–104) and FIFA's 495-row third-placed assignment table. **Standings tie-break is `points → goal difference → goals for → team name` — identical to the leaderboard SQL, and intentionally NOT FIFA's head-to-head/fair-play.** In groups with exact ties this can differ from the workbook's cached bracket (groups D, H = fair-play; F = head-to-head in the fixture), but the R32 *set* is unchanged and the result stays self-consistent with dimension-B scoring. Keep deriveBracket and the SQL standings in lockstep.

### Team-name canonicalization
The canonical 48-team list is the unique teams across group matches 1–72 in the `Matches` sheet (columns I/J). Every parsed prediction name, admin-entered actual, and advancer must validate against this list exactly (`Bosnia/Herzeg.`, `Rep. of Korea`, `IR Iran`, `Curaçao`, …). Mismatches are rejected, never silently coerced. Manual-entry advancers are inherently canonical (derived from seeded fixture teams).

### Scoring lives in SQL, computed live
The `leaderboard` VIEW (and `compute_leaderboard()` / `league_leaderboard()`) compute everything on read — no precomputed scores. Full model in `docs/SCORING_DESIGN.md`. Weights are tunable in two tables only (`scoring_weights` for A/B, `round_weights` for C/D):
- **A — Group match** (matches 1–72, both goals non-null): axes *stack* — `W_OUTCOME`(2) correct W/D/L + `W_GOALDIFF`(1) correct margin + `W_TEAMGOALS`(1) per team's exact goals (×0–2) + `W_EXACT`(3) exact scoreline. Max 8/match.
- **B — Group ranking** (only once a group's 6 matches are all logged): predicted vs actual final position, both *derived in SQL* from scorelines (pts → GD → GF → name); `W_RANK_EXACT`(3) exact, `W_RANK_ADJACENT`(1) off-by-one. Needs `team_groups` (team→A..L), seeded by `scripts/seed.ts`.
- **C/D — Knockout + Champion**: **advancement only**, progressive. Per-round weights R32=1, R16=2, QF=4, SF=6, FINAL=8, CHAMPION=12 over the intersection of `advancement_predictions` and `actual_advancers`.
- **Fairness gating** (must preserve): group match scores only if `is_score_eligible` and entry predates `result_logged_at`; a group's ranking scores only if all 6 of its predictions were eligible; an advancer scores only if logged after the entry (`created_at < logged_at`).
- Order: `total desc, exact_count desc, champion_correct desc, created_at asc`.
- Leagues reuse `compute_leaderboard()` with an optional start-game cutoff; weights stay global.

### Database changes
`db/schema.sql` is the full re-runnable schema; `db/migration.sql` holds incremental migrations to paste into the Supabase SQL editor. **DDL cannot be applied from app code** — when you add a table/function, update both files and tell the user to run the migration. Supabase env vars are only needed at request time (the admin client is created lazily).

### Fixed product decisions (don't re-ask)
One entry per username, immutable; usernames unique case-insensitive. Admin enters group scores + advancers via form, with an optional "upload master results workbook" shortcut that runs the *same* `parseWorkbook` to auto-populate both group actuals and advancers.

## Validation gates

- **Parser** (`lib/parseWorkbook.ts`): against `WCup_2026_4.2.7_en.xlsx` must parse 72 group rows, advancer counts R32=32/R16=16/QF=8/SF=4/FINAL=2/CHAMPION=1, champion === "Spain", and group team names equal to the `Matches` sheet pairs.
- **Bracket** (`lib/deriveBracket.ts`): against the same fixture must derive the workbook's exact R32 field, assign third-placed teams to the correct slots via the FIFA table, and produce a complete, well-nested bracket from a full set of picked winners.
- Run `npm test` after any change to parsing, scoring derivation, or bracket logic.
