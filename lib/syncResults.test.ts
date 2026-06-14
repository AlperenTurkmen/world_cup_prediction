/**
 * syncResults validation — the pure diff engine must: write only newly-finished
 * group results (swapping goals when the API's home/away orientation is reversed),
 * leave already-logged rows alone, flag unmappable matches as skipped, bucket
 * knockout participants into the right advancer rounds, and read the champion off
 * the finished final.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncResults, type ExistingMatch } from "./syncResults";
import type { NormalizedMatch } from "./footballData";

function gm(
  homeApi: string | null,
  awayApi: string | null,
  homeGoals: number | null,
  awayGoals: number | null,
  status = "FINISHED",
): NormalizedMatch {
  return { stage: "GROUP_STAGE", status, homeApi, awayApi, homeGoals, awayGoals, winner: null };
}

function ko(
  stage: NormalizedMatch["stage"],
  homeApi: string | null,
  awayApi: string | null,
  opts: Partial<NormalizedMatch> = {},
): NormalizedMatch {
  return {
    stage,
    status: "FINISHED",
    homeApi,
    awayApi,
    homeGoals: null,
    awayGoals: null,
    winner: null,
    ...opts,
  };
}

const CANON = new Set(["Spain", "Brazil", "IR Iran", "Rep. of Korea", "France", "Germany"]);

const FIXTURES: ExistingMatch[] = [
  { match_no: 1, home_team: "Spain", away_team: "Brazil", home_goals: null },
  { match_no: 2, home_team: "IR Iran", away_team: "Rep. of Korea", home_goals: null },
  { match_no: 3, home_team: "France", away_team: "Germany", home_goals: 1 }, // already logged
];

test("newly-finished group match yields one update with mapped names", () => {
  const diff = syncResults([gm("Spain", "Brazil", 2, 0)], FIXTURES, CANON);
  assert.deepEqual(diff.groupUpdates, [{ match_no: 1, home_goals: 2, away_goals: 0 }]);
  assert.deepEqual(diff.skipped, []);
});

test("reversed orientation swaps the goals to our home/away", () => {
  // API reports Brazil (home) 0 - 3 Spain (away); our fixture is Spain v Brazil.
  const diff = syncResults([gm("Brazil", "Spain", 0, 3)], FIXTURES, CANON);
  assert.deepEqual(diff.groupUpdates, [{ match_no: 1, home_goals: 3, away_goals: 0 }]);
});

test("name-map exceptions resolve (Iran / South Korea)", () => {
  const diff = syncResults([gm("Iran", "South Korea", 1, 1)], FIXTURES, CANON);
  assert.deepEqual(diff.groupUpdates, [{ match_no: 2, home_goals: 1, away_goals: 1 }]);
});

test("already-logged row is never overwritten", () => {
  const diff = syncResults([gm("France", "Germany", 4, 4)], FIXTURES, CANON);
  assert.deepEqual(diff.groupUpdates, []);
});

test("non-finished group matches are ignored", () => {
  const diff = syncResults([gm("Spain", "Brazil", null, null, "IN_PLAY")], FIXTURES, CANON);
  assert.deepEqual(diff.groupUpdates, []);
  assert.deepEqual(diff.skipped, []);
});

test("unknown team is reported as skipped, not coerced", () => {
  const diff = syncResults([gm("Atlantis", "Brazil", 1, 0)], FIXTURES, CANON);
  assert.deepEqual(diff.groupUpdates, []);
  assert.equal(diff.skipped.length, 1);
  assert.match(diff.skipped[0], /Unknown team/);
});

test("no seeded fixture for a finished pair is skipped", () => {
  const diff = syncResults([gm("Spain", "France", 1, 0)], FIXTURES, CANON);
  assert.deepEqual(diff.groupUpdates, []);
  assert.match(diff.skipped[0], /No seeded fixture/);
});

test("knockout participants bucket into the right rounds", () => {
  const matches = [
    ko("LAST_32", "Spain", "Brazil"),
    ko("LAST_16", "Spain", "France"),
    ko("QUARTER_FINALS", "Spain", "Germany"),
    ko("SEMI_FINALS", "Spain", "IR Iran"),
  ];
  const diff = syncResults(matches, FIXTURES, CANON);
  assert.deepEqual(diff.advancers.R32.sort(), ["Brazil", "Spain"]);
  assert.deepEqual(diff.advancers.R16.sort(), ["France", "Spain"]);
  assert.deepEqual(diff.advancers.QF.sort(), ["Germany", "Spain"]);
  assert.deepEqual(diff.advancers.SF.sort(), ["IR Iran", "Spain"]);
});

test("finished final yields FINAL advancers and the champion", () => {
  const final = ko("FINAL", "Spain", "France", { winner: "HOME_TEAM", homeGoals: 1, awayGoals: 0 });
  const diff = syncResults([final], FIXTURES, CANON);
  assert.deepEqual(diff.advancers.FINAL.sort(), ["France", "Spain"]);
  assert.deepEqual(diff.advancers.CHAMPION, ["Spain"]);
});

test("pre-draw knockout slots (null teams) add nobody", () => {
  const diff = syncResults([ko("LAST_16", null, null)], FIXTURES, CANON);
  assert.deepEqual(diff.advancers.R16, []);
});

test("THIRD_PLACE is ignored", () => {
  const diff = syncResults([ko("THIRD_PLACE", "France", "Germany", { winner: "HOME_TEAM" })], FIXTURES, CANON);
  for (const r of Object.values(diff.advancers)) assert.deepEqual(r, []);
});
