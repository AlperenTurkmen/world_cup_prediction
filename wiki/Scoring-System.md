# Scoring System

The leaderboard scores four independent dimensions and adds them up. Everything
is **computed live in SQL** on each read — nothing is pre-scored. This page is
the friendly summary; the authoritative model with rationale and worked examples
is in
[`docs/SCORING_DESIGN.md`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/docs/SCORING_DESIGN.md).

## A · Group match (matches 1–72)

Scored once both goals of a group game are logged. The axes **stack** — a
prediction earns credit for every axis it got right, not "best of":

| Axis | Weight key | Default |
|------|-----------|:-------:|
| Correct W/D/L outcome | `W_OUTCOME` | 2 |
| Correct goal difference | `W_GOALDIFF` | 1 |
| Each team's exact goal count (×0–2) | `W_TEAMGOALS` | 1 |
| Exact scoreline bonus | `W_EXACT` | 3 |

**Maximum per match = 8** (predicting 2–1 when the result is 2–1 hits all axes).

## B · Group ranking

Scored only once **all six** of a group's matches are logged. Each team's
predicted final position is derived in SQL from the entry's own scorelines; the
actual position from the logged scores. Both use the same standings tie-break
(**points → goal difference → goals for → team name**).

| Outcome | Weight key | Default |
|---------|-----------|:-------:|
| Team finishes in its exact group position | `W_RANK_EXACT` | 3 |
| Team finishes one position off | `W_RANK_ADJACENT` | 1 |

## C / D · Knockout & Champion (advancement only)

Knockouts are scored by **who advances**, never by the knockout scoreline. For
each round you earn the round's weight per team you correctly predicted to reach
it (the intersection of your advancement picks and the actual advancers):

| Round | R32 | R16 | QF | SF | FINAL | CHAMPION |
|-------|:---:|:---:|:--:|:--:|:-----:|:--------:|
| Weight | 1 | 2 | 4 | 6 | 8 | 12 |

Progression is **cumulative and forgiving**: a team you predicted to reach the
semi-final earns R32 + R16 + QF + SF as it actually clears each stage, with no
clawback if it then exits.

## Total & ordering

**Total = group + ranking + knockout** (knockout includes the champion's 12).

Players are ordered by:

```
total desc → exact_count desc → champion_correct desc → created_at asc
```

i.e. total points, then exact group scorelines, then whether the champion pick
was right, then earliest submission.

## Fairness gating (anti-cheat)

So a late entry can't score off already-known results:

- A **group match** scores a prediction only if the prediction was eligible at
  upload **and** the entry was submitted *before* the result was logged.
- A **group's ranking** scores only if all six of its predictions were eligible.
- An **advancer** scores only if it was logged *after* the entry was submitted.

## Tuning the weights

All weights live in two tables and take effect on the next read (no recompute):

- **A/B axes** → `scoring_weights`
- **C/D round weights** → `round_weights`

Change a value there and the leaderboard reflects it immediately. Leagues reuse
the same global weights, with an optional per-league "ignore games before X"
start cutoff.
