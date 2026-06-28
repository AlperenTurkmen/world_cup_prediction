"use client";

import { useState } from "react";
import type { ActualKnockoutRow } from "@/lib/adminData";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Scored knockout slots grouped by round (3rd-place playoff 103 excluded). */
const ROUNDS: { label: string; matches: number[] }[] = [
  { label: "Round of 32", matches: Array.from({ length: 16 }, (_, i) => 73 + i) },
  { label: "Round of 16", matches: Array.from({ length: 8 }, (_, i) => 89 + i) },
  { label: "Quarter-finals", matches: [97, 98, 99, 100] },
  { label: "Semi-finals", matches: [101, 102] },
  { label: "Final", matches: [104] },
];

function clampGoal(v: string): string {
  if (v === "") return "";
  return v.replace(/[^\d]/g, "").slice(0, 2);
}

function Row({ matchNo, match, teams }: { matchNo: number; match: ActualKnockoutRow | undefined; teams: string[] }) {
  const [homeTeam, setHomeTeam] = useState(match?.home_team ?? "");
  const [awayTeam, setAwayTeam] = useState(match?.away_team ?? "");
  const [home, setHome] = useState(match?.home_goals?.toString() ?? "");
  const [away, setAway] = useState(match?.away_goals?.toString() ?? "");
  const [pen, setPen] = useState(match?.penalty_winner ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const isLevel = home !== "" && away !== "" && home === away;
  const dirty = () => {
    setState("idle");
    setError(null);
  };

  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/admin/knockout-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_no: matchNo,
          home_team: homeTeam || null,
          away_team: awayTeam || null,
          home_goals: home === "" ? null : Number(home),
          away_goals: away === "" ? null : Number(away),
          penalty_winner: isLevel ? pen || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState("error");
        setError(data?.error ?? "Failed");
      } else {
        setState("saved");
      }
    } catch {
      setState("error");
      setError("Network error");
    }
  }

  const teamClass =
    "min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-1.5 py-1 text-sm outline-none focus:border-black/40 dark:border-white/20";
  const numClass =
    "w-10 rounded-md border border-black/15 bg-transparent px-1 py-1 text-center text-sm tabular-nums outline-none focus:border-black/40 dark:border-white/20";

  const TeamSelect = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <select
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        dirty();
      }}
      aria-label={label}
      className={teamClass}
    >
      <option value="">— TBD —</option>
      {teams.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-black/5 py-2 dark:border-white/10">
      <span className="w-7 shrink-0 text-xs tabular-nums opacity-50">{matchNo}</span>
      <TeamSelect value={homeTeam} onChange={setHomeTeam} label={`match ${matchNo} home team`} />
      <input
        type="number"
        min={0}
        max={99}
        value={home}
        onChange={(e) => {
          setHome(clampGoal(e.target.value));
          dirty();
        }}
        className={numClass}
        aria-label={`match ${matchNo} home goals`}
      />
      <span className="opacity-40">–</span>
      <input
        type="number"
        min={0}
        max={99}
        value={away}
        onChange={(e) => {
          setAway(clampGoal(e.target.value));
          dirty();
        }}
        className={numClass}
        aria-label={`match ${matchNo} away goals`}
      />
      <TeamSelect value={awayTeam} onChange={setAwayTeam} label={`match ${matchNo} away team`} />

      {isLevel && (
        <label className="flex items-center gap-1 text-xs opacity-80">
          <span className="opacity-60">Pens:</span>
          <select
            value={pen}
            onChange={(e) => {
              setPen(e.target.value);
              dirty();
            }}
            aria-label={`match ${matchNo} penalty winner`}
            className="rounded-md border border-black/15 bg-transparent px-1.5 py-1 text-sm outline-none focus:border-black/40 dark:border-white/20"
          >
            <option value="">—</option>
            {[homeTeam, awayTeam].filter(Boolean).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        onClick={save}
        disabled={state === "saving"}
        className="rounded-md border border-black/15 px-3 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
      >
        {state === "saving" ? "…" : "Save"}
      </button>
      <span className="min-w-4 text-xs">
        {state === "saved" && <span className="text-green-700 dark:text-green-400">✓</span>}
        {state === "error" && <span className="text-red-700 dark:text-red-300">{error}</span>}
      </span>
    </div>
  );
}

export default function KnockoutResults({
  matches,
  teams,
}: {
  matches: ActualKnockoutRow[];
  teams: string[];
}) {
  const byNo = new Map(matches.map((m) => [m.match_no, m]));
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-lg font-semibold">Knockout results</span>
        <span className="text-xs opacity-50">{open ? "Hide ▴" : "Edit ▾"}</span>
      </button>
      <p className="mt-1 text-sm opacity-70">
        Manually set or correct each knockout match&rsquo;s teams, score, and penalty-shootout winner.
        These override the auto-sync — useful for a slot the results sync can&rsquo;t resolve. Leave
        both scores blank to clear a result; the kickoff time is left untouched.
      </p>

      {open && (
        <div className="mt-4 space-y-5">
          {ROUNDS.map((round) => (
            <div key={round.label}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">
                {round.label}
              </h3>
              <div>
                {round.matches.map((no) => (
                  <Row key={no} matchNo={no} match={byNo.get(no)} teams={teams} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
