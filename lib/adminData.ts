import "server-only";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ADV_ROUNDS, type AdvRound } from "@/lib/rounds";

export { ADV_ROUNDS, type AdvRound };

/** A group fixture row with its (possibly unset) actual result. */
export interface MatchRow {
  id: number;
  match_no: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  home_goals: number | null;
  away_goals: number | null;
}

export interface AdminEntryRow {
  id: number;
  username: string;
  created_at: string;
  is_hidden: boolean;
  hidden_at: string | null;
}

export interface AdminLeagueRow {
  id: number;
  name: string;
  slug: string;
  visibility: string;
  owner_id: number;
  owner_username: string;
  member_count: number;
  is_hidden: boolean;
  hidden_at: string | null;
  created_at: string;
}

/**
 * The 72 group fixtures in chronological (kickoff) order — same order the admin
 * result screen and the league "start game" dropdown present them. match_no is
 * the tiebreak for games sharing a kickoff time (or with no kickoff set).
 */
export async function getMatches(): Promise<MatchRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("matches")
    .select("id, match_no, home_team, away_team, kickoff_at, home_goals, away_goals")
    .order("kickoff_at", { ascending: true, nullsFirst: false })
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

/**
 * The current tournament-wide start-game floor for the public board (the match
 * id stored in app_settings), or null when the whole tournament is scored.
 */
export async function getGlobalStartMatchId(): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("global_start_match_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.global_start_match_id ?? null) as number | null;
}

/** Entries shown in the admin moderation panel, including hidden ones. */
export async function getAdminEntries(): Promise<AdminEntryRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("entries")
    .select("id, username, created_at, is_hidden, hidden_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminEntryRow[];
}

/** Leagues shown in the admin moderation panel, including hidden ones. */
export async function getAdminLeagues(): Promise<AdminLeagueRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leagues")
    .select("id, name, slug, visibility, owner_id, is_hidden, hidden_at, created_at, owner:entries!leagues_owner_id_fkey(username), league_members(entry_id, status)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    visibility: row.visibility,
    owner_id: row.owner_id,
    owner_username: row.owner?.username ?? "Unknown",
    member_count: (row.league_members ?? []).filter((m: any) => m.status === "active").length,
    is_hidden: row.is_hidden,
    hidden_at: row.hidden_at,
    created_at: row.created_at,
  }));
}
