# World Cup 2026 — "Wrapped" & End-of-Tournament Analytics — PLAN

**Status:** Planning only. No code yet. This is the analysis catalogue + build sketch.
**Context:** Tournament is over; all data in Supabase is final and static.
**Pool size:** **Exactly 5 players.** This is the single most important design constraint.
**Delivery:** Both a per-user shareable "Wrapped" *and* a public global-insights page.
**Visibility:** Fully public; naming individuals in comparisons is encouraged (friends pool).
**Segmentation:** Global only (no per-league breakdowns).

**Locked implementation choices (from planning Q&A):**
- **Compute/storage:** precompute everything once into a cached `wrapped.json` (or a
  `wrapped_cache` table) via a one-off script — data is frozen, so no live recompute.
- **v1 visuals:** clean **scrollable pages + charts** (heatmap, podium, snapshot
  timeline). Full animated swipe-story is a later polish pass, not v1.
- **Sharing:** **client-side image export** — a "download/share my card" button that
  renders a card to PNG in-browser (dom-to-image style); no server image route in v1.
- **Build order:** **data layer first** — `lib/wrapped.ts` + tests (kicked off by a
  read-only DB extract to ground it in real numbers), then UI on top.

---

## 0. Design philosophy for n = 5

With only 5 predictors, forget statistics-at-scale. There are no meaningful
percentiles, no clusters, no "top 1%." Instead we lean into what a tiny pool does
*better* than a big one:

- **Everything is nameable.** "You and Bob agreed on 61 of 72 games" beats "you're
  in the 80th similarity percentile."
- **Full pairwise coverage.** 5 players → **10 pairs** → we can show the entire
  similarity matrix, every rivalry, every twin/opposite, exhaustively.
- **Every game has a hero.** For each of ~104 matches we can list all 5 predictions,
  crown the closest, and flag "pool blind spots" (all 5 wrong).
- **The crowd is the other 4.** "Contrarian" = you vs the other four. "Consensus" =
  all five agreeing. Both are crisp with n=5.
- **Micro-leaderboards everywhere.** Any metric → a ranked list of 5. We can afford
  dozens of them (Most Exacts, Biggest Optimist, Draw Whisperer, …).
- **Personas.** Each of the 5 gets a character card — the narrative spine.

Language rule: never say "percentile"; say "1st of 5", "the only one who…",
"more than the other four combined", etc.

---

## 1. Data inventory (what we can mine)

### Predictions (per entry; 5 entries)
| Source | Content | Lens it powers |
|---|---|---|
| `predictions` | 72 group scorelines (pred_home/away), `is_score_eligible` | group accuracy, biases, exacts |
| `entries.created_at` | submission timestamp | early-bird vs deadline-hero |
| `knockout_predictions` | each entry's **own** bracket: matchups + scorelines 73–104, penalty winners | "did your bracket come true", foresight |
| `advancement_predictions` | teams picked to reach R32/R16/QF/SF/FINAL/CHAMPION | how deep you backed each team, champion pick |
| `round_tour_predictions` | second-tour scorelines vs the **real** matchups | KO scoreline accuracy on real games |
| `follows`, `leagues` | social graph | (minor; global-only so mostly unused) |

### Ground truth
| Source | Content |
|---|---|
| `matches` | 72 group results, `kickoff_at`, `result_logged_at` |
| `actual_advancers` | who actually reached each round |
| `actual_knockout_matches` | KO scorelines + penalty winners + kickoff |
| `team_groups` | team → group A–L (for standings) |
| derived standings | each team's actual group finish (pts→GD→GF→name) |

### Already computed
`leaderboard` / `compute_leaderboard()` gives per-entry `group_points`,
`ranking_points`, `knockout_points`, `total`, `exact_count`, `played_count`,
`champion_pick`, `champion_correct`. This is our scoreboard backbone; everything
else is new derivation.

### Two knockout lenses (keep them distinct)
1. **Your bracket** (`knockout_predictions` + `advancement_predictions`): your
   *imagined* path — mostly different teams than reality. Powers "how much of your
   bracket survived", champion journey, foresight.
2. **The tours** (`round_tour_predictions` vs `actual_knockout_matches`): scorelines
   on the **real** matchups. Powers "how well you predicted the actual KO games."
   Always label which lens a stat uses.

---

## 2. PART A — Individual "Wrapped" (generated for each of the 5)

A swipeable set of cards, one insight per card. Grouped below by theme. Each bullet
= one card, with its one-line computation.

### A1 · The headline
1. **Final standing** — "#2 of 5, 187 pts." (`leaderboard.total`, rank).
2. **Points breakdown** — group / ranking / knockout split as a bar or mini-radar.
   Name your strongest dimension ("Your superpower: group scorelines").
3. **Your persona** — the character card (see §7), derived from your stat profile.

### A2 · Group-stage skill
4. **Exact scorelines** — count + your single best exact ("9 perfect scores; the
   pick of the bunch: Brazil 3–1 Croatia"). From `predictions` vs `matches`.
5. **Best single call** — highest-scoring one game (max match_points), ideally one
   where you beat the other four on it.
6. **Signature contrarian hit** — a correct call **no other player made** (you alone
   got the outcome/exact). The boldness flex.
7. **Biggest whiff** — your largest single-game error (|pred−actual| aggregate), or a
   confident pick that inverted ("You had Germany top the group; they finished 4th").
8. **Near-miss tax** — games you were exactly 1 goal from a perfect score (count).
   "Six times one goal away from perfection. Ouch."
9. **Outcome hit-rate** — of 72, how many W/D/L you called correctly (x/72).

### A3 · Your tendencies (fun bias cards)
10. **Optimist / pessimist index** — your avg goals/game predicted vs the group's
    actual avg. "3.1 vs 2.6 — certified goal glutton."
11. **Draw-phobia** — draws you predicted vs 14 actual draws.
12. **Home bias** — mean(pred_home − pred_away) across 72.
13. **Comfort scoreline** — the scoreline you typed most (e.g. 2–1 ×11), and how
    often it landed.
14. **Chalk vs maverick** — of 72 games, how often you matched the pool-majority
    outcome vs went against it. A single "maverick score" (0 = follows the herd,
    high = lone wolf).

### A4 · The knockouts & your champion
15. **Champion journey** — who you crowned and how far they actually went. "You rode
    with France for 6 rounds; they fell in the semis." (`advancement` vs `actual`).
16. **Bracket survival** — how many of your predicted final-8 / final-4 / finalists
    actually got there (your-bracket lens).
17. **Real-KO scoreline accuracy** — points/exacts from the tours on real matchups.
18. **Penalty prophet** — shootout winners you called correctly (tours + bracket).
19. **Foresight flex** — any pre-tournament bracket game where you nailed the exact
    matchup **and** scoreline (rare; if you have one, it's a whole card).

### A5 · Team & group relationships
20. **The team you believed in** — team you backed deepest / gave most points.
21. **Your MVP team** — team that actually earned you the most points (all dims).
22. **Your kryptonite** — the group you scored worst on / a team you dumped that went
    far ("You had Morocco out in the group; they made the final").
23. **Ranking accuracy** — of 48 team group-positions, how many exact / adjacent.

### A6 · Social & timing (n=5 shines here)
24. **Twin brain** — the player most similar to you (identical-scoreline count out of
    72) — "You and Bob: 61/72 identical. Separated at birth?"
25. **Polar opposite** — least similar player.
26. **Closest rival** — nearest player in final score, + the game that decided it.
27. **Head-to-head ledger** — vs each other player: on how many of 72 games did you
    out-score them. A 4-row mini-table (you vs each).
28. **Submission timing** — where you fell in the 5 (early bird / deadline hero) and
    whether it helped.

### A7 · The arc
29. **Your race line** — your cumulative-score curve through the tournament; your
    peak rank and when you held it (see §6, the timeline engine).
30. **Best / worst round** — the tournament phase (groups, R32, R16, QF, SF, final)
    you scored most and least in.

> Target: ~12–18 of these as "cards"; the rest as a scrollable "all your stats"
> appendix on the same page. Pick the punchiest for the swipe deck.

---

## 3. PART B — Global insights page (public)

### B1 · The scoreboard
- **Final leaderboard** (all 5) with breakdown bars (group/ranking/knockout).
- **The podium** — top 3 highlighted; see §4 for the champion celebration.

### B2 · The race (headline viz)
- **Cumulative-score timeline** — all 5 lines across the tournament, lead changes
  marked, "the moment it was decided" annotated. (§6 engine.)
- **Lead-change log** — "Alice led after the group stage; Bob took over in the QFs."

### B3 · Wisdom (and folly) of the crowd of five
- **Collective triumphs** — games where all 5 nailed the winner (or an exact).
- **Collective blunders** — games where all 5 got the winner wrong. "Every one of you
  had England over USA. USA won." The pool's shared blind spots.
- **Pool aggregate bracket** — the bracket implied by majority picks vs the real one.
- **Champion picks** — who the 5 crowned; how many backed the real winner.

### B4 · Teams: hard vs easy to predict
- **Predictability index per team** — combine (a) avg scoreline error across all
  5×matches the team played, and (b) how many of 5 got the team's exact group finish.
  Rank all 48. "Hardest to read: Croatia. Easiest: Argentina."
- **Most overrated by the pool** — biggest gap between pool's avg predicted depth and
  actual depth (backed deep, went out early).
- **Most underrated** — the inverse (dumped early, went far). The tournament's
  Cinderella that the pool missed.
- **Group report cards** — for each of 12 groups, avg rank-accuracy across the 5.
  Which group was a minefield.

### B5 · The matches
- **Biggest shock (pool-relative)** — the real result with the largest total
  prediction error across the 5 / most players' winner wrong.
- **Most predictable** — all 5 close.
- **Single-game hero** — highest points any player earned on one game, poolwide.
- **The costly game** — the one match that cost the pool the most points collectively.

### B6 · The agreement matrix
- **5×5 similarity heatmap** — pairwise identical-scoreline counts (0–72). Reveals
  the "same brain" pair and the two opposites at a glance.
- **Most similar & most different pair** called out explicitly.

### B7 · Superlatives / awards (one player each — see §5)
A wall of ~12 badges, each with the winner and the number behind it.

### B8 · Tournament-vs-pool fun facts
- Total goals the pool *expected* vs actual; biggest over/under-caller.
- Number of draws predicted (poolwide) vs 14 actual.
- Count of exact scorelines across the whole pool; the rarest correct exact (one
  player, unlikely scoreline).

---

## 4. PART C — Top-3 & champion celebration

- **Animated podium reveal** (3rd → 2nd → 1st), each with total + one signature stat
  ("won it on group-stage precision: 14 exacts").
- **Winner spotlight** — a dedicated hero section for #1: their persona, their best
  call, their champion pick, their race line, their margin of victory, and *the*
  moment/game that sealed it (from the timeline — the last lead change or the game
  that pushed them clear).
- **Margin & drama** — how close it was; did the winner ever trail; largest lead held.
- **Shareable "champion card"** for the winner (and a personal card for everyone else).

---

## 5. Superlatives / awards catalogue (each → exactly one of the 5)

| Award | Metric |
|---|---|
| 🎯 Sharpshooter | most exact group scorelines |
| 🧠 The Oracle | highest total (the winner) |
| 🃏 The Maverick | most contrarian-correct calls (right, when few/none agreed) |
| 🐑 The Chalk-Eater | most often sided with the pool majority |
| 📈 The Optimist | highest avg goals predicted |
| 📉 The Pragmatist | lowest avg goals predicted |
| 🤝 The Draw Whisperer | most correct draws |
| 🏰 Best Bracketeer | most of own bracket surviving / best advancement pts |
| 🔮 The Foreseer | most/any foresight bonuses |
| 🎢 The Comeback / 💥 The Collapse | biggest rank climb / fall on the timeline |
| 🕰️ The Early Bird / ⏰ Deadline Hero | first / last to submit |
| 😬 The Unluckiest | most 1-goal-away near-miss exacts |
| 🎖️ Group-Stage King / 👑 Knockout King | most points in that phase |
| 🧮 Best Forecaster of Ranks | most exact group-finish positions |
| 🥊 Rivalry of the Tournament | the closest final-score pair (awarded to the pair) |

Every award shows the winner **and the number**, so it reads as data, not fluff.

---

## 6. The timeline engine (shared dependency for A29, B2, C)

The single most valuable — and most technical — piece.

**Goal:** each player's cumulative score after every chronological event, to draw
race lines and detect lead changes.

**Wrinkle:** `compute_leaderboard()` supports a *start* floor, not an "as-of *end*"
cutoff, and some dimensions unlock in bulk (group ranking at a group's 6th game;
advancement when a round's advancers are logged). So we can't just call it per match.

**Two options:**
- **(a) Full replay (granular):** order all 104 games by `kickoff_at`; replay,
  awarding: group-match points as each game finishes; a group's ranking points when
  its 6th game lands; advancement/champion points when a round completes; tour +
  foresight points at each KO game. Rebuild cumulative totals per event. High detail,
  moderate effort; best done in a TS module over raw tables.
- **(b) Snapshot (coarse):** compute standings at ~6 checkpoints — end of groups, R32,
  R16, QF, SF, final. Much simpler; still tells the lead-change story. Good MVP.

Recommend (b) for v1, (a) if we want the smooth animated race.

---

## 7. Personas (the narrative spine)

Assign each of the 5 a character from their profile (deterministic rules over the
metrics above). Draft archetypes:

- **The Precisionist** — high exact-count, low goal-inflation.
- **The Gambler** — high maverick score, high variance, some big hits + big misses.
- **The Chalk Merchant** — follows consensus, steady, few exacts.
- **The Optimist** — inflates goals, backs favorites deep.
- **The Analyst** — best rank accuracy, strong group-stage, cautious knockouts.

Rules pick the best-fitting archetype per player (and we can guarantee 5 distinct
ones, or allow repeats with a tiebreak). Each persona = a card headline + a
one-line "scouting report."

---

## 8. Computation approach (sketch — not built yet)

The whole dataset is tiny and **frozen** (5 entries × 72 + brackets + tours + 104
truths). So:

- **Pull once, compute in TypeScript.** A `lib/wrapped.ts` (pure, testable) that
  takes the raw rows and returns a fully-typed `WrappedData` (global block + per-user
  blocks + matrices + awards + timeline). No new heavy SQL required; reuse
  `compute_leaderboard()` for the score backbone.
- **Because data is static, precompute + cache.** Either (i) an admin/one-off script
  that writes a single `wrapped.json` (or a `wrapped_cache` table), or (ii) an API
  route with long cache. No live recompute needed.
- **Routes (proposed):** `/wrapped` (global page) and `/wrapped/[username]` (personal).
  Entry points from the leaderboard + nav.
- **Sharing:** personal cards exportable as images (client-side canvas/DOM-to-image,
  or a server OG-image route) — decide in implementation.
- **Tests:** gate `lib/wrapped.ts` with `*.test.ts` using the existing workbook
  fixture / a synthetic 5-player scenario, per repo convention.

---

## 9. Decisions to nail before/at build (open questions)

1. **Accuracy vs scored.** Show *raw* accuracy ("you got 9 exacts") or only
   fairness-gated/scored numbers (matching the leaderboard)? Raw is more fun and
   intuitive; scored matches the board. Likely: show raw for storytelling, but keep
   the headline total identical to the leaderboard. Need a ruling.
2. **Late submitters.** If any of the 5 submitted after some kickoffs, their eligible
   set differs — verify all 5 predicted blind (probably yes); decide how to caption if
   not.
3. **Which KO lens per stat** — always label bracket-lens vs tours-lens (see §1).
4. **Standings ties** — we use pts→GD→GF→name (not FIFA h2h/fair-play); a couple of
   group finishes may differ from "official." Accept & footnote (already documented).
5. **Third-place playoff (103)** — include in "real KO scoreline" stats (it's a tour
   game), exclude from advancement/foresight (already how scoring treats it).
6. **Timeline granularity** — snapshot (v1) vs full replay (v2)?
7. **Persona uniqueness** — force 5 distinct personas or allow duplicates?

---

## 9b. Phase 0 findings (real data, extracted 2026-07-26)

Read-only extract (`scripts/wrappedExtract.ts` → `backups/wrapped_snapshot.json`,
gitignored). Ground truth confirmed: 5 entries, 72 group results (all logged), 32
knockouts 73–104 (all logged), advancers R32=32…CHAMPION=1, **champion = Spain**,
72 group predictions each.

Final board: **ErenAbiKazanacam 393** (champ France) · Eremedin Demirovic 369
(Argentina) · IV. Levent Mercan 362 (Spain ✓) · arda 350 (Spain ✓) · asensioper 332
(France; 10 exacts — most in the pool).

Design-relevant nuances the build must handle:
- **Uniform eligibility gate.** All 5 submitted 2026-06-14; group matches **1–8**
  (June 11–13 openers) had already kicked off, so those are `is_score_eligible=false`
  for **everyone** — each player has 64 eligible / 8 ineligible, identical set. Ruling
  (per §9.1 lean): compute fun-accuracy stats **raw over all 72** (fair, since the
  gate is uniform) but take the **headline total/group/rank/ko from the scored
  `leaderboard`**; footnote that 1–8 were locked at submission.
- **KO lens data is sparse for most players.** `knockout_predictions` (own-bracket
  scorelines) exist for **ErenAbiKazanacam only** → the **foresight bonus + "your
  bracket scorelines" cards apply to him alone**; the other four must degrade
  gracefully (their KO story = advancement + tours). All 5 have full
  `advancement_predictions` (63 each).
- **Tour participation is lopsided:** Levent 32, Eremedin 31, Eren 30, asensioper 16,
  **arda 1**. "arda skipped the knockout tours" is a genuine narrative; guard against
  divide-by-zero / empty-tour cards.
- **Actual group baselines** for bias cards: 215 goals (2.99/game), 20 draws, 34 home
  wins, 18 away wins.

## 10. Suggested build phases (as locked)

- **Phase 0 — Extract & sanity-check.** Read-only pull; confirm 5 entries, 72 results,
  all KO logged, champion set, everyone submitted pre-tournament. Freeze a fixture.
- **Phase 1 — `lib/wrapped.ts` + tests → cached `wrapped.json`.** All metrics as pure
  functions → typed `WrappedData`; a one-off script writes the cache. The real work;
  UI is thin on top. *(Build-order choice: this ships first.)*
- **Phase 2 — Global page** (`/wrapped`, scrollable + charts): leaderboard, podium,
  awards, agreement heatmap, hard/easy teams, collective triumphs/blunders, **snapshot
  timeline** (v1 granularity).
- **Phase 3 — Personal Wrapped** (`/wrapped/[username]`): the card deck + appendix,
  each card exportable to PNG **client-side**.
- **Phase 4 — Champion celebration** (podium reveal + winner spotlight + champion card).
- **Phase 5 (optional polish) — full animated race** (replay timeline) + swipe/story.
```
