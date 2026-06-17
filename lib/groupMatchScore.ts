/**
 * Dimension-A group-match scoring (SCORING_DESIGN.md §3), as a pure function so
 * the SQL leaderboard and any UI breakdown agree on the per-match points.
 *
 * The axes STACK (they are not mutually exclusive):
 *   points = W_OUTCOME·T + W_GOALDIFF·D + W_TEAMGOALS·(Hh + Aa) + W_EXACT·E
 * where T=correct outcome, D=correct margin, Hh/Aa=each team's exact goals,
 * E=exact scoreline. With default weights the max is 8 (a perfect scoreline).
 *
 * This module is pure (no `server-only`) so it can be shared and unit-tested.
 * It does NOT apply fairness gating (eligibility / late-entry / league cutoff) —
 * callers decide whether a match counts before asking for its points.
 */

export interface ScoringWeights {
  W_OUTCOME: number;
  W_GOALDIFF: number;
  W_TEAMGOALS: number;
  W_EXACT: number;
}

export const DEFAULT_MATCH_WEIGHTS: ScoringWeights = {
  W_OUTCOME: 2,
  W_GOALDIFF: 1,
  W_TEAMGOALS: 1,
  W_EXACT: 3,
};

export interface MatchScore {
  /** Total points earned for this scoreline under the given weights. */
  points: number;
  /** Exact scoreline — both teams' goals nailed. (Green in the UI.) */
  isExact: boolean;
  /** Correct outcome (win/draw/loss direction). (Blue when not exact.) */
  isOutcome: boolean;
}

/**
 * Score a single predicted scoreline against the actual result. The caller must
 * have a real result for the match; pass the four goal counts.
 */
export function scoreGroupMatch(
  predHome: number,
  predAway: number,
  actualHome: number,
  actualAway: number,
  weights: ScoringWeights = DEFAULT_MATCH_WEIGHTS
): MatchScore {
  const T = Math.sign(predHome - predAway) === Math.sign(actualHome - actualAway);
  const D = predHome - predAway === actualHome - actualAway;
  const Hh = predHome === actualHome;
  const Aa = predAway === actualAway;
  const E = Hh && Aa;

  const points =
    weights.W_OUTCOME * (T ? 1 : 0) +
    weights.W_GOALDIFF * (D ? 1 : 0) +
    weights.W_TEAMGOALS * ((Hh ? 1 : 0) + (Aa ? 1 : 0)) +
    weights.W_EXACT * (E ? 1 : 0);

  return { points, isExact: E, isOutcome: T };
}
