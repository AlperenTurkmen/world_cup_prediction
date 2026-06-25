# Scoring System v2 — Design Specification

**Status:** Implemented. Live in `db/schema.sql` (the `leaderboard` view + `team_groups` / `scoring_weights` tables), `scripts/seed.ts` (seeds `team_groups`), and `app/page.tsx` (Group / Ranking / Knockout columns). Validated against a local Postgres 15 instance with a hand-computed scenario and the workbook's group-A results.
**Supersedes:** `PLAN.md` §S3 (the original 3/1/0 + advancement model).
**Scope decisions (locked with the project owner):**
1. Deliverable: this document first, for review, before any code is touched.
2. Actual group standings are **computed in SQL from logged scores** (robust to manual entry *and* the master-file upload).
3. Point scale is **balanced** — no single dimension should dominate the table.

---

## 1. Goals of the redesign

The current system scores only two things:

- **Group matches:** mutually-exclusive 3 (exact) / 1 (result) / 0.
- **Knockouts:** advancement bonus per round.

The owner asked for a system that **rewards every dimension of a prediction simultaneously**, specifically:

| # | Dimension | What it rewards | Current system |
|---|-----------|-----------------|----------------|
| A | **Group match result** | Exact score, goals scored, *and* winning team — all at once, not "best of" | Partly (3/1/0, mutually exclusive) |
| B | **Group ranking** | Predicting a team's final position 1–4 in its group (e.g. "Germany finishes 3rd") | **Missing entirely** |
| C | **Knockout progression** | A team predicted to go deep earns points at *each* round it actually clears | Yes (kept, lightly rebalanced) |
| D | **Champion** | Correctly naming the tournament winner | Yes (kept) |

The guiding principle: **partial knowledge always earns partial credit, and deeper/rarer correctness earns strictly more.** A prediction never "wastes" a correct insight.

---

## 2. Notation

For a single group match, let the **prediction** be `(ph, pa)` (home/away goals the user typed) and the **actual** result be `(ah, aa)`. Define indicator variables (each is 1 if true, else 0):

| Symbol | Meaning | Definition |
|--------|---------|------------|
| `T` | **Tendency** — correct outcome (W/D/L), i.e. the "winning team" | `sign(ph − pa) = sign(ah − aa)` |
| `D` | **Goal difference** — correct margin | `(ph − pa) = (ah − aa)` |
| `Hh` | Home team's goals exactly right | `ph = ah` |
| `Aa` | Away team's goals exactly right | `pa = aa` |
| `E` | **Exact** scoreline | `Hh = 1 ∧ Aa = 1` |

These nest strictly: `E ⟹ D ⟹ T`. (An exact score has the right margin, which has the right outcome.) `Hh + Aa` is the count of teams whose goal tally you nailed (0, 1, or 2); `Hh + Aa = 2 ⟺ E`.

This is the mathematical core: instead of *choosing* one of 3/1/0, we **sum the credit for every level the prediction achieved.**

---

## 3. Dimension A — Group match scoring (per match)

Scored only for matches where **both** actual goals are logged (`ah` and `aa` non-null); unplayed matches contribute 0.

```
match_points =  W_OUTCOME · T            (correct winner / draw)
              + W_GOALDIFF · D            (correct margin, on top of outcome)
              + W_TEAMGOALS · (Hh + Aa)   (each team's exact goals, the "goals scored" axis)
              + W_EXACT · E               (perfectionist bonus for nailing both)
```

### Default weights (balanced)

| Constant | Value | Rewards |
|----------|------:|---------|
| `W_OUTCOME` | **2** | Getting the result direction right — the single most important call |
| `W_GOALDIFF` | **1** | Reading the margin (e.g. "narrow win" vs "blowout") |
| `W_TEAMGOALS` | **1** (×each team) | Each team's exact goal count — the explicit "goals scored" dimension |
| `W_EXACT` | **3** | The perfection bonus — nailing the precise scoreline |

**Maximum per match = 2 + 1 + 2 + 3 = 8.**

> **Why exact pays so much more.** A correct *outcome* (W/D/L) is roughly a coin-flip-plus — a knowledgeable player lands ~50%. A perfectly *exact* scoreline is several times rarer (~10–15% even for sharp predictors). The weights deliberately make the curve **convex**: the jump from "good guess" (right winner + margin = 3) to "called it exactly" (8) is larger than the jump from "nothing" (0) to "right winner" (2). Rare, hard correctness earns disproportionately more — which is the whole point of rewarding precision.

### Worked examples

| Prediction | Actual | T | D | Hh | Aa | E | Points | Reading |
|-----------|--------|---|---|----|----|---|-------:|---------|
| 2–1 | 2–1 | 1 | 1 | 1 | 1 | 1 | **8** | Perfect |
| 2–1 | 3–2 | 1 | 1 | 0 | 0 | 0 | **3** | Right winner *and* margin, wrong goals |
| 2–0 | 1–0 | 1 | 0 | 0 | 1 | 0 | **3** | Right winner, nailed the away clean sheet |
| 1–0 | 3–1 | 1 | 0 | 0 | 0 | 0 | **2** | Right winner only (margin differs) |
| 1–1 | 2–2 | 1 | 1 | 0 | 0 | 0 | **3** | Called the draw and the (zero) margin |
| 1–1 | 1–1 | 1 | 1 | 1 | 1 | 1 | **8** | Perfect draw |
| 0–2 | 0–1 | 1 | 0 | 1 | 0 | 0 | **3** | Right away win, nailed home blank |
| 2–1 | 0–2 | 0 | 0 | 0 | 0 | 0 | **0** | Wrong on every axis |
| 2–1 | 1–2 | 0 | 0 | 0 | 0 | 0 | **0** | Right *teams* scoring, wrong winner — still 0 (no axis matched the actual) |

> **Note on the "free" coincidence:** predicting `2–0` when the actual is `1–0` scores `W_TEAMGOALS` for the away `0 = 0`. This is intentional and consistent — you *did* correctly predict that team would be kept scoreless. It is small (1 pt) by design.

### Comparison to the old model

| Case | Old | New |
|------|----:|----:|
| Exact score | 3 | 8 |
| Correct result, wrong score | 1 | 2–3 (now distinguishes margin & goals) |
| Wrong result | 0 | 0 |

The exact-to-result ratio widens from 3:1 to roughly 8:2.5 — precision is now worth markedly more than a lucky direction.

The new model is a strict refinement: it never *removes* credit, and it separates "good guess" from "lucky direction."

---

## 4. Dimension B — Group ranking (per team)

**The missing dimension.** Each team finishes its group in position 1, 2, 3, or 4. We score how well the user predicted that final ordering.

### Where the ranks come from (symmetry is the key idea)

Neither side picks ranks explicitly. Both are **derived in SQL from scorelines**, using identical logic:

- **Actual rank** of a team = its position in its group's table, computed from the **admin-logged** results.
- **Predicted rank** of a team = its position in its group's table, computed from **that user's 72 predicted** results.

This is exactly what the Hermann Baum workbook does internally (the `CalcA`–`CalcL` sheets) — so the predicted rank we compute **equals what the user saw in their own bracket.** No new prediction input, no parser change.

### Standings tie-break (deterministic)

Within each group, order teams by:

```
1. Points        (W=3, D=1, L=0)          desc
2. Goal difference (GF − GA)              desc
3. Goals for                              desc
4. Team name                              asc   (final deterministic fallback)
```

> **Known simplification:** real FIFA tie-breaks insert *head-to-head* and *fair-play* before "drawing of lots." We deliberately use the simpler points → GD → GF → name chain so the standing is **deterministic and identical for predictions and actuals**, and works even when the admin types scores manually. For a friends' pool the difference only ever matters in exact-tie edge cases; documented as accepted.

### Gating

A group's ranking is scored **only once all 6 of its matches are logged** (the table isn't final until then). Predicted tables are always "complete" (the user fills all 72). So Dimension B for a group switches on the moment its 6th result is entered.

### Scoring

```
rank_points(team) =  W_RANK_EXACT     if predicted_rank = actual_rank
                   + W_RANK_ADJACENT   if |predicted_rank − actual_rank| = 1
                   + 0                 otherwise
```

(The two are exclusive — exact pays `W_RANK_EXACT` only, not both.)

### Default weights (balanced)

| Constant | Value | Rewards |
|----------|------:|---------|
| `W_RANK_EXACT` | **3** | "Germany finishes exactly 3rd" ✅ — the precise call |
| `W_RANK_ADJACENT` | **1** | "Germany 2nd, actually 3rd" — close reading of the group |

- Max per group = 4 teams × 3 = **12**; across 12 groups = **144**.
- Same convex philosophy as group matches: nailing the **exact** position pays 3× the consolation for being one off.
- **Example (the owner's case):** user predicted Germany 3rd, Germany finishes 3rd → **+3**. Predicted 4th, finished 3rd → **+1**. Predicted 1st, finished 3rd → **+0**.

> **On correlation with Dimension A:** group ranks are derived from the same predicted scores, so a strong match-predictor tends to also score here. That is intentional — ranking rewards getting the *overall shape* of a group right even when individual scorelines are off, and vice-versa. Its modest weight (max 96 vs. the group-match bucket) keeps it from double-counting into dominance.

---

## 5. Dimension C — Knockout progression (per team, progressive)

**Kept from the current system, with the progression made explicit.** In the workbook, predicting a team to reach the Semi-final automatically lists it as an advancer in R32, R16, QF, *and* SF. So `advancement_predictions` already contains a team once per round up to its predicted depth.

Scoring is **progressive**: for each round, award that round's weight for every team that the user predicted to reach it **and** that actually reached it (set intersection of `advancement_predictions` and `actual_advancers`). A team predicted to win the cup that actually exits in the QF still earns R32 + R16 + QF — full credit for the depth it *did* reach.

### Default weights

| Round | Constant | Value | Max (correct teams) |
|-------|----------|------:|--------------------:|
| Reached Round of 32 | `R32` | **1** | 32 → 32 |
| Reached Round of 16 | `R16` | **2** | 16 → 32 |
| Reached Quarter-final | `QF` | **4** | 8 → 32 |
| Reached Semi-final | `SF` | **6** | 4 → 24 |
| Reached Final | `FINAL` | **8** | 2 → 16 |

Weights are convex (each round worth more than the last) because deeper predictions are progressively harder and rarer. Knockout bucket max ≈ **136** (+ champion below). Unchanged from today — already well-balanced, so left as-is.

**Example (the owner's case):** user predicts Germany reaches the Semi-final.
- Germany reaches R32 → +1, R16 → +2, QF → +4, SF → +6. (Running total +13 if it gets there.)
- If Germany instead loses in the QF: user banked +1 +2 +4 = **+7**, and simply doesn't earn the SF points. No penalty, partial credit for the correct depth.

---

## 6. Dimension D — Champion

| Constant | Value |
|----------|------:|
| `CHAMPION` | **12** |

The single highest-value pick — one team, one chance, scored as part of the same advancement intersection (`round = 'CHAMPION'`). Kept at 12; it's the marquee call and dwarfs any single other pick without distorting the table.

---

## 7. Total score & tiebreakers

```
total =  Σ match_points  (72 group matches, Dimension A)
       + Σ rank_points    (48 teams in completed groups, Dimension B)
       + Σ knockout_weight(round)   over correct advancers (Dimension C)
       + CHAMPION if correct        (Dimension D)
```

**Ordering (extended from the original three):**

```
1. total                desc   — the score
2. exact_count          desc   — number of perfect group scorelines (skill tiebreak)
3. champion_correct     desc   — got the winner right (1 before 0)
4. created_at           asc    — earliest submission wins ties
```

`champion_correct` is added as a tiebreak so that, all else equal, the player who called the champion ranks above one who didn't.

---

## 8. Balance / calibration

"Balanced" = no dimension structurally dominates. Approximate **realistic** (not theoretical-max) contributions for a knowledgeable player:

| Dimension | Theoretical max | Realistic range | Notes |
|-----------|----------------:|----------------:|-------|
| A · Group matches | 576 (72×8) | ~95–150 | Volume bucket; exacts are rare, so realized ≪ max |
| B · Group ranking | 144 | ~35–65 | Correlated with A but rewards group shape |
| C · Knockout | 136 | ~30–70 | Convex; deep correct picks pay off |
| D · Champion | 12 | 0 or 12 | All-or-nothing |

The realistic ranges sit in the same order of magnitude, which is the design target. **Every weight is a single tunable constant** (see §9) — if after a test pool one bucket dominates, scale that bucket's constants without touching the formula.

> **Note on the precision bump.** Raising `W_EXACT` (1→3) and `W_RANK_EXACT` (2→3) deliberately tilts the system toward rewarding accuracy, as requested. It does not unbalance the *buckets* much (exacts are rare, so the realized ranges barely move), but it sharply widens the gap between a precise player and a lucky one — which is the intended effect.

> If you later want strict balance, the cleanest lever is `W_OUTCOME` (the volume driver): dropping it from 2 → 1 roughly halves the group-match bucket.

---

## 9. Implementation (as built)

No change to the **parser** (`lib/parseWorkbook.ts`) and no new prediction input — ranks are derived. Changes were confined to the database layer plus a small seed addition and display tweaks.

### 9.1 New: group membership (seed)

The standings computation needs to know each team's group. Add a tiny static table, seeded once from the workbook's `Groups` sheet (slots `A1`…`L4`):

```sql
create table if not exists team_groups (
  team         text primary key,   -- canonical name, e.g. 'Germany'
  group_letter text not null        -- 'A'..'L'
);
```

`scripts/seed.ts` already reads the workbook — extend it to populate `team_groups` (48 rows) alongside the 72 `matches`.

### 9.2 Weights: single source of truth

Today knockout weights live in the `round_weights` table. Add the group-match and ranking weights the same way so **all** scoring constants live in SQL:

```sql
create table if not exists scoring_weights (
  key   text primary key,
  value int  not null
);
insert into scoring_weights(key, value) values
  ('W_OUTCOME', 2), ('W_GOALDIFF', 1), ('W_TEAMGOALS', 1), ('W_EXACT', 3),
  ('W_RANK_EXACT', 3), ('W_RANK_ADJACENT', 1)
on conflict (key) do update set value = excluded.value;
-- round_weights (R32..CHAMPION) stays as the knockout source of truth.
```

### 9.3 Rewrite the `leaderboard` view

Three CTEs, summed (sketch — column names elided for brevity):

```sql
-- A) group match points (replaces the 3/1/0 case with the layered sum)
group_match_scores as (
  select p.entry_id,
    sum( w_outcome   * (sign(p.pred_home-p.pred_away) = sign(m.home_goals-m.away_goals))::int
       + w_goaldiff  * ((p.pred_home-p.pred_away) = (m.home_goals-m.away_goals))::int
       + w_teamgoals * ((p.pred_home = m.home_goals)::int + (p.pred_away = m.away_goals)::int)
       + w_exact     * (p.pred_home = m.home_goals and p.pred_away = m.away_goals)::int
    ) as group_points,
    count(*) filter (where p.pred_home = m.home_goals and p.pred_away = m.away_goals) as exact_count
  from predictions p join matches m on m.id = p.match_id
  where m.home_goals is not null and m.away_goals is not null
  group by p.entry_id
)

-- B) ranking: a `standings(entry_id, team, rank)` helper computed twice
--    (once over actuals → entry_id NULL, once per entry over its predictions)
--    using row_number() over (partition by group_letter
--                             order by pts desc, gd desc, gf desc, team asc),
--    gated to groups whose 6 matches are all logged; then compare ranks.

-- C) knockout bonus: unchanged (advancement_predictions ⋈ actual_advancers ⋈ round_weights)
```

The standings helper is the only genuinely new SQL. It builds a per-team `(points, gf, ga)` aggregate from match rows, then `row_number()` within each group. Doing it **once for actuals and once per entry** (UNION or a parameterized CTE keyed by entry) yields predicted vs. actual ranks to compare. A SQL function `group_standings(scores_source)` keeps it DRY.

### 9.4 Display

- Leaderboard columns: `total`, `group_points`, `ranking_points`, `knockout_points`, `champion_pick`, `exact_count`.
- Optional per-user breakdown page showing the four buckets — recommended so players understand their score.

### 9.5 Validation gate (extends the existing parser gate)

Against the sample file (`WCup_2026_4.2.7_en.xlsx`, champion "Spain"):
- Predicted standings derived in SQL for each group must total 4 teams ranked 1–4 with no ties left unbroken.
- A self-consistency check: the **actual** standings computed from the sample's *own* scores must place the workbook's known group winners 1st (cross-check a couple of groups against `CalcA`/`CalcE`).
- Group-match scoring sanity: feeding a prediction identical to the actual must yield exactly `72 × 8 = 576` group points and `exact_count = 72`.

---

## 10. Edge cases & decisions

| Case | Decision |
|------|----------|
| Match not yet played | Contributes 0 (both goals NULL); no penalty. |
| Group partly logged | Ranking for that group is **withheld** until all 6 matches are in; group-match points accrue per match as logged. |
| Tie in standings (same Pts/GD/GF) | Broken by team name (deterministic). Affects predicted and actual identically. |
| Head-to-head differs from GD order | Accepted simplification (§4); documented, not implemented. |
| Team predicted deep but eliminated early | Keeps all points for rounds it *did* reach (progressive, no clawback). |
| 3rd-place playoff (match 103) | Not separately scored — both teams already counted as semi-finalists; loser of a SF is still an SF advancer. (Unchanged.) |
| Champion wrong | 0 for `CHAMPION`; the team still earns its R32…FINAL advancement points if it got that far. |
| Re-scoring after a correction | View is computed live — editing a result instantly re-scores everyone, no backfill. (Unchanged.) |

---

## 11. Summary of all weights (the tuning surface)

| Dimension | Constant | Default | Lives in |
|-----------|----------|--------:|----------|
| A | `W_OUTCOME` | 2 | `scoring_weights` |
| A | `W_GOALDIFF` | 1 | `scoring_weights` |
| A | `W_TEAMGOALS` | 1 | `scoring_weights` |
| A | `W_EXACT` | 3 | `scoring_weights` |
| B | `W_RANK_EXACT` | 3 | `scoring_weights` |
| B | `W_RANK_ADJACENT` | 1 | `scoring_weights` |
| C | `R32` / `R16` / `QF` / `SF` / `FINAL` | 1 / 2 / 4 / 6 / 8 | `round_weights` |
| D | `CHAMPION` | 12 | `round_weights` |
| F | reuses A's `W_OUTCOME`/`W_GOALDIFF`/`W_TEAMGOALS`/`W_EXACT` | — | `scoring_weights` |
| Foresight | reuses `round_weights` (R32…FINAL) | 1 / 2 / 4 / 6 / 8 | `round_weights` |

Change any number in one place; the live view reflects it on the next read.

---

## 12. Knockout scorelines v3 — per-round tours + foresight bonus

The original model scored knockouts by **advancement only** (dimensions C/D). The
app later added per-knockout-game **scoreline** scoring; this section is the
authoritative spec for it and supersedes any "advancement only, never by knockout
scoreline" wording elsewhere. C/D (reach-a-round) are **unchanged** and still the
backbone; what follows adds scoreline credit on top.

### 12.1 The "second round of guessing" (Dimension F)

After the group stage the real bracket is known, so each knockout round opens a
fresh, **editable** prediction window. Users predict the **actual** matchup of
every game in the round (matches 73–102, 104), stored in `round_tour_predictions`
(one upserted row per entry+match; no teams stored — the matchup is implicit via
`actual_knockout_matches`). Each game is scored **exactly like a group match**
(the same stacking axes and weights, **flat max 8 per game — every round equal**;
depth is already rewarded by C/D and the foresight bonus).

- **Deadline / fairness:** the whole round locks at its **first kickoff** (seeded
  from the workbook). A pick scores only if its `updated_at` predates that
  deadline — enforced at write time (`PUT /api/tours`) and again in SQL
  (`round_tour_predictions.updated_at < min(kickoff) of the round`).
- **Penalties:** a level prediction needs a penalty winner (one of the two teams);
  the scoreline is scored on the regulation/ET goals, the penalty winner is the
  advancement tiebreak the player also commits to.

### 12.2 Foresight bonus (the repurposed "Dimension E")

The pre-tournament bracket already captures each entry's predicted knockout
scorelines (`knockout_predictions`). These **no longer score 8 on their own** —
that would double-pay the same call the tours score. Instead they grant a
**foresight bonus**: if the bracket nailed BOTH the **exact matchup** (teams) AND
the **exact scoreline** of a real game — foreseen blind, before any of it was
known — it earns that round's advancement weight as a bonus:

| Round | R32 | R16 | QF | SF | FINAL |
|-------|----:|----:|---:|---:|------:|
| Bonus | +1 | +2 | +4 | +6 | +8 |

(Identical to `round_weights`, reused.) The bonus rewards *deep* foresight far more
than a shallow one. Gated by `knockout_predictions.is_score_eligible` (true only
when the bracket predated the game), so a late entry can't farm it. Both the
bracket and the actual bracket use the same `deriveBracket` slot orientation, so
the exact `match_no` + teams + score join is consistent.

### 12.3 Where the actual matchups come from

`actual_knockout_matches` (matchup + scoreline + penalty winner + seeded kickoff)
is populated by `POST /api/sync` via `lib/actualBracket.deriveActualKnockout()`,
which reuses `deriveBracket` on the **real** group results to fix the R32 slots and
maps football-data.org's knockout fixtures onto them. It only writes a slot the API
**corroborates** (never a fabricated matchup); fair-play tie-break divergences are
left for the admin master-upload (`apply_master_results`) to override. See
`docs/RESULTS_SYNC.md`.

### 12.4 Totals

`knockout_points` now sums **C + D + F + foresight** (all knockout-flavoured), so
the leaderboard column set is unchanged. `played_count`'s knockout half follows the
**tour** predictions (games you actually entered that have a logged result).
