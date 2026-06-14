"use client";

import { useState } from "react";
import type { MatchRow } from "@/lib/adminData";

type SaveState = "idle" | "saving" | "saved" | "error";

function Row({ match }: { match: MatchRow }) {
  const [home, setHome] = useState<string>(match.home_goals?.toString() ?? "");
  const [away, setAway] = useState<string>(match.away_goals?.toString() ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Keep entries to a sane 0–99 whole number; the server validates too.
  function clamp(v: string): string {
    if (v === "") return "";
    const digits = v.replace(/[^\d]/g, "").slice(0, 2);
    return digits;
  }

  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/admin/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_no: match.match_no,
          home_goals: home === "" ? null : Number(home),
          away_goals: away === "" ? null : Number(away),
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

  const numClass =
    "w-12 rounded-md border border-black/15 bg-transparent px-2 py-1 text-center text-sm tabular-nums outline-none focus:border-black/40 dark:border-white/20";

  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-1.5 pr-2 tabular-nums opacity-50">{match.match_no}</td>
      <td className="py-1.5 pr-2 text-right">{match.home_team}</td>
      <td className="py-1.5 px-1">
        <input
          type="number"
          min={0}
          max={99}
          value={home}
          onChange={(e) => {
            setHome(clamp(e.target.value));
            setState("idle");
          }}
          className={numClass}
          aria-label={`${match.home_team} goals`}
        />
      </td>
      <td className="py-1.5 px-1 opacity-40">–</td>
      <td className="py-1.5 px-1">
        <input
          type="number"
          min={0}
          max={99}
          value={away}
          onChange={(e) => {
            setAway(clamp(e.target.value));
            setState("idle");
          }}
          className={numClass}
          aria-label={`${match.away_team} goals`}
        />
      </td>
      <td className="py-1.5 pl-2 text-left">{match.away_team}</td>
      <td className="py-1.5 pl-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="rounded-md border border-black/15 px-3 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
        >
          {state === "saving" ? "…" : "Save"}
        </button>
      </td>
      <td className="py-1.5 pl-2 text-xs">
        {state === "saved" && <span className="text-green-700 dark:text-green-400">✓</span>}
        {state === "error" && <span className="text-red-700 dark:text-red-300">{error}</span>}
      </td>
    </tr>
  );
}

export default function GroupResults({ matches }: { matches: MatchRow[] }) {
  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Group results</h2>
      <p className="mt-1 text-sm opacity-70">
        Enter the actual score for each group game and click Save. Leave both blank
        to clear a result.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {matches.map((m) => (
              <Row key={m.match_no} match={m} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
