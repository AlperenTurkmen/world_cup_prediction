/**
 * Pure sync logic: turn football-data.org matches into the writes our DB needs.
 *
 * No network or DB access here (mirrors lib/deriveBracket.ts), so it's fully
 * unit-testable. The route in app/api/sync/route.ts feeds it live data and
 * applies the resulting diff via the same write paths the admin forms use.
 */
import { ADV_ROUNDS, type AdvRound } from "./rounds";
import type { NormalizedMatch } from "./footballData";
import { resolveCanonical } from "./teamNameMap";

/** A seeded group fixture with its (possibly unset) actual result. */
export interface ExistingMatch {
  match_no: number;
  home_team: string; // canonical
  away_team: string; // canonical
  home_goals: number | null;
}

export interface SyncDiff {
  /** Group results to write — only for fixtures not already logged. */
  groupUpdates: { match_no: number; home_goals: number; away_goals: number }[];
  /** Full set of teams that reached each round, ready for replace_actual_advancers. */
  advancers: Record<AdvRound, string[]>;
  /** Human-readable notes for matches that couldn't be applied (unknown team, no fixture). */
  skipped: string[];
}

/** football-data.org stage → our advancement round. THIRD_PLACE is intentionally ignored. */
const STAGE_TO_ROUND: Record<string, AdvRound> = {
  LAST_32: "R32",
  LAST_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  FINAL: "FINAL",
};

function emptyAdvancers(): Record<AdvRound, string[]> {
  const out = {} as Record<AdvRound, string[]>;
  for (const r of ADV_ROUNDS) out[r] = [];
  return out;
}

export function syncResults(
  apiMatches: NormalizedMatch[],
  existing: ExistingMatch[],
  canonical: Set<string>,
): SyncDiff {
  const groupUpdates: SyncDiff["groupUpdates"] = [];
  const skipped: string[] = [];

  // Index existing fixtures by ordered canonical pair for O(1) lookup.
  const byPair = new Map<string, ExistingMatch>();
  for (const m of existing) byPair.set(`${m.home_team}|${m.away_team}`, m);

  // Track reached-round sets; a team that plays in a stage reached that round.
  const reached = {} as Record<AdvRound, Set<string>>;
  for (const r of ADV_ROUNDS) reached[r] = new Set<string>();

  for (const m of apiMatches) {
    const home = resolveCanonical(m.homeApi, canonical);
    const away = resolveCanonical(m.awayApi, canonical);

    if (m.stage === "GROUP_STAGE") {
      if (m.status !== "FINISHED") continue;
      const label = `${m.homeApi ?? "?"} vs ${m.awayApi ?? "?"}`;
      if (!home || !away) {
        skipped.push(`Unknown team in group match (${label}).`);
        continue;
      }
      if (m.homeGoals === null || m.awayGoals === null) {
        skipped.push(`Missing score for finished group match (${label}).`);
        continue;
      }
      // Our seed fixes home/away orientation; match it, swapping goals if reversed.
      const fwd = byPair.get(`${home}|${away}`);
      const rev = byPair.get(`${away}|${home}`);
      const row = fwd ?? rev;
      if (!row) {
        skipped.push(`No seeded fixture for ${home} vs ${away}.`);
        continue;
      }
      if (row.home_goals !== null) continue; // already logged — leave manual results alone
      const [hg, ag] = fwd ? [m.homeGoals, m.awayGoals] : [m.awayGoals, m.homeGoals];
      groupUpdates.push({ match_no: row.match_no, home_goals: hg, away_goals: ag });
      continue;
    }

    // Knockout stages: collect the teams that reached each round.
    const round = STAGE_TO_ROUND[m.stage];
    if (!round) continue; // GROUP_STAGE handled above; THIRD_PLACE/unknown ignored
    if (home) reached[round].add(home);
    if (away) reached[round].add(away);

    // Champion = winner of the finished final.
    if (m.stage === "FINAL" && m.status === "FINISHED") {
      const champ =
        m.winner === "HOME_TEAM" ? home : m.winner === "AWAY_TEAM" ? away : null;
      if (champ) reached.CHAMPION.add(champ);
    }
  }

  const advancers = emptyAdvancers();
  for (const r of ADV_ROUNDS) advancers[r] = [...reached[r]].sort();

  return { groupUpdates, advancers, skipped };
}
