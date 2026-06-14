"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MatchRow } from "@/lib/adminData";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Sets the tournament-wide "everyone starts from game N" floor for the public
 * leaderboard. Group-match points only count from the chosen game onward; pick
 * "No floor" to score the whole tournament. Deterministic and independent of
 * upload timing — this is the safe way to make every player start at game 9.
 */
export default function GlobalStart({
  matches,
  current,
}: {
  matches: MatchRow[];
  current: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(current ? String(current) : "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/admin/global-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: value === "" ? null : Number(value) }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState("error");
        setError(data?.error ?? "Failed");
      } else {
        setState("saved");
        router.refresh();
      }
    } catch {
      setState("error");
      setError("Network error");
    }
  }

  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Global start game</h2>
      <p className="mt-1 text-sm opacity-70">
        Everyone&rsquo;s group-match points count only from this game onward.
        Set it to the first game that should count (e.g. game 9); pick{" "}
        <em>No floor</em> to score the whole tournament. Knockout points always
        count.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setState("idle");
          }}
          className="min-w-[18rem] rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-black/40 dark:border-white/20"
        >
          <option value="">No floor — score the whole tournament</option>
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              Game {m.match_no} — {m.home_team} vs {m.away_team}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
        >
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && (
          <span className="text-xs text-green-700 dark:text-green-400">Saved ✓</span>
        )}
        {state === "error" && (
          <span className="text-xs text-red-700 dark:text-red-300">{error}</span>
        )}
      </div>
    </section>
  );
}
