import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import GamesPanel, { type Match } from "./GamesPanel";
import LeaderboardTable, { type LeaderboardRow } from "./LeaderboardTable";

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
}

async function getPageData(): Promise<PageData> {
  try {
    const supabase = getSupabaseAdmin();

    const [board, results, matchesRes] = await Promise.all([
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
        .order("match_no", { ascending: true }),
    ]);

    if (board.error) {
      console.error("leaderboard query failed:", board.error);
      return { rows: [], resultsLogged: 0, error: true, matches: [] };
    }

    return {
      rows: (board.data ?? []) as LeaderboardRow[],
      resultsLogged: results.count ?? 0,
      error: false,
      matches: (matchesRes.data ?? []) as Match[],
    };
  } catch (err) {
    console.error("leaderboard load threw:", err);
    return { rows: [], resultsLogged: 0, error: true, matches: [] };
  }
}

export default async function HomePage() {
  const { rows, resultsLogged, error, matches } = await getPageData();
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
        </div>

        {/* ── Right: games panel ── */}
        {matches.length > 0 && <GamesPanel matches={matches} />}
      </div>
    </main>
  );
}
