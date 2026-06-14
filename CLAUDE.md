# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This is a **greenfield project — no application code exists yet.** The repo contains only:
- `WORLD_CUP_2026_PLAN.md` — the authoritative build spec and phased prompts. **Read it before doing anything.** It defines the stack, data model, scoring rules, parser algorithm, and a 7-phase build order (Phase 0 scaffold → Phase 7 deploy). When the user references "PLAN.md", this is the file.
- `WCup_2026_4.2.7_en.xlsx` — the master Hermann Baum workbook (v4.2.7). Doubles as the parser test fixture (its champion is "Spain", a fully-simulated example) and the source for seeding the 72 group fixtures.

There is no `package.json`, no commits, and no build/test commands yet — they arrive in Phase 0. Once scaffolded, the stack is **Next.js (App Router) + TypeScript + Tailwind**, Supabase (Postgres), SheetJS (`xlsx`) for parsing, deployed on Vercel.

## Critical architectural constraints

These are easy to get wrong and span multiple spec sections, so they are summarized here. The spec remains canonical.

### Supabase is server-only
The service-role key talks to Postgres **only from server code** (`lib/supabaseAdmin.ts`, route handlers, scripts). The browser never touches Supabase directly — so there is no RLS. **Never import the service-role client into a Client Component.** This is the single rule to restate at the start of every session.

### The upload is a self-calculating Excel bracket, not a flat table
Users upload a *filled* copy of the master workbook. Predictions are extracted by an **anchor-scan** of the `World Cup` sheet (see PLAN §S2 for the exact cell-offset table): find each cell holding an integer 1–104 (a match anchor), then read teams/scores at fixed offsets from it. Two gotchas baked into the parser:
- **Column offset changes by round:** groups/R32/R16 use team cells at `c+1`/`c+2`; QF and deeper (matches 97–104) use `c+1`/`c+3` (one empty column between teams). Champion is at `c+7` from the match-104 anchor.
- **Cached formula values:** SheetJS reads last-saved computed values. Knockout team names are formulas, so a file never opened/recalced in Excel has blank knockout cells → reject with a message telling the user to open and save the file first.

### Team-name canonicalization
Build the canonical 48-team list from the `Matches` sheet (unique teams across matches 1–72, columns I/J). Every parsed prediction name, every admin-entered actual, and every advancer must validate against this list exactly (names like `Bosnia/Herzeg.`, `Rep. of Korea`, `IR Iran`, `Curaçao`). Mismatches must be rejected, not silently coerced.

### Scoring lives in SQL, computed live
The `leaderboard` Postgres VIEW computes everything on read — no precomputed scores. The full model is **`docs/SCORING_DESIGN.md`** (authoritative; supersedes PLAN §S3). Four dimensions, weights tunable in two tables only (`scoring_weights` for A/B, `round_weights` for C/D):
- **A — Group match** (matches 1–72, both goals non-null): axes *stack*, not "best of" — `W_OUTCOME`(2) for correct W/D/L + `W_GOALDIFF`(1) for correct margin + `W_TEAMGOALS`(1) per team's exact goals (×0–2) + `W_EXACT`(3) for an exact scoreline. Max 8/match.
- **B — Group ranking** (only once a group's 6 matches are all logged): each team's predicted vs actual final position, both *derived in SQL* from scorelines (pts → GD → GF → name); `W_RANK_EXACT`(3) exact, `W_RANK_ADJACENT`(1) off-by-one. No new prediction input — predicted standings = what the workbook's `CalcA`–`CalcL` show.
- **C/D — Knockout + Champion**: **advancement only**, progressive. Per-round weights R32=1, R16=2, QF=4, SF=6, FINAL=8, CHAMPION=12 over the intersection of `advancement_predictions` and `actual_advancers`.
- **Fairness gating** (must preserve): group match scores only if `is_score_eligible` and entry predates `result_logged_at`; a group's ranking scores only if all 6 of its predictions were eligible; an advancer scores only if logged after the entry (`created_at < logged_at`).
- Order: `total desc, exact_count desc, champion_correct desc, created_at asc`.
- Group ranking needs the `team_groups` table (team→A..L), seeded by `scripts/seed.ts` from the workbook's `Groups` sheet.

### Fixed product decisions (don't re-ask)
One upload per username, immutable; usernames unique case-insensitive. Admin enters group scores + advancers via form, with an optional "upload master results workbook" shortcut that runs the *same* `parseWorkbook` to auto-populate both group actuals and advancers.

## Parser validation gate

Any change to `lib/parseWorkbook.ts` must keep the fixture test green: against `WCup_2026_4.2.7_en.xlsx` it must parse 72 group rows, advancer counts R32=32/R16=16/QF=8/SF=4/FINAL=2/CHAMPION=1, champion === "Spain", and group team names equal to the `Matches` sheet pairs.
