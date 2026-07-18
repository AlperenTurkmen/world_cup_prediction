/**
 * normalizeMatches — the score shaper for the football-data.org feed.
 *
 * The fixtures mirror real v4 payloads observed live: `fullTime` is cumulative
 * through extra time, but for a shoot-out it also includes the penalty goals,
 * and `extraTime` holds only the ET-period goals (never a cumulative score).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMatches } from "./footballData";

function one(match: Parameters<typeof normalizeMatches>[0][number]) {
  return normalizeMatches([match])[0];
}

test("regular-time win uses fullTime as-is", () => {
  const m = one({
    stage: "LAST_32",
    status: "FINISHED",
    utcDate: "2026-06-29T17:00:00Z",
    homeTeam: { name: "Brazil" },
    awayTeam: { name: "Japan" },
    score: {
      winner: "HOME_TEAM",
      duration: "REGULAR",
      fullTime: { home: 2, away: 1 },
    },
  });
  assert.equal(m.homeGoals, 2);
  assert.equal(m.awayGoals, 1);
  assert.equal(m.winner, "HOME_TEAM");
});

test("extra-time win keeps fullTime (already cumulative through ET)", () => {
  // Belgium 3-2 Senegal a.e.t. — regularTime 2-2, ET period 1-0, fullTime 3-2.
  const m = one({
    stage: "LAST_32",
    status: "FINISHED",
    homeTeam: { name: "Belgium" },
    awayTeam: { name: "Senegal" },
    score: {
      winner: "HOME_TEAM",
      duration: "EXTRA_TIME",
      fullTime: { home: 3, away: 2 },
      regularTime: { home: 2, away: 2 },
      extraTime: { home: 1, away: 0 },
    },
  });
  assert.equal(m.homeGoals, 3);
  assert.equal(m.awayGoals, 2);
});

test("penalty shoot-out rebuilds the 120-minute score from period scores", () => {
  // Germany 1-1 Paraguay (3-4 pens) — the API's fullTime 4-5 includes pens.
  const m = one({
    stage: "LAST_32",
    status: "FINISHED",
    homeTeam: { name: "Germany" },
    awayTeam: { name: "Paraguay" },
    score: {
      winner: "AWAY_TEAM",
      duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 4, away: 5 },
      regularTime: { home: 1, away: 1 },
      extraTime: { home: 0, away: 0 },
      penalties: { home: 3, away: 4 },
    },
  });
  assert.equal(m.homeGoals, 1);
  assert.equal(m.awayGoals, 1);
  assert.equal(m.winner, "AWAY_TEAM");
});

test("goalless shoot-out game stays 0-0, not the penalty tally", () => {
  // Switzerland 0-0 Colombia (4-3 pens) — fullTime arrives as 4-3.
  const m = one({
    stage: "LAST_16",
    status: "FINISHED",
    homeTeam: { name: "Switzerland" },
    awayTeam: { name: "Colombia" },
    score: {
      winner: "HOME_TEAM",
      duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 4, away: 3 },
      regularTime: { home: 0, away: 0 },
      extraTime: { home: 0, away: 0 },
      penalties: { home: 4, away: 3 },
    },
  });
  assert.equal(m.homeGoals, 0);
  assert.equal(m.awayGoals, 0);
});

test("shoot-out without period scores falls back to fullTime minus penalties", () => {
  const m = one({
    stage: "FINAL",
    status: "FINISHED",
    homeTeam: { name: "Spain" },
    awayTeam: { name: "Argentina" },
    score: {
      winner: "HOME_TEAM",
      duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 6, away: 5 },
      penalties: { home: 4, away: 3 },
    },
  });
  assert.equal(m.homeGoals, 2);
  assert.equal(m.awayGoals, 2);
});

test("shoot-out with no way to split the score yields nulls, never a guess", () => {
  const m = one({
    stage: "FINAL",
    status: "FINISHED",
    homeTeam: { name: "Spain" },
    awayTeam: { name: "Argentina" },
    score: {
      winner: "HOME_TEAM",
      duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 6, away: 5 },
    },
  });
  assert.equal(m.homeGoals, null);
  assert.equal(m.awayGoals, null);
});

test("unplayed match yields null goals and kickoff passthrough", () => {
  const m = one({
    stage: "THIRD_PLACE",
    status: "TIMED",
    utcDate: "2026-07-18T21:00:00Z",
    homeTeam: { name: "France" },
    awayTeam: { name: "England" },
    score: {
      winner: null,
      duration: "REGULAR",
      fullTime: { home: null, away: null },
    },
  });
  assert.equal(m.homeGoals, null);
  assert.equal(m.awayGoals, null);
  assert.equal(m.kickoff, "2026-07-18T21:00:00Z");
  assert.equal(m.stage, "THIRD_PLACE");
});
