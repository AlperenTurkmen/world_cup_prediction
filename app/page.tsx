import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// The leaderboard is computed live from the view; never cache it.
export const dynamic = "force-dynamic";

const TOTAL_GROUP_MATCHES = 72;

interface LeaderboardRow {
  entry_id: number;
  username: string;
  champion_pick: string | null;
  group_points: number;
  bonus_points: number;
  total: number;
  exact_count: number;
  created_at: string;
}

interface LeaderboardData {
  rows: LeaderboardRow[];
  resultsLogged: number;
  error: boolean;
}

async function getLeaderboard(): Promise<LeaderboardData> {
  try {
    const supabase = getSupabaseAdmin();

    const [board, results] = await Promise.all([
      supabase
        .from("leaderboard")
        .select("*")
        .order("total", { ascending: false })
        .order("exact_count", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("matches")
        .select("match_no", { count: "exact", head: true })
        .not("home_goals", "is", null)
        .not("away_goals", "is", null),
    ]);

    if (board.error) {
      console.error("leaderboard query failed:", board.error);
      return { rows: [], resultsLogged: 0, error: true };
    }

    return {
      rows: (board.data ?? []) as LeaderboardRow[],
      resultsLogged: results.count ?? 0,
      error: false,
    };
  } catch (err) {
    console.error("leaderboard load threw:", err);
    return { rows: [], resultsLogged: 0, error: true };
  }
}

export default async function HomePage() {
  const { rows, resultsLogged, error } = await getLeaderboard();
  const updatedAt = new Date().toUTCString();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">World Cup 2026 Leaderboard</h1>
        <Link href="/upload" className="text-sm font-medium underline whitespace-nowrap">
          Upload entry →
        </Link>
      </div>

      {error ? (
        <div className="mt-8 rounded-md border border-red-600/30 bg-red-600/10 p-4 text-sm text-red-700 dark:text-red-300">
          The leaderboard is temporarily unavailable. Please try again shortly.
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-black/10 p-6 text-sm opacity-70 dark:border-white/15">
          No entries yet. Be the first to{" "}
          <Link href="/upload" className="font-medium underline">
            upload your predictions
          </Link>
          .
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm opacity-70">
            Results logged: <strong>{resultsLogged}</strong> / {TOTAL_GROUP_MATCHES} group games
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/15 text-left dark:border-white/20">
                  <th className="py-2 pr-3 font-semibold">#</th>
                  <th className="py-2 pr-3 font-semibold">Player</th>
                  <th className="py-2 pr-3 font-semibold">Champion pick</th>
                  <th className="py-2 pr-3 text-right font-semibold">Total</th>
                  <th className="py-2 pr-3 text-right font-semibold tabular-nums">Group</th>
                  <th className="py-2 pr-3 text-right font-semibold tabular-nums">Bonus</th>
                  <th className="py-2 text-right font-semibold tabular-nums">Exact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.entry_id}
                    className="border-b border-black/5 last:border-0 dark:border-white/10"
                  >
                    <td className="py-2 pr-3 tabular-nums opacity-60">{i + 1}</td>
                    <td className="py-2 pr-3 font-medium">{row.username}</td>
                    <td className="py-2 pr-3 opacity-80">{row.champion_pick ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{row.total}</td>
                    <td className="py-2 pr-3 text-right tabular-nums opacity-70">{row.group_points}</td>
                    <td className="py-2 pr-3 text-right tabular-nums opacity-70">{row.bonus_points}</td>
                    <td className="py-2 text-right tabular-nums opacity-70">{row.exact_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs opacity-50">Last updated {updatedAt}</p>
        </>
      )}
    </main>
  );
}
