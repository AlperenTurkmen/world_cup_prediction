/**
 * tours validation — the per-round window state machine and the pick sanitizer.
 *   - A round is "pending" before its matchups are known, "open" once they are and
 *     before its first kickoff, and "locked" the moment that first kickoff passes
 *     (the whole round freezes together).
 *   - Picks validate against the real matchups: scores are bounded integers and a
 *     level score must name a penalty-shootout winner who is one of the two teams.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTourState,
  roundOfMatch,
  sanitizeTourPicks,
  TOUR_ROUNDS,
  type ActualKoRow,
  type TourPick,
} from "./tours";

const HOUR = 3600_000;
const T0 = Date.parse("2026-07-01T16:00:00Z"); // R32 first kickoff in these rows

/** Two R32 games (73, 74); 73 kicks off first, so it is the round deadline. */
function r32Rows(overrides: Partial<ActualKoRow>[] = []): ActualKoRow[] {
  const base: ActualKoRow[] = [
    { match_no: 73, home_team: "Brazil", away_team: "Rep. of Korea", kickoff_at: "2026-07-01T16:00:00Z", home_goals: null, away_goals: null, penalty_winner: null },
    { match_no: 74, home_team: "France", away_team: "Japan", kickoff_at: "2026-07-01T20:00:00Z", home_goals: null, away_goals: null, penalty_winner: null },
  ];
  return base.map((r, i) => ({ ...r, ...(overrides[i] ?? {}) }));
}

test("a round with no known matchups is pending and nothing is editable", () => {
  const rows: ActualKoRow[] = [
    { match_no: 73, home_team: null, away_team: null, kickoff_at: "2026-07-01T16:00:00Z", home_goals: null, away_goals: null, penalty_winner: null },
  ];
  const state = buildTourState(rows, [], T0 - 24 * HOUR);
  const r32 = state.find((s) => s.round === "R32")!;
  assert.equal(r32.status, "pending");
  assert.ok(r32.matches.every((m) => !m.editable));
});

test("a drawn round before its first kickoff is open and editable, with picks joined", () => {
  const picks: TourPick[] = [{ match_no: 73, pred_home: 3, pred_away: 2, penalty_winner: null }];
  const state = buildTourState(r32Rows(), picks, T0 - HOUR); // 1h before deadline
  const r32 = state.find((s) => s.round === "R32")!;
  assert.equal(r32.status, "open");
  assert.equal(r32.deadline, "2026-07-01T16:00:00Z");
  const m73 = r32.matches.find((m) => m.matchNo === 73)!;
  assert.equal(m73.editable, true);
  assert.deepEqual(m73.pick, { predHome: 3, predAway: 2, penaltyWinner: null });
  // Even the later game (74, kickoff 20:00) is editable until the round deadline.
  assert.equal(r32.matches.find((m) => m.matchNo === 74)!.editable, true);
});

test("once the round's first kickoff passes the whole round locks", () => {
  const state = buildTourState(r32Rows(), [], T0 + 1); // 1ms after the 16:00 deadline
  const r32 = state.find((s) => s.round === "R32")!;
  assert.equal(r32.status, "locked");
  // Game 74 hasn't kicked off yet, but it still locks with the round.
  assert.ok(r32.matches.every((m) => !m.editable));
});

test("a logged result is surfaced and the game is not editable", () => {
  const rows = r32Rows([{ home_goals: 3, away_goals: 2 }]);
  const state = buildTourState(rows, [], T0 + HOUR);
  const m73 = state.find((s) => s.round === "R32")!.matches.find((m) => m.matchNo === 73)!;
  assert.equal(m73.homeGoals, 3);
  assert.equal(m73.awayGoals, 2);
  assert.equal(m73.editable, false);
});

const MATCHUPS = new Map([
  [73, { home: "Brazil", away: "Rep. of Korea" }],
  [74, { home: "France", away: "Japan" }],
]);

test("sanitizeTourPicks accepts decisive scores and drops any penalty winner", () => {
  const { picks, error } = sanitizeTourPicks("R32", { "73": { h: 3, a: 2, pen: "Brazil" } }, MATCHUPS);
  assert.equal(error, null);
  assert.deepEqual(picks, [{ matchNo: 73, predHome: 3, predAway: 2, penaltyWinner: null }]);
});

test("sanitizeTourPicks requires a valid penalty winner on a level score", () => {
  assert.match(sanitizeTourPicks("R32", { "73": { h: 1, a: 1 } }, MATCHUPS).error!, /penalty/i);
  assert.match(sanitizeTourPicks("R32", { "73": { h: 1, a: 1, pen: "Spain" } }, MATCHUPS).error!, /penalty/i);
  const ok = sanitizeTourPicks("R32", { "73": { h: 1, a: 1, pen: "Brazil" } }, MATCHUPS);
  assert.equal(ok.error, null);
  assert.equal(ok.picks[0].penaltyWinner, "Brazil");
});

test("sanitizeTourPicks rejects a match from the wrong round or with no matchup", () => {
  assert.match(sanitizeTourPicks("R32", { "89": { h: 1, a: 0 } }, MATCHUPS).error!, /not part of/i);
  assert.match(sanitizeTourPicks("R32", { "75": { h: 1, a: 0 } }, MATCHUPS).error!, /no known matchup/i);
});

// ── The third-place playoff (103): its own one-game tour round, between SF and FINAL.

test("the third-place playoff is its own tour round in play order", () => {
  const order = TOUR_ROUNDS.map((r) => r.round);
  assert.deepEqual(order, ["R32", "R16", "QF", "SF", "THIRD", "FINAL"]);
  assert.deepEqual(TOUR_ROUNDS.find((r) => r.round === "THIRD")!.matches, [103]);
  assert.equal(roundOfMatch(103), "THIRD");
  assert.equal(roundOfMatch(104), "FINAL");
});

test("the third-place round opens and locks on its own kickoff, independent of the final", () => {
  const rows: ActualKoRow[] = [
    { match_no: 103, home_team: "France", away_team: "England", kickoff_at: "2026-07-18T21:00:00Z", home_goals: null, away_goals: null, penalty_winner: null },
    { match_no: 104, home_team: "Spain", away_team: "Argentina", kickoff_at: "2026-07-19T19:00:00Z", home_goals: null, away_goals: null, penalty_winner: null },
  ];
  // Before the 3rd-place kickoff: both rounds open, each with its own deadline.
  const before = buildTourState(rows, [], Date.parse("2026-07-18T15:00:00Z"));
  const third = before.find((s) => s.round === "THIRD")!;
  const final = before.find((s) => s.round === "FINAL")!;
  assert.equal(third.status, "open");
  assert.equal(third.deadline, "2026-07-18T21:00:00Z");
  assert.equal(final.status, "open");
  assert.equal(final.deadline, "2026-07-19T19:00:00Z");
  // After the 3rd-place kickoff, THIRD locks but the final stays open.
  const after = buildTourState(rows, [], Date.parse("2026-07-18T21:00:01Z"));
  assert.equal(after.find((s) => s.round === "THIRD")!.status, "locked");
  assert.equal(after.find((s) => s.round === "FINAL")!.status, "open");
});

test("sanitizeTourPicks accepts a third-place pick in the THIRD round only", () => {
  const matchups = new Map([[103, { home: "France", away: "England" }]]);
  const ok = sanitizeTourPicks("THIRD", { "103": { h: 2, a: 2, pen: "England" } }, matchups);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.picks, [{ matchNo: 103, predHome: 2, predAway: 2, penaltyWinner: "England" }]);
  assert.match(sanitizeTourPicks("FINAL", { "103": { h: 1, a: 0 } }, matchups).error!, /not part of/i);
});
