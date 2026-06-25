/**
 * Per-round knockout "tours" — the second round of guessing.
 *
 * After the group stage, each knockout round opens a fresh prediction window: once
 * the real matchups for a round are known, users predict every game's scoreline,
 * editable until that round's FIRST kickoff (the whole round locks together, as the
 * owner specified — "until the day the first game of the round starts"). The
 * scoreline is scored A-style, flat max 8 per game (leaderboard dimension F), plus
 * the pre-tournament foresight bonus handled in SQL.
 *
 * This module is neutral (no DB, no `server-only`) so the API route, the tour UI,
 * and tests all share the round metadata, the pure state builder, and the pick
 * sanitizer. Round structure (which match numbers belong to each round) is reused
 * from lib/deriveBracket so there is one source of truth.
 */
import { KNOCKOUT_ROUNDS, PICKABLE_KO_MATCHES } from "./deriveBracket";
import type { AdvRound } from "./rounds";

export const MAX_TOUR_GOALS = 20;

/** Round → its scored match numbers and a display label (R32..FINAL; no 103). */
export const TOUR_ROUNDS = KNOCKOUT_ROUNDS;

/** An actual_knockout_matches row (matchup + kickoff + result), as the API reads it. */
export interface ActualKoRow {
  match_no: number;
  home_team: string | null;
  away_team: string | null;
  kickoff_at: string | null;
  home_goals: number | null;
  away_goals: number | null;
  penalty_winner: string | null;
}

/** A player's saved tour pick for one knockout match. */
export interface TourPick {
  match_no: number;
  pred_home: number;
  pred_away: number;
  penalty_winner: string | null;
}

/** One knockout game in a round, as presented to the player. */
export interface TourMatch {
  matchNo: number;
  home: string | null;
  away: string | null;
  kickoffAt: string | null;
  /** Actual result, once logged (else null). */
  homeGoals: number | null;
  awayGoals: number | null;
  penaltyWinner: string | null;
  /** The player's current pick for this game, or null if none saved. */
  pick: { predHome: number; predAway: number; penaltyWinner: string | null } | null;
  /** True when the matchup is known and the round hasn't locked — i.e. predictable now. */
  editable: boolean;
}

/**
 * A round's state:
 *  - "pending": no matchup in the round is known yet (earlier rounds still playing).
 *  - "open":    at least one matchup is known and the round hasn't locked — predict now.
 *  - "locked":  the round's first kickoff has passed; picks are frozen.
 */
export type TourRoundStatus = "pending" | "open" | "locked";

export interface TourRoundState {
  round: AdvRound;
  label: string;
  /** ISO of the round's first kickoff (the deadline), or null if unseeded. */
  deadline: string | null;
  status: TourRoundStatus;
  matches: TourMatch[];
}

const PICKABLE = new Set(PICKABLE_KO_MATCHES);

/** The round a scored knockout match belongs to (null for 103 / non-knockout). */
export function roundOfMatch(matchNo: number): AdvRound | null {
  for (const r of TOUR_ROUNDS) if (r.matches.includes(matchNo)) return r.round;
  return null;
}

/**
 * Build the full per-round tour state from the actual knockout rows and the
 * player's saved picks, as of `nowMs`. Pure — the route supplies the data.
 */
export function buildTourState(
  rows: ActualKoRow[],
  picks: TourPick[],
  nowMs: number,
): TourRoundState[] {
  const rowByNo = new Map(rows.map((r) => [r.match_no, r]));
  const pickByNo = new Map(picks.map((p) => [p.match_no, p]));

  return TOUR_ROUNDS.map((rdef) => {
    // Deadline = the earliest kickoff among the round's games (all lock together).
    let deadlineMs: number | null = null;
    let deadlineIso: string | null = null;
    for (const no of rdef.matches) {
      const k = rowByNo.get(no)?.kickoff_at;
      if (!k) continue;
      const ms = new Date(k).getTime();
      if (deadlineMs === null || ms < deadlineMs) {
        deadlineMs = ms;
        deadlineIso = k;
      }
    }
    const locked = deadlineMs !== null && nowMs >= deadlineMs;

    let anyKnown = false;
    const matches: TourMatch[] = rdef.matches.map((no) => {
      const row = rowByNo.get(no);
      const home = row?.home_team ?? null;
      const away = row?.away_team ?? null;
      const known = !!home && !!away;
      if (known) anyKnown = true;
      const pick = pickByNo.get(no);
      return {
        matchNo: no,
        home,
        away,
        kickoffAt: row?.kickoff_at ?? null,
        homeGoals: row?.home_goals ?? null,
        awayGoals: row?.away_goals ?? null,
        penaltyWinner: row?.penalty_winner ?? null,
        pick: pick
          ? { predHome: pick.pred_home, predAway: pick.pred_away, penaltyWinner: pick.penalty_winner }
          : null,
        editable: known && !locked,
      };
    });

    const status: TourRoundStatus = locked ? "locked" : anyKnown ? "open" : "pending";
    return { round: rdef.round, label: rdef.label, deadline: deadlineIso, status, matches };
  });
}

/** A sanitized, ready-to-store tour pick (after server-side validation). */
export interface CleanTourPick {
  matchNo: number;
  predHome: number;
  predAway: number;
  penaltyWinner: string | null;
}

function isGoal(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_TOUR_GOALS;
}

/**
 * Validate a raw picks payload for one round against the round's known matchups.
 * Returns the clean picks plus any rejection reason. A level score requires a
 * penalty winner that is one of the two actual teams; a decisive score drops it.
 */
export function sanitizeTourPicks(
  round: AdvRound,
  raw: unknown,
  matchupOf: Map<number, { home: string; away: string }>,
): { picks: CleanTourPick[]; error: string | null } {
  if (!raw || typeof raw !== "object") return { picks: [], error: "Expected a picks object." };
  const out: CleanTourPick[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const matchNo = Number(key);
    if (!PICKABLE.has(matchNo) || roundOfMatch(matchNo) !== round) {
      return { picks: [], error: `Match ${key} is not part of the ${round} round.` };
    }
    const matchup = matchupOf.get(matchNo);
    if (!matchup) return { picks: [], error: `Match ${key} has no known matchup yet.` };
    if (!value || typeof value !== "object") return { picks: [], error: `Match ${key} is malformed.` };
    const { h, a, pen } = value as { h?: unknown; a?: unknown; pen?: unknown };
    if (!isGoal(h) || !isGoal(a)) return { picks: [], error: `Match ${key} has an invalid score.` };

    let penaltyWinner: string | null = null;
    if (h === a) {
      // Knockout games can't end level — a draw needs a shoot-out winner.
      if (typeof pen !== "string" || (pen !== matchup.home && pen !== matchup.away)) {
        return { picks: [], error: `Pick the penalty-shootout winner for match ${key}.` };
      }
      penaltyWinner = pen;
    }
    out.push({ matchNo, predHome: h, predAway: a, penaltyWinner });
  }
  return { picks: out, error: null };
}
