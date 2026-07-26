import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWrapped, slugify, koRoundOf, type WrappedInput } from "./wrapped";

// -----------------------------------------------------------------------------
// A small, deterministic 3-player fixture (no PII). One full group of 4 teams
// (T1..T4, 6 matches) so standings work, plus a minimal knockout (FINAL +
// CHAMPION advancers only). Ada predicts every group game perfectly; Bo is her
// identical twin; Cy predicts 0-0 for everything.
//
// The knockout_points on the leaderboard rows are hand-computed so the module's
// KO-by-round reconciliation (meta.warnings) must come back empty.
// -----------------------------------------------------------------------------

const RESULTS: [number, string, string, number, number][] = [
  [1, "T1", "T2", 2, 0],
  [2, "T3", "T4", 1, 1],
  [3, "T1", "T3", 1, 0],
  [4, "T2", "T4", 2, 1],
  [5, "T1", "T4", 3, 1],
  [6, "T2", "T3", 0, 0],
];

function makeInput(): WrappedInput {
  const matches = RESULTS.map(([no, home, away, hg, ag]) => ({
    id: no,
    match_no: no,
    home_team: home,
    away_team: away,
    kickoff_at: `2026-06-${10 + no}T12:00:00Z`,
    home_goals: hg,
    away_goals: ag,
  }));

  const entries = [
    { id: 1, username: "Ada", created_at: "2026-06-09T00:00:00Z", is_hidden: false },
    { id: 2, username: "Bo", created_at: "2026-06-09T01:00:00Z", is_hidden: false },
    { id: 3, username: "Cy", created_at: "2026-06-09T02:00:00Z", is_hidden: false },
  ];

  const perfect = RESULTS.map(([no, , , hg, ag]) => ({ match_id: no, ph: hg, pa: ag }));
  const zeros = RESULTS.map(([no]) => ({ match_id: no, ph: 0, pa: 0 }));
  const predictions = [
    ...perfect.map((p) => ({ entry_id: 1, match_id: p.match_id, pred_home: p.ph, pred_away: p.pa, is_score_eligible: true })),
    ...perfect.map((p) => ({ entry_id: 2, match_id: p.match_id, pred_home: p.ph, pred_away: p.pa, is_score_eligible: true })),
    ...zeros.map((p) => ({ entry_id: 3, match_id: p.match_id, pred_home: p.ph, pred_away: p.pa, is_score_eligible: true })),
  ];

  const teamGroups = ["T1", "T2", "T3", "T4"].map((team) => ({ team, group_letter: "A" }));

  const advancementPredictions = [
    { entry_id: 1, round: "FINAL" as const, team: "T1" },
    { entry_id: 1, round: "FINAL" as const, team: "T2" },
    { entry_id: 1, round: "CHAMPION" as const, team: "T1" },
    { entry_id: 2, round: "FINAL" as const, team: "T1" },
    { entry_id: 2, round: "FINAL" as const, team: "T2" },
    { entry_id: 2, round: "CHAMPION" as const, team: "T2" },
    { entry_id: 3, round: "FINAL" as const, team: "T1" },
    { entry_id: 3, round: "CHAMPION" as const, team: "T1" },
  ];
  const actualAdvancers = [
    { round: "FINAL" as const, team: "T1", logged_at: "2026-07-01T00:00:00Z" },
    { round: "FINAL" as const, team: "T2", logged_at: "2026-07-01T00:00:00Z" },
    { round: "CHAMPION" as const, team: "T1", logged_at: "2026-07-01T00:00:00Z" },
  ];

  const roundWeights = [
    { round: "R32", weight: 1 },
    { round: "R16", weight: 2 },
    { round: "QF", weight: 4 },
    { round: "SF", weight: 6 },
    { round: "FINAL", weight: 8 },
    { round: "CHAMPION", weight: 12 },
  ];
  const scoringWeights = [
    { key: "W_OUTCOME", value: 2 },
    { key: "W_GOALDIFF", value: 1 },
    { key: "W_TEAMGOALS", value: 1 },
    { key: "W_EXACT", value: 3 },
    { key: "W_RANK_EXACT", value: 3 },
    { key: "W_RANK_ADJACENT", value: 1 },
  ];

  // Hand-computed KO points: Ada FINAL(T1,T2)=16 + CHAMPION(T1)=12 => 28;
  // Bo FINAL 16 + champ wrong 0 => 16; Cy FINAL(T1)=8 + champ(T1)=12 => 20.
  // Ada/Bo predict every group scoreline exactly, so group_points = 6*8 = 48 and
  // ranking_points = 4 teams * W_RANK_EXACT(3) = 12 (predicted table == actual).
  // Cy predicts 0-0 everywhere: group_points = sum(scoreGroupMatch(0,0,...)) = 13
  // (only match 6, T2 0-0 T3, is exact); Cy's all-0-0 table ties every team on
  // pts=3/gd=0/gf=0, broken alphabetically (T1..T4), which happens to match the
  // actual table's order exactly here, so ranking_points = 4*3 = 12. Verified
  // programmatically against lib/groupMatchScore.ts, not just hand-arithmetic.
  const leaderboard = [
    { entry_id: 1, username: "Ada", champion_pick: "T1", group_points: 48, ranking_points: 12, knockout_points: 28, total: 88, exact_count: 6, played_count: 6, champion_correct: 1, created_at: "2026-06-09T00:00:00Z" },
    { entry_id: 2, username: "Bo", champion_pick: "T2", group_points: 48, ranking_points: 12, knockout_points: 16, total: 76, exact_count: 6, played_count: 6, champion_correct: 0, created_at: "2026-06-09T01:00:00Z" },
    { entry_id: 3, username: "Cy", champion_pick: "T1", group_points: 13, ranking_points: 12, knockout_points: 20, total: 45, exact_count: 1, played_count: 6, champion_correct: 1, created_at: "2026-06-09T02:00:00Z" },
  ];

  return {
    entries,
    predictions,
    matches,
    knockoutPredictions: [],
    tourPredictions: [],
    advancementPredictions,
    actualAdvancers,
    actualKnockout: [],
    teamGroups,
    roundWeights,
    scoringWeights,
    leaderboard,
  };
}

test("koRoundOf maps knockout match numbers to rounds", () => {
  assert.equal(koRoundOf(73), "R32");
  assert.equal(koRoundOf(88), "R32");
  assert.equal(koRoundOf(89), "R16");
  assert.equal(koRoundOf(97), "QF");
  assert.equal(koRoundOf(101), "SF");
  assert.equal(koRoundOf(103), "THIRD");
  assert.equal(koRoundOf(104), "FINAL");
  assert.equal(koRoundOf(72), null);
});

test("slugify makes url-safe, deterministic slugs", () => {
  assert.equal(slugify("IV. Levent Mercan"), "iv-levent-mercan");
  assert.equal(slugify("arda"), "arda");
  assert.equal(slugify("Curaçao"), "curacao");
  assert.equal(slugify("!!!"), "player");
});

test("buildWrapped: KO-by-round reconciliation matches the leaderboard (no warnings)", () => {
  const data = buildWrapped(makeInput(), "2026-07-26T00:00:00Z");
  assert.deepEqual(data.meta.warnings, []);
});

test("buildWrapped: ranks users by total and derives per-user accuracy", () => {
  const data = buildWrapped(makeInput(), "2026-07-26T00:00:00Z");
  assert.equal(data.users.length, 3);
  assert.deepEqual(
    data.users.map((u) => u.username),
    ["Ada", "Bo", "Cy"],
  );
  const ada = data.users[0];
  const cy = data.users[2];

  // Ada predicted every group game exactly.
  assert.equal(ada.exactCountRaw, 6);
  assert.equal(ada.outcomeHits, 6);
  assert.equal(ada.bestGame.points, 8);

  // Cy predicted 0-0 everywhere: exact only on the real 0-0 (match 6).
  assert.equal(cy.exactCountRaw, 1);
  assert.equal(cy.drawsPredicted, 6);

  // Knockout points reconcile per user.
  assert.equal(ada.knockoutPoints, 28);
  assert.equal(ada.koPointsByRound.FINAL, 16);
  assert.equal(ada.championJourneyRounds, 6); // T1 reached CHAMPION (depth 6)
  assert.equal(ada.tourGamesPlayed, 0);
  assert.equal(ada.foresightPoints, 0);
});

test("buildWrapped: identical predictors are twins; matrix is symmetric", () => {
  const data = buildWrapped(makeInput(), "2026-07-26T00:00:00Z");
  const ada = data.users.find((u) => u.username === "Ada")!;
  assert.equal(ada.twin?.username, "Bo");
  assert.equal(ada.twin?.identical, 6); // all 6 group scorelines identical

  const m = data.global.agreementMatrix;
  const ai = m.usernames.indexOf("Ada");
  const bi = m.usernames.indexOf("Bo");
  assert.equal(m.identical[ai][bi], 6);
  assert.equal(m.identical[ai][bi], m.identical[bi][ai]); // symmetric
});

test("buildWrapped: personas are distinct; timeline ends at the final total", () => {
  const data = buildWrapped(makeInput(), "2026-07-26T00:00:00Z");
  const personas = data.users.map((u) => u.persona.key);
  assert.equal(new Set(personas).size, personas.length); // all distinct

  for (const u of data.users) {
    assert.equal(u.cumulative.length, data.global.timeline.checkpoints.length);
    // The last checkpoint's cumulative equals the player's final total.
    assert.equal(u.cumulative[u.cumulative.length - 1], u.total);
  }
});

test("buildWrapped: global champion and single-game hero", () => {
  const data = buildWrapped(makeInput(), "2026-07-26T00:00:00Z");
  assert.equal(data.global.champion, "T1");
  assert.equal(data.global.singleGameHero?.game.points, 8);
  assert.equal(data.meta.playerCount, 3);
});

test("buildWrapped: full replay reconciles to the official total and is chronological", () => {
  const data = buildWrapped(makeInput(), "2026-07-26T00:00:00Z");
  assert.deepEqual(data.meta.warnings, []); // includes the replay's own reconciliation check

  const { replay } = data.global;
  assert.equal(replay.usernames.length, 3);

  // Strictly non-decreasing timestamps across the whole event stream.
  for (let i = 1; i < replay.points.length; i++) {
    assert.ok(
      new Date(replay.points[i].at).getTime() >= new Date(replay.points[i - 1].at).getTime(),
    );
  }

  // The origin point starts everyone at zero.
  assert.deepEqual(replay.points[0].cumulative, replay.usernames.map(() => 0));

  // The final event's cumulative equals each player's official total, in the
  // same order as replay.usernames (final-rank order).
  const last = replay.points[replay.points.length - 1];
  for (let i = 0; i < replay.usernames.length; i++) {
    const u = data.users.find((x) => x.username === replay.usernames[i])!;
    assert.equal(last.cumulative[i], u.total);
  }

  // Cumulative totals never decrease (every event only adds points, never subtracts).
  for (let i = 1; i < replay.points.length; i++) {
    for (let j = 0; j < replay.usernames.length; j++) {
      assert.ok(replay.points[i].cumulative[j] >= replay.points[i - 1].cumulative[j]);
    }
  }
});
