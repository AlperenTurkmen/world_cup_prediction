import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import GamesPanel, { type Match } from "./GamesPanel";
import LeaderboardTable, { type LeaderboardRow } from "./LeaderboardTable";
import ScoringInfo, {
  DEFAULT_ROUND_WEIGHTS,
  DEFAULT_SCORING_WEIGHTS,
  type RoundWeights,
  type ScoringWeights,
} from "./ScoringInfo";

// The leaderboard is computed live from the view; never cache it.
export const dynamic = "force-dynamic";

const TOTAL_GROUP_MATCHES = 72;

interface LeaderboardData {
  rows: LeaderboardRow[];
  resultsLogged: number;
  error: boolean;
}

interface PageData extends LeaderboardData {
  matches: Match[];
  scoringWeights: ScoringWeights;
  roundWeights: RoundWeights;
}

async function getPageData(): Promise<PageData> {
  try {
    const supabase = getSupabaseAdmin();

    const [board, results, matchesRes, knockoutMatchesRes, teamGroupsRes, scoringRes, roundsRes] = await Promise.all([
      supabase
        .from("leaderboard")
        .select("*")
        .order("total", { ascending: false })
        .order("exact_count", { ascending: false })
        .order("champion_correct", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("matches")
        .select("match_no", { count: "exact", head: true })
        .not("home_goals", "is", null)
        .not("away_goals", "is", null),
      supabase
        .from("matches")
        .select("id, match_no, home_team, away_team, kickoff_at, home_goals, away_goals")
        .order("kickoff_at", { ascending: true, nullsFirst: false })
        .order("match_no", { ascending: true }),
      supabase
        .from("actual_knockout_matches")
        .select("match_no, home_team, away_team, kickoff_at, home_goals, away_goals")
        .order("match_no", { ascending: true }),
      supabase
        .from("team_groups")
        .select("team, group_letter"),
      supabase.from("scoring_weights").select("key, value"),
      supabase.from("round_weights").select("round, weight"),
    ]);

    if (board.error) {
      console.error("leaderboard query failed:", board.error);
      return {
        rows: [],
        resultsLogged: 0,
        error: true,
        matches: [],
        scoringWeights: DEFAULT_SCORING_WEIGHTS,
        roundWeights: DEFAULT_ROUND_WEIGHTS,
      };
    }

    const groupByTeam = new Map(
      (teamGroupsRes.data ?? []).map((r) => [r.team, r.group_letter as string])
    );
    const groupMatches = (matchesRes.data ?? []).map((m) => ({
      ...m,
      group_letter: groupByTeam.get(m.home_team) ?? null,
      is_knockout: false,
    }));
    const knockoutMatches = (knockoutMatchesRes.data ?? [])
      .filter((m) => m.home_team && m.away_team)
      .map((m) => ({
        id: m.match_no + 100000,
        match_no: m.match_no,
        home_team: m.home_team!,
        away_team: m.away_team!,
        kickoff_at: m.kickoff_at,
        home_goals: m.home_goals,
        away_goals: m.away_goals,
        group_letter: null,
        is_knockout: true,
      }));
    const matches = [
      ...groupMatches,
      ...knockoutMatches,
    ].sort((a, b) => {
      if (!a.kickoff_at && !b.kickoff_at) return a.match_no - b.match_no;
      if (!a.kickoff_at) return 1;
      if (!b.kickoff_at) return -1;
      const ta = new Date(a.kickoff_at).getTime();
      const tb = new Date(b.kickoff_at).getTime();
      if (ta !== tb) return ta - tb;
      return a.match_no - b.match_no;
    }) as Match[];

    // Merge live weights over the defaults so the guide always matches the view.
    const scoringWeights = { ...DEFAULT_SCORING_WEIGHTS };
    for (const r of scoringRes.data ?? []) {
      if (r.key in scoringWeights) scoringWeights[r.key as keyof ScoringWeights] = r.value as number;
    }
    const roundWeights = { ...DEFAULT_ROUND_WEIGHTS };
    for (const r of roundsRes.data ?? []) {
      if (r.round in roundWeights) roundWeights[r.round as keyof RoundWeights] = r.weight as number;
    }

    return {
      rows: (board.data ?? []) as LeaderboardRow[],
      resultsLogged: results.count ?? 0,
      error: false,
      matches,
      scoringWeights,
      roundWeights,
    };
  } catch (err) {
    console.error("leaderboard load threw:", err);
    return {
      rows: [],
      resultsLogged: 0,
      error: true,
      matches: [],
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
      roundWeights: DEFAULT_ROUND_WEIGHTS,
    };
  }
}

export default async function HomePage() {
  const { rows, resultsLogged, error, matches, scoringWeights, roundWeights } = await getPageData();
  const updatedAt = new Date().toUTCString();

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-2xl font-bold">World Cup 2026 Leaderboard</h1>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        {/* ── Left: leaderboard ── */}
        <div>
          {error ? (
            <div className="rounded-md border border-red-600/30 bg-red-600/10 p-4 text-sm text-red-700 dark:text-red-300">
              The leaderboard is temporarily unavailable. Please try again shortly.
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-black/10 p-6 text-sm opacity-70 dark:border-white/15">
              No entries yet. Be the first to{" "}
              <Link href="/upload" className="font-medium underline">
                upload your predictions
              </Link>
              .
            </div>
          ) : (
            <>
              <p className="text-sm opacity-70">
                Results logged: <strong>{resultsLogged}</strong> / {TOTAL_GROUP_MATCHES} group games
              </p>

              <LeaderboardTable rows={rows} />

              <p className="mt-4 text-xs opacity-50">Last updated {updatedAt}</p>
            </>
          )}

          <ScoringInfo weights={scoringWeights} rounds={roundWeights} />
        </div>

        {/* ── Right: games panel ── */}
        {matches.length > 0 && <GamesPanel matches={matches} />}
      </div>
    </main>
  );
}
