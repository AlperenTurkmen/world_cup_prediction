"use client";

import { useState } from "react";
import { ADV_ROUNDS, type AdvRound } from "@/lib/rounds";

const ROUND_LABELS: Record<AdvRound, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  FINAL: "Finalists",
  CHAMPION: "Champion",
};

const EXPECTED: Record<AdvRound, number> = {
  R32: 32,
  R16: 16,
  QF: 8,
  SF: 4,
  FINAL: 2,
  CHAMPION: 1,
};

function RoundEditor({
  round,
  teams,
  initial,
}: {
  round: AdvRound;
  teams: string[];
  initial: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isChampion = round === "CHAMPION";

  function toggle(team: string) {
    setMsg(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (isChampion) {
        next.clear();
        if (!prev.has(team)) next.add(team);
      } else if (next.has(team)) {
        next.delete(team);
      } else {
        next.add(team);
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/advancers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round, teams: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg({ ok: false, text: data?.error ?? "Failed to save." });
      } else {
        setMsg({ ok: true, text: `Saved ${data.count} team${data.count === 1 ? "" : "s"}.` });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-md border border-black/10 dark:border-white/15">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {ROUND_LABELS[round]}{" "}
        <span className="opacity-50">
          ({selected.size}/{EXPECTED[round]})
        </span>
      </summary>
      <div className="border-t border-black/10 p-4 dark:border-white/15">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {teams.map((team) => (
            <label key={team} className="flex items-center gap-2 text-sm">
              <input
                type={isChampion ? "radio" : "checkbox"}
                name={`adv-${round}`}
                checked={selected.has(team)}
                onChange={() => toggle(team)}
              />
              <span>{team}</span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {msg && (
            <span
              className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-300"}`}
            >
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

export default function Advancers({
  teams,
  initial,
}: {
  teams: string[];
  initial: Record<AdvRound, string[]>;
}) {
  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Advancement actuals</h2>
      <p className="mt-1 text-sm opacity-70">
        Tick the teams that actually reached each round, then Save. Each Save
        replaces that round&apos;s set.
      </p>
      <div className="mt-4 space-y-2">
        {ADV_ROUNDS.map((round) => (
          <RoundEditor key={round} round={round} teams={teams} initial={initial[round]} />
        ))}
      </div>
    </section>
  );
}
