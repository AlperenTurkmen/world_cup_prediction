"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdvRound } from "@/lib/rounds";

const RAIL = [0, 1, 2, 3, 4, 5];

interface TourMatch {
  matchNo: number;
  home: string | null;
  away: string | null;
  kickoffAt: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  penaltyWinner: string | null;
  pick: { predHome: number; predAway: number; penaltyWinner: string | null } | null;
  editable: boolean;
}
interface TourRound {
  round: AdvRound;
  label: string;
  deadline: string | null;
  status: "pending" | "open" | "locked";
  matches: TourMatch[];
}
type Draft = { h?: number; a?: number; pen?: string };

export default function ToursClient({ username }: { username: string }) {
  const [rounds, setRounds] = useState<TourRound[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [selected, setSelected] = useState<AdvRound | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Load the live tour state + seed local drafts from saved picks.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tours");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setLoadError(data?.error ?? "Could not load the knockout tours.");
          return;
        }
        const rs = data.rounds as TourRound[];
        setRounds(rs);
        const seed: Record<number, Draft> = {};
        for (const r of rs) {
          for (const m of r.matches) {
            if (m.pick) seed[m.matchNo] = { h: m.pick.predHome, a: m.pick.predAway, pen: m.pick.penaltyWinner ?? undefined };
          }
        }
        setDrafts(seed);
        // Default to the first open round, else the latest round with any matchups.
        const open = rs.find((r) => r.status === "open");
        const known = [...rs].reverse().find((r) => r.matches.some((m) => m.home));
        setSelected((open ?? known ?? rs[0])?.round ?? null);
      } catch {
        if (!cancelled) setLoadError("Network error — please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = useMemo(() => rounds?.find((r) => r.round === selected) ?? null, [rounds, selected]);

  // Persist a round's complete picks (decisive, or a draw with a penalty winner).
  const saveRound = useCallback(
    async (round: TourRound) => {
      const picks: Record<string, { h: number; a: number; pen?: string }> = {};
      for (const m of round.matches) {
        if (!m.editable) continue;
        const d = drafts[m.matchNo];
        if (!d || d.h === undefined || d.a === undefined) continue;
        if (d.h === d.a && !d.pen) continue; // a draw needs a penalty winner before it can save
        picks[m.matchNo] = d.h === d.a ? { h: d.h, a: d.a, pen: d.pen } : { h: d.h, a: d.a };
      }
      if (Object.keys(picks).length === 0) return;
      setSaveState("saving");
      try {
        const res = await fetch("/api/tours", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ round: round.round, picks }),
        });
        const data = await res.json();
        setSaveState(res.ok && data.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    },
    [drafts],
  );

  // Debounced autosave whenever drafts change in the open round.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!current || current.status !== "open") return;
    const t = setTimeout(() => void saveRound(current), 1500);
    return () => clearTimeout(t);
  }, [drafts, current, saveRound]);

  const setGoals = useCallback((matchNo: number, side: "h" | "a", g: number) => {
    setDrafts((prev) => {
      const cur = prev[matchNo] ?? {};
      const next = { ...cur, [side]: g };
      // Clear a stale penalty winner once the score is no longer level.
      if (next.h !== undefined && next.a !== undefined && next.h !== next.a) delete next.pen;
      return { ...prev, [matchNo]: next };
    });
  }, []);
  const setPen = useCallback((matchNo: number, team: string) => {
    setDrafts((prev) => ({ ...prev, [matchNo]: { ...(prev[matchNo] ?? {}), pen: team } }));
  }, []);

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Knockout predictions</h1>
        <p className="mt-3 rounded-md border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
          {loadError}
        </p>
      </main>
    );
  }
  if (!rounds) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm opacity-60">Loading the knockout tours…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Knockout predictions</h1>
          <p className="mt-1 text-sm opacity-60">
            Signed in as {username}. Each round opens when its matchups are set and locks at its first
            kickoff. Each game is worth up to 8 points — and if you also nailed it in your original
            bracket, you earn a foresight bonus.
          </p>
        </div>
        <SaveBadge state={saveState} />
      </header>

      <nav className="mt-6 flex flex-wrap gap-2 text-xs font-medium">
        {rounds.map((r) => (
          <button
            key={r.round}
            type="button"
            onClick={() => setSelected(r.round)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
              selected === r.round
                ? "bg-foreground text-background"
                : "border border-black/15 dark:border-white/20"
            }`}
          >
            <StatusDot status={r.status} active={selected === r.round} />
            {r.label}
          </button>
        ))}
      </nav>

      {current && (
        <section className="mt-6">
          <RoundHeader round={current} />
          {current.status === "pending" ? (
            <p className="mt-4 rounded-lg border border-black/10 p-4 text-sm opacity-70 dark:border-white/15">
              The matchups for this round aren&apos;t known yet — they appear once the previous round
              finishes. Check back then.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {current.matches.map((m) => (
                <MatchEditor
                  key={m.matchNo}
                  match={m}
                  draft={drafts[m.matchNo]}
                  onGoals={(side, g) => setGoals(m.matchNo, side, g)}
                  onPen={(team) => setPen(m.matchNo, team)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <p className="mt-8 text-center text-xs opacity-50">
        See the full bracket on the{" "}
        <Link href="/tree" className="underline">
          tournament tree
        </Link>
        .
      </p>
    </main>
  );
}

function SaveBadge({ state }: { state: string }) {
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : state === "error" ? "Save failed" : "";
  if (!label) return <span className="shrink-0 text-xs opacity-0">·</span>;
  return (
    <span
      className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
        state === "error"
          ? "bg-red-600/10 text-red-700 dark:text-red-300"
          : "bg-black/5 opacity-70 dark:bg-white/10"
      }`}
    >
      {label}
    </span>
  );
}

function StatusDot({ status, active }: { status: TourRound["status"]; active: boolean }) {
  const color =
    status === "open"
      ? "bg-green-500"
      : status === "locked"
        ? active
          ? "bg-background/60"
          : "bg-black/30 dark:bg-white/40"
        : "bg-amber-500";
  return <span className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}

function RoundHeader({ round }: { round: TourRound }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold">{round.label}</h2>
      {round.status === "open" && round.deadline && (
        <span className="text-xs font-medium text-green-700 dark:text-green-400">
          Locks {formatDeadline(round.deadline)}
        </span>
      )}
      {round.status === "locked" && (
        <span className="text-xs font-medium opacity-50">Locked — first game has started</span>
      )}
    </div>
  );
}

function MatchEditor({
  match,
  draft,
  onGoals,
  onPen,
}: {
  match: TourMatch;
  draft: Draft | undefined;
  onGoals: (side: "h" | "a", g: number) => void;
  onPen: (team: string) => void;
}) {
  // No matchup yet.
  if (!match.home || !match.away) {
    return (
      <div className="rounded-lg border border-black/10 px-4 py-3 text-center text-xs opacity-40 dark:border-white/15">
        Awaiting the previous round
      </div>
    );
  }

  const hasResult = match.homeGoals !== null && match.awayGoals !== null;
  const isDraw = draft?.h !== undefined && draft?.a !== undefined && draft.h === draft.a;

  // Locked / has-result view: read-only actual + the player's pick.
  if (!match.editable) {
    return (
      <div className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/15">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-medium">{match.home}</span>
          <span className="shrink-0 font-bold tabular-nums">
            {hasResult ? `${match.homeGoals} – ${match.awayGoals}` : "vs"}
          </span>
          <span className="truncate text-right font-medium">{match.away}</span>
        </div>
        {hasResult && match.penaltyWinner && (
          <p className="mt-1 text-center text-[11px] opacity-50">{match.penaltyWinner} won on penalties</p>
        )}
        <p className="mt-1 text-center text-[11px] opacity-60">
          {match.pick
            ? `Your pick: ${match.pick.predHome} – ${match.pick.predAway}${
                match.pick.penaltyWinner ? ` (${match.pick.penaltyWinner} pens)` : ""
              }`
            : "No pick"}
        </p>
      </div>
    );
  }

  // Editable view: a rail for each side, plus a penalty picker on a draw.
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm font-semibold">
        <span className="truncate text-right">{match.home}</span>
        <span className="px-2 tabular-nums opacity-30">
          {draft?.h ?? "–"}:{draft?.a ?? "–"}
        </span>
        <span className="truncate">{match.away}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MiniRail value={draft?.h} onPick={(g) => onGoals("h", g)} align="end" />
        <MiniRail value={draft?.a} onPick={(g) => onGoals("a", g)} align="start" />
      </div>
      {isDraw && (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs">
          <span className="opacity-60">Penalty winner:</span>
          {[match.home, match.away].map((team) => (
            <button
              key={team}
              type="button"
              onClick={() => onPen(team!)}
              className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
                draft?.pen === team
                  ? "bg-foreground text-background"
                  : "border border-black/15 dark:border-white/20"
              }`}
            >
              {team}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniRail({
  value,
  onPick,
  align,
}: {
  value: number | undefined;
  onPick: (g: number) => void;
  align: "start" | "end";
}) {
  return (
    <div className={`flex flex-wrap gap-1 ${align === "end" ? "justify-end" : "justify-start"}`}>
      {RAIL.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          className={`h-8 w-8 rounded-md text-sm font-bold tabular-nums transition-colors ${
            value === n
              ? "bg-foreground text-background"
              : "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** A short, friendly "locks in 3h" / "locks Jul 1, 16:00" style string. */
function formatDeadline(iso: string): string {
  const ms = new Date(iso).getTime();
  const diff = ms - Date.now();
  const hours = diff / 3_600_000;
  if (diff > 0 && hours < 48) {
    if (hours < 1) return `in ${Math.max(1, Math.round(diff / 60_000))} min`;
    return `in ${Math.round(hours)}h`;
  }
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
