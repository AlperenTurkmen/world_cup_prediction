import "server-only";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ADV_ROUNDS, type AdvRound } from "@/lib/rounds";

export { ADV_ROUNDS, type AdvRound };

/** A group fixture row with its (possibly unset) actual result. */
export interface MatchRow {
  match_no: number;
  home_team: string;
  away_team: string;
  home_goals: number | null;
  away_goals: number | null;
}

/** The 72 group fixtures ordered by match number. */
export async function getMatches(): Promise<MatchRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("matches")
    .select("match_no, home_team, away_team, home_goals, away_goals")
    .order("match_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchRow[];
}

/**
 * The canonical 48-team list, derived from the seeded `matches` table (every
 * team appears across the 72 group fixtures). Sorted for stable display.
 */
export async function getCanonicalTeams(): Promise<string[]> {
  const matches = await getMatches();
  const teams = new Set<string>();
  for (const m of matches) {
    teams.add(m.home_team);
    teams.add(m.away_team);
  }
  return [...teams].sort((a, b) => a.localeCompare(b));
}

/** Current actual advancers, grouped by round. */
export async function getActualAdvancers(): Promise<Record<AdvRound, string[]>> {
  const { data, error } = await getSupabaseAdmin()
    .from("actual_advancers")
    .select("round, team");
  if (error) throw new Error(error.message);

  const result: Record<AdvRound, string[]> = {
    R32: [],
    R16: [],
    QF: [],
    SF: [],
    FINAL: [],
    CHAMPION: [],
  };
  for (const row of (data ?? []) as { round: AdvRound; team: string }[]) {
    if (row.round in result) result[row.round].push(row.team);
  }
  return result;
}
