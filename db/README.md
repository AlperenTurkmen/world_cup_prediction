# Database (`db/`)

This directory holds the Postgres schema for the World Cup 2026 predictions
leaderboard. It implements PLAN.md **§S4** (data model) and **§S3/§S5**
(scoring, computed live).

## Files

| File         | Purpose                                                        |
|--------------|----------------------------------------------------------------|
| `schema.sql` | Single migration: 5 core tables + `round_weights` + `team_groups` + `scoring_weights` + `leaderboard` view + `create_entry()` / admin functions. |

> Re-running `schema.sql` after a change is safe and is how you pick up new
> objects (e.g. the `create_entry()` function added in Phase 3).

## How to run it

The app talks to Supabase only from the server (service-role key), so there is
no client setup to do here — just create the objects once:

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of [`schema.sql`](schema.sql) and click **Run**.
3. It should complete with no errors. The file is re-runnable (`if not exists` /
   `create or replace`), so running it again is harmless.

## How the scoring works (quick reference)

The full model, rationale, and worked examples live in
[`../docs/SCORING_DESIGN.md`](../docs/SCORING_DESIGN.md). Four dimensions, all
computed live by the `leaderboard` view:

**A · Group match** — only for the 72 group matches with a logged result (both
goals non-null). The axes **stack** (a prediction earns credit for every axis it
got right, not "best of"):

| Axis | Weight key | Default |
|------|-----------|:-------:|
| Correct W/D/L outcome | `W_OUTCOME` | 2 |
| Correct goal difference | `W_GOALDIFF` | 1 |
| Each team's exact goal count (×0–2) | `W_TEAMGOALS` | 1 |
| Exact scoreline bonus | `W_EXACT` | 3 |

Max per match = **8** (e.g. 2–1 predicted, 2–1 actual).

**B · Group ranking** — only once all 6 of a group's matches are logged. Each
team's predicted final position is **derived in SQL** from the entry's own
scorelines, the actual position from the logged scores, both using the same
standings tie-break (points → goal difference → goals for → team name):

| Match | Weight key | Default |
|-------|-----------|:-------:|
| Team finishes in its exact group position | `W_RANK_EXACT` | 3 |
| Team finishes one position off | `W_RANK_ADJACENT` | 1 |

**C/D · Knockout + Champion** — advancement only, never by knockout scoreline.
For each round, award `round_weights.weight` per team correctly predicted to
reach it (intersection of `advancement_predictions` and `actual_advancers`):

| Round | R32 | R16 | QF | SF | FINAL | CHAMPION |
|-------|:---:|:---:|:--:|:--:|:-----:|:--------:|
| Weight | 1 | 2 | 4 | 6 | 8 | 12 |

Progression is cumulative: a team predicted to reach the Semi-final earns R32 +
R16 + QF + SF as it actually clears each stage, with no clawback if it exits
early.

All A/B weights live in the `scoring_weights` table; all C/D weights in
`round_weights`. Change them there and the leaderboard reflects it on the next
read (the view is computed live; nothing is precomputed or cached).

**Fairness gating** (unchanged): a group match scores only if the prediction was
eligible at upload (`predictions.is_score_eligible`) and the entry predates the
result being logged; a group's ranking scores only if all six of its predictions
were eligible; an advancer scores only if it was logged after the entry was
submitted.

**Total** = group + ranking + knockout (knockout includes the champion's 12).
**Ordering**: `total desc, exact_count desc, champion_correct desc, created_at
asc` (tiebreak: total → exact group scorelines → champion correct → earliest
submission).

## Verifying a clean install (before any data exists)

Run this in the SQL editor right after the migration:

```sql
select * from leaderboard;
```

It must return **zero rows cleanly** (no error). Every per-dimension CTE is
derived from `entries`, so with an empty `entries` table there is nothing to
aggregate and you get an empty result set — not a crash and not a single
all-zero row.

Optional sanity check that the objects exist:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
-- expect: actual_advancers, advancement_predictions, entries, matches,
--         predictions, round_weights, scoring_weights, team_groups
--         (+ the leaderboard view)

select * from round_weights order by weight;     -- 6 knockout weights
select * from scoring_weights order by key;      -- 6 group/ranking weights
select count(*) from team_groups;                -- 48 after seeding
```

### Scoring sanity (after seeding + a little data)

A quick way to confirm the group-match math: a prediction equal to the actual
result must score the per-match maximum (`W_OUTCOME + W_GOALDIFF +
2·W_TEAMGOALS + W_EXACT` = 8 with the defaults). Feeding an entry whose 72
scorelines exactly equal 72 logged results yields `group_points = 72 × 8 = 576`
and `exact_count = 72`. Validated locally against the
`WCup_2026_4.2.7_en.xlsx` group results (group A standings reproduce the
workbook's `CalcA` order: Mexico, Rep. of Korea, Czech Rep., South Africa).

## `create_entry()` — atomic uploads

`POST /api/upload` calls the `create_entry(p_username, p_predictions, p_advancers)`
function so that an entry, its 72 predictions, and all advancement picks insert
in **one transaction** — there is never a half-written entry. A duplicate
username raises a `unique_violation` (SQLSTATE `23505`) which the route turns
into a friendly "already submitted" message. If the `matches` table is not yet
seeded, the function raises and rolls back rather than saving a partial entry.

## What's next

The 72 `matches` rows are **not** seeded by this migration — they are loaded by
`scripts/seed.ts` from the master workbook (Phase 2).
