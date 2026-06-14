import Link from "next/link";

export interface LeaderboardRow {
  entry_id: number;
  username: string;
  champion_pick: string | null;
  group_points: number;
  ranking_points: number;
  knockout_points: number;
  total: number;
  exact_count: number;
  played_count: number;
  champion_correct: number;
  created_at: string;
}

/**
 * The shared leaderboard table, used by both the global board (app/page.tsx)
 * and per-league boards (app/leagues/[slug]). Pure presentation: ranking is
 * the row order it receives.
 */
export default function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/15 text-left dark:border-white/20">
            <th className="py-2 pr-3 font-semibold">#</th>
            <th className="py-2 pr-3 font-semibold">Player</th>
            <th className="py-2 pr-3 font-semibold">Champion pick</th>
            <th className="py-2 pr-3 text-right font-semibold">Total</th>
            <th className="py-2 pr-3 text-right font-semibold tabular-nums" title="Predictions played and counted toward scoring">Played</th>
            <th className="hidden py-2 pr-3 text-right font-semibold tabular-nums sm:table-cell">Group</th>
            <th className="hidden py-2 pr-3 text-right font-semibold tabular-nums sm:table-cell">Ranking</th>
            <th className="hidden py-2 pr-3 text-right font-semibold tabular-nums sm:table-cell">Knockout</th>
            <th className="hidden py-2 text-right font-semibold tabular-nums sm:table-cell">Exact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.entry_id}
              className="border-b border-black/5 last:border-0 dark:border-white/10"
            >
              <td className="py-2 pr-3 tabular-nums opacity-60">{i + 1}</td>
              <td className="py-2 pr-3 font-medium">
                <Link href={`/user/${row.username}`} className="hover:underline">
                  {row.username}
                </Link>
              </td>
              <td className="py-2 pr-3 opacity-80">{row.champion_pick ?? "—"}</td>
              <td className="py-2 pr-3 text-right font-semibold tabular-nums">{row.total}</td>
              <td className="py-2 pr-3 text-right tabular-nums opacity-70">{row.played_count}</td>
              <td className="hidden py-2 pr-3 text-right tabular-nums opacity-70 sm:table-cell">{row.group_points}</td>
              <td className="hidden py-2 pr-3 text-right tabular-nums opacity-70 sm:table-cell">{row.ranking_points}</td>
              <td className="hidden py-2 pr-3 text-right tabular-nums opacity-70 sm:table-cell">{row.knockout_points}</td>
              <td className="hidden py-2 text-right tabular-nums opacity-70 sm:table-cell">{row.exact_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
