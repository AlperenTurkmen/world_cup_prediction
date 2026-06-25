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
import { buildTourState, sanitizeTourPicks, type ActualKoRow, type TourPick } from "./tours";

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
