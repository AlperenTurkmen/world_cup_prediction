"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { getTeamFlag } from "@/lib/flags";

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

interface BreakdownGame {
  matchNo: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
  homeGoals: number;
  awayGoals: number;
  predHome: number;
  predAway: number;
  points: number;
  isExact: boolean;
  isOutcome: boolean;
}

interface BreakdownState {
  loading: boolean;
  error: string | null;
  games: BreakdownGame[] | null;
}

type SortMode = "recent" | "points";

const INITIAL_GAMES = 5;
const EXPAND_STEP = 10;

/**
 * The shared leaderboard table, used by both the global board (app/page.tsx)
 * and per-league boards (app/leagues/[slug]). Ranking is the row order it
 * receives. Clicking a player expands an inline per-game breakdown of their
 * scored group matches; on a league board pass `leagueId` so the breakdown
 * respects that league's start-game cutoff.
 */
export default function LeaderboardTable({
  rows,
  leagueId,
}: {
  rows: LeaderboardRow[];
  leagueId?: number;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [cache, setCache] = useState<Record<number, BreakdownState>>({});
  const [sort, setSort] = useState<SortMode>("recent");
  const [visible, setVisible] = useState(INITIAL_GAMES);

  // Visible columns (incl. the sm-only ones) determine the expansion colSpan.
  const colSpan = 9;

  async function loadBreakdown(entryId: number) {
    setCache((c) => ({ ...c, [entryId]: { loading: true, error: null, games: null } }));
    try {
      const qs = new URLSearchParams({ entryId: String(entryId) });
      if (leagueId) qs.set("leagueId", String(leagueId));
      const res = await fetch(`/api/leaderboard/breakdown?${qs.toString()}`);
      const json = await res.json();
      if (json.ok) {
        setCache((c) => ({ ...c, [entryId]: { loading: false, error: null, games: json.games } }));
      } else {
        setCache((c) => ({
          ...c,
          [entryId]: { loading: false, error: json.error ?? "Could not load.", games: null },
        }));
      }
    } catch {
      setCache((c) => ({
        ...c,
        [entryId]: { loading: false, error: "Network error.", games: null },
      }));
    }
  }

  function toggleRow(entryId: number) {
    if (expandedId === entryId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entryId);
    setVisible(INITIAL_GAMES);
    if (!cache[entryId]) loadBreakdown(entryId);
  }

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
          {rows.map((row, i) => {
            const isExpanded = expandedId === row.entry_id;
            return (
              <FragmentRow
                key={row.entry_id}
                row={row}
                rank={i + 1}
                isExpanded={isExpanded}
                onToggle={() => toggleRow(row.entry_id)}
                colSpan={colSpan}
                state={cache[row.entry_id]}
                sort={sort}
                onSort={(s) => {
                  setSort(s);
                  setVisible(INITIAL_GAMES);
                }}
                visible={visible}
                onExtend={() => setVisible((v) => v + EXPAND_STEP)}
                onCollapse={() => setVisible(INITIAL_GAMES)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  row,
  rank,
  isExpanded,
  onToggle,
  colSpan,
  state,
  sort,
  onSort,
  visible,
  onExtend,
  onCollapse,
}: {
  row: LeaderboardRow;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
  colSpan: number;
  state: BreakdownState | undefined;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  visible: number;
  onExtend: () => void;
  onCollapse: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-black/5 last:border-0 transition-colors hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.04] ${
          isExpanded ? "bg-black/[0.03] dark:bg-white/[0.04]" : ""
        }`}
      >
        <td className="py-2 pr-3 tabular-nums opacity-60">{rank}</td>
        <td className="py-2 pr-3 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`text-[10px] opacity-40 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▶
            </span>
            <Link
              href={`/user/${row.username}`}
              className="hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.username}
            </Link>
          </span>
        </td>
        <td className="py-2 pr-3 opacity-80">{row.champion_pick ?? "—"}</td>
        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{row.total}</td>
        <td className="py-2 pr-3 text-right tabular-nums opacity-70">{row.played_count}</td>
        <td className="hidden py-2 pr-3 text-right tabular-nums opacity-70 sm:table-cell">{row.group_points}</td>
        <td className="hidden py-2 pr-3 text-right tabular-nums opacity-70 sm:table-cell">{row.ranking_points}</td>
        <td className="hidden py-2 pr-3 text-right tabular-nums opacity-70 sm:table-cell">{row.knockout_points}</td>
        <td className="hidden py-2 text-right tabular-nums opacity-70 sm:table-cell">{row.exact_count}</td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-black/5 dark:border-white/10">
          <td colSpan={colSpan} className="bg-black/[0.02] px-2 py-3 dark:bg-white/[0.02] sm:px-4">
            <Breakdown
              username={row.username}
              state={state}
              sort={sort}
              onSort={onSort}
              visible={visible}
              onExtend={onExtend}
              onCollapse={onCollapse}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function Breakdown({
  username,
  state,
  sort,
  onSort,
  visible,
  onExtend,
  onCollapse,
}: {
  username: string;
  state: BreakdownState | undefined;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  visible: number;
  onExtend: () => void;
  onCollapse: () => void;
}) {
  if (!state || state.loading) {
    return <p className="px-1 text-xs opacity-50">Loading {username}&apos;s games…</p>;
  }
  if (state.error) {
    return <p className="px-1 text-xs text-amber-600 dark:text-amber-400">{state.error}</p>;
  }
  const games = state.games ?? [];
  if (games.length === 0) {
    return <p className="px-1 text-xs opacity-50">No scored group games yet.</p>;
  }

  const sorted = [...games];
  if (sort === "points") {
    sorted.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : 0;
      const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : 0;
      return tb - ta;
    });
  }
  // "recent" is the API's default order; keep it.

  const shown = sorted.slice(0, visible);
  const remaining = sorted.length - shown.length;
  const isExpanded = visible > INITIAL_GAMES && sorted.length > INITIAL_GAMES;

  return (
    <div className="space-y-2">
      {/* Sort toggle */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] uppercase tracking-wide opacity-50">
          {games.length} scored game{games.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-1">
          <SortButton
            active={sort === "recent"}
            onClick={() => onSort("recent")}
            label="Sort by most recent"
            icon={<ClockIcon />}
          />
          <SortButton
            active={sort === "points"}
            onClick={() => onSort("points")}
            label="Sort by most points"
            icon={<TargetIcon />}
          />
        </div>
      </div>

      <ul className="space-y-0.5">
        {shown.map((g) => (
          <li
            key={g.matchNo}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs"
          >
            <span className="w-12 shrink-0 tabular-nums opacity-45">{formatDate(g.kickoffAt)}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span>{getTeamFlag(g.homeTeam)}</span>
              <span className="truncate">{g.homeTeam}</span>
              <span className="shrink-0 font-mono font-semibold tabular-nums">
                {g.homeGoals}–{g.awayGoals}
              </span>
              <span className="truncate">{g.awayTeam}</span>
              <span>{getTeamFlag(g.awayTeam)}</span>
            </span>
            <span className="shrink-0 tabular-nums opacity-50">
              pick {g.predHome}–{g.predAway}
            </span>
            <span className={`w-9 shrink-0 text-right font-semibold tabular-nums ${pointsColor(g)}`}>
              +{g.points}
            </span>
          </li>
        ))}
      </ul>

      {(remaining > 0 || isExpanded) && (
        <div className="flex items-center gap-3 px-1 pt-0.5">
          {remaining > 0 && (
            <button
              onClick={onExtend}
              className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Show {Math.min(EXPAND_STEP, remaining)} more
              <span className="opacity-50"> ({remaining} left)</span>
            </button>
          )}
          {isExpanded && (
            <button
              onClick={onCollapse}
              className="text-[11px] font-medium opacity-60 hover:underline"
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Green when the exact scoreline was nailed (the +8 perfect call), blue when the
 * outcome (winner/draw) was right, otherwise neutral/white — the points came
 * only from goal difference or a team's exact goals (or it's a 0).
 */
function pointsColor(g: BreakdownGame): string {
  if (g.isExact) return "text-green-600 dark:text-green-400";
  if (g.isOutcome) return "text-blue-600 dark:text-blue-400";
  return g.points > 0 ? "text-foreground" : "text-foreground/40";
}

function SortButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
        active
          ? "bg-black/10 text-foreground dark:bg-white/15"
          : "opacity-40 hover:opacity-80"
      }`}
    >
      {icon}
    </button>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

function formatDate(kickoff: string | null): string {
  if (!kickoff) return "—";
  const d = new Date(kickoff);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}
