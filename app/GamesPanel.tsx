"use client";

import { useState, useEffect, useRef } from "react";
import { getTeamFlag } from "@/lib/flags";

export interface Match {
  id: number;
  match_no: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  home_goals: number | null;
  away_goals: number | null;
  group_letter?: string | null;
  is_knockout?: boolean;
}

function getKnockoutRoundLabel(match_no: number): string {
  if (match_no >= 73 && match_no <= 88) return "R32";
  if (match_no >= 89 && match_no <= 96) return "R16";
  if (match_no >= 97 && match_no <= 100) return "QF";
  if (match_no >= 101 && match_no <= 102) return "SF";
  if (match_no === 103) return "3rd Place";
  if (match_no === 104) return "Final";
  return "";
}

function formatKickoff(kickoff_at: string | null, match: Pick<Match, "group_letter" | "is_knockout" | "match_no">): string {
  const parts: string[] = [];
  if (kickoff_at) {
    const d = new Date(kickoff_at);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    parts.push(`${day}/${month}`);
    if (h !== 0 || m !== 0) {
      parts.push(` ${String(h).padStart(2, "0")}.${String(m).padStart(2, "0")}`);
    }
  }
  if (match.is_knockout) {
    parts.push(` ${getKnockoutRoundLabel(match.match_no)}`);
  } else if (match.group_letter) {
    parts.push(` Group ${match.group_letter}`);
  }
  return parts.join("") || "—";
}

interface Prediction {
  username: string;
  predHome: number;
  predAway: number;
  isFollowed?: boolean;
}

interface PredictionsData {
  myPrediction: Prediction | null;
  predictions: Prediction[];
}

// How many other players to reveal per "Show more" step.
const PAGE_SIZE = 10;

export default function GamesPanel({ matches }: { matches: Match[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preds, setPreds] = useState<PredictionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [predError, setPredError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);
  const matchElsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    const target = matches.find((m) => m.kickoff_at?.startsWith(yStr));
    if (!target) return;
    const el = matchElsRef.current.get(target.id);
    if (!el) return;
    container.scrollTop = el.offsetTop - container.offsetTop;
  }, []);

  async function handleClick(match: Match) {
    if (selectedId === match.id) {
      setSelectedId(null);
      setPreds(null);
      return;
    }
    setSelectedId(match.id);
    setPreds(null);
    setPredError(null);
    setVisibleCount(PAGE_SIZE);
    setLoading(true);
    try {
      const param = match.is_knockout
        ? `matchNo=${match.match_no}`
        : `matchId=${match.id}`;
      const res = await fetch(`/api/user/followed-predictions?${param}`);
      const json = await res.json();
      if (!json.ok) {
        setPredError(json.error ?? "Could not load predictions.");
      } else {
        setPreds({ myPrediction: json.myPrediction, predictions: json.predictions });
      }
    } catch {
      setPredError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const selectedMatch = matches.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 overflow-hidden">
      <div className="px-4 py-3 border-b border-black/10 dark:border-white/15">
        <h2 className="font-semibold text-sm">All Matches</h2>
        <p className="text-xs opacity-50 mt-0.5">Click a match to see picks</p>
      </div>

      <div ref={containerRef} className="divide-y divide-black/5 dark:divide-white/10 overflow-y-auto max-h-[min(72vh,640px)]">
        {matches.map((match) => {
          const isSelected = selectedId === match.id;
          const hasResult = match.home_goals !== null && match.away_goals !== null;

          return (
            <div key={match.id} ref={(el) => { if (el) matchElsRef.current.set(match.id, el); else matchElsRef.current.delete(match.id); }}>
              <button
                onClick={() => handleClick(match)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                  isSelected ? "bg-black/5 dark:bg-white/5" : ""
                }`}
              >
                <span className="opacity-40 shrink-0 tabular-nums text-[10px] w-28">
                  {formatKickoff(match.kickoff_at, match)}
                </span>

                <span className="flex-1 flex items-center gap-1 min-w-0">
                  <span>{getTeamFlag(match.home_team)}</span>
                  <span className="truncate">{match.home_team}</span>
                </span>

                <span
                  className={`tabular-nums font-mono shrink-0 px-1.5 ${
                    hasResult ? "font-semibold" : "opacity-30"
                  }`}
                >
                  {hasResult ? `${match.home_goals}–${match.away_goals}` : "vs"}
                </span>

                <span className="flex-1 flex items-center gap-1 justify-end min-w-0">
                  <span className="truncate text-right">{match.away_team}</span>
                  <span>{getTeamFlag(match.away_team)}</span>
                </span>
              </button>

              {isSelected && (
                <div className="px-4 py-2.5 bg-black/[0.03] dark:bg-white/[0.03] border-t border-black/5 dark:border-white/10 text-xs">
                  {loading ? (
                    <span className="opacity-50">Loading…</span>
                  ) : predError ? (
                    <span className="text-amber-600 dark:text-amber-400">{predError}</span>
                  ) : preds ? (
                    <PredictionsList
                      match={selectedMatch!}
                      data={preds}
                      visibleCount={visibleCount}
                      onExtend={() => setVisibleCount((c) => c + PAGE_SIZE)}
                      onCollapse={() => setVisibleCount(PAGE_SIZE)}
                    />
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PredictionsList({
  match,
  data,
  visibleCount,
  onExtend,
  onCollapse,
}: {
  match: Match;
  data: PredictionsData;
  visibleCount: number;
  onExtend: () => void;
  onCollapse: () => void;
}) {
  const hasResult = match.home_goals !== null && match.away_goals !== null;

  // "You" is always pinned at the top; the cap applies to everyone else.
  const others = data.predictions;
  const shown = others.slice(0, visibleCount);
  const remaining = others.length - shown.length;
  const isExpanded = visibleCount > PAGE_SIZE && others.length > PAGE_SIZE;

  const rows: Array<Prediction & { isMe?: boolean }> = [
    ...(data.myPrediction ? [{ ...data.myPrediction, isMe: true }] : []),
    ...shown,
  ];

  if (rows.length === 0) {
    return <p className="opacity-50">No picks logged for this game yet.</p>;
  }

  return (
    <div className="space-y-1">
      {rows.map((p) => {
        const exact =
          hasResult &&
          p.predHome === match.home_goals &&
          p.predAway === match.away_goals;
        const correctOutcome =
          hasResult &&
          Math.sign(p.predHome - p.predAway) ===
            Math.sign(match.home_goals! - match.away_goals!);

        return (
          <div key={p.isMe ? "__me__" : p.username} className="flex items-center gap-2">
            <span className={`w-28 truncate font-medium ${p.isMe ? "" : "opacity-60"}`}>
              {p.isMe ? "You" : p.username}
              {p.isFollowed && (
                <span className="ml-1 text-[9px] uppercase tracking-wide opacity-50">
                  following
                </span>
              )}
            </span>
            <span className="tabular-nums font-mono">
              {p.predHome}–{p.predAway}
            </span>
            {hasResult && (
              <span
                className={
                  exact
                    ? "text-green-600 dark:text-green-400"
                    : correctOutcome
                    ? "text-blue-600 dark:text-blue-400"
                    : "opacity-30"
                }
              >
                {exact ? "✓ exact" : correctOutcome ? "✓ result" : "✗"}
              </span>
            )}
          </div>
        );
      })}

      {(remaining > 0 || isExpanded) && (
        <div className="flex items-center gap-3 pt-1.5">
          {remaining > 0 && (
            <button
              onClick={onExtend}
              className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Show {Math.min(PAGE_SIZE, remaining)} more
              <span className="opacity-50"> ({remaining} left)</span>
            </button>
          )}
          {isExpanded && (
            <button
              onClick={onCollapse}
              className="text-[11px] font-medium opacity-60 hover:opacity-100 hover:underline"
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}
