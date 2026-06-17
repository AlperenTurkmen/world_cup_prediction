import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreGroupMatch } from "./groupMatchScore";

// The worked examples from docs/SCORING_DESIGN.md §3 (default weights). Each row
// is [predHome, predAway, actualHome, actualAway, expectedPoints, isExact, isOutcome].
const cases: Array<[number, number, number, number, number, boolean, boolean]> = [
  [2, 1, 2, 1, 8, true, true], // perfect
  [2, 1, 3, 2, 3, false, true], // right winner + margin, wrong goals
  [2, 0, 1, 0, 3, false, true], // right winner, nailed away clean sheet
  [1, 0, 3, 1, 2, false, true], // right winner only (margin differs, no goals nailed)
  [1, 1, 2, 2, 3, false, true], // called the draw + (zero) margin
  [1, 1, 1, 1, 8, true, true], // perfect draw
  [0, 2, 0, 1, 3, false, true], // right away win, nailed home blank
  [2, 1, 0, 2, 0, false, false], // wrong on every axis
  [2, 1, 1, 2, 0, false, false], // right teams scoring, wrong winner — still 0
];

test("scoreGroupMatch matches the SCORING_DESIGN worked examples", () => {
  for (const [ph, pa, ah, aa, pts, exact, outcome] of cases) {
    const s = scoreGroupMatch(ph, pa, ah, aa);
    assert.equal(s.points, pts, `points for ${ph}-${pa} vs ${ah}-${aa}`);
    assert.equal(s.isExact, exact, `isExact for ${ph}-${pa} vs ${ah}-${aa}`);
    assert.equal(s.isOutcome, outcome, `isOutcome for ${ph}-${pa} vs ${ah}-${aa}`);
  }
});

test("partial credit without a correct outcome (white in the UI)", () => {
  // actual 2-0, predict 2-3: home goals nailed (2==2) → +1 team-goals, but the
  // predicted away win is the wrong outcome → not exact, not outcome.
  const s = scoreGroupMatch(2, 3, 2, 0);
  assert.equal(s.points, 1);
  assert.equal(s.isExact, false);
  assert.equal(s.isOutcome, false);
});

test("weights are honoured", () => {
  const s = scoreGroupMatch(2, 1, 2, 1, {
    W_OUTCOME: 10,
    W_GOALDIFF: 0,
    W_TEAMGOALS: 0,
    W_EXACT: 0,
  });
  assert.equal(s.points, 10); // only the outcome axis is weighted
});
