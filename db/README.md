# Database (`db/`)

This directory holds the Postgres schema for the World Cup 2026 predictions
leaderboard. It implements PLAN.md **§S4** (data model) and **§S3/§S5**
(scoring, computed live).

## Files

| File         | Purpose                                                        |
|--------------|----------------------------------------------------------------|
| `schema.sql` | Single migration: 5 core tables + `round_weights` + `leaderboard` view. |

## How to run it

The app talks to Supabase only from the server (service-role key), so there is
no client setup to do here — just create the objects once:

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of [`schema.sql`](schema.sql) and click **Run**.
3. It should complete with no errors. The file is re-runnable (`if not exists` /
   `create or replace`), so running it again is harmless.

## How the scoring works (quick reference)

**Group stage** — only for the 72 group matches that have a logged result
(both `home_goals` and `away_goals` non-null):

- exact scoreline → **3**
- correct W/D/L result but not exact → **1** (compares `sign(goal diff)`)
- otherwise → **0**

**Knockout** — advancement only, never by knockout scoreline. For each round,
award `round_weights.weight` per team correctly predicted to reach that round
(the intersection of `advancement_predictions` and `actual_advancers`):

| Round    | Weight |
|----------|:------:|
| R32      | 1      |
| R16      | 2      |
| QF       | 4      |
| SF       | 6      |
| FINAL    | 8      |
| CHAMPION | 12     |

Weights live in exactly one place — the `round_weights` table. Change them
there and the leaderboard reflects it on the next read (the view is computed
live; nothing is precomputed or cached).

**Total** = group points + bonus. **Ordering**: `total desc, exact_count desc,
created_at asc` (tiebreak: total → exact group scorelines → earliest submission).

## Verifying a clean install (before any data exists)

Run this in the SQL editor right after the migration:

```sql
select * from leaderboard;
```

It must return **zero rows cleanly** (no error). The view's `group_scores` /
`bonus_scores` CTEs are derived from `entries`, so with an empty `entries`
table there is nothing to aggregate and you get an empty result set — not a
crash and not a single all-zero row.

Optional sanity check that the objects exist:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
-- expect: actual_advancers, advancement_predictions, entries,
--         matches, predictions, round_weights  (+ the leaderboard view)

select * from round_weights order by weight;
-- expect the 6 rows above
```

## What's next

The 72 `matches` rows are **not** seeded by this migration — they are loaded by
`scripts/seed.ts` from the master workbook in Phase 2 (parser + seed).
