"use client";

import { useState } from "react";
import type { AdminEntryRow, ActualKnockoutRow } from "@/lib/adminData";

const ROUNDS: { label: string; matchNos: number[] }[] = [
  { label: "Round of 32", matchNos: Array.from({ length: 16 }, (_, i) => 73 + i) },
  { label: "Round of 16", matchNos: Array.from({ length: 8 }, (_, i) => 89 + i) },
  { label: "Quarter-finals", matchNos: [97, 98, 99, 100] },
  { label: "Semi-finals", matchNos: [101, 102] },
  { label: "Final", matchNos: [104] },
];

type SaveState = "idle" | "saving" | "saved" | "error";

interface TourPick {
  predHome: string;
  predAway: string;
  penaltyWinner: string;
  state: SaveState;
  error: string | null;
}

const EMPTY_PICK: TourPick = { predHome: "", predAway: "", penaltyWinner: "", state: "idle", error: null };

function clamp(v: string) {
  return v.replace(/[^\d]/g, "").slice(0, 2);
}

export default function TourPredictionsAdmin({
  entries,
  knockoutMatches,
}: {
  entries: AdminEntryRow[];
  knockoutMatches: ActualKnockoutRow[];
}) {
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState<Record<number, TourPick>>({});

  const matchMap = new Map(knockoutMatches.map((m) => [m.match_no, m]));

  const activeRounds = ROUNDS.filter((r) =>
    r.matchNos.some((no) => {
      const m = matchMap.get(no);
      return m?.home_team && m?.away_team;
    })
  );

  async function loadPicks(entryId: number) {
    setLoading(true);
    setPicks({});
    try {
      const res = await fetch(`/api/admin/tour-predictions?entryId=${entryId}`);
      const json = await res.json();
      if (json.ok) {
        const init: Record<number, TourPick> = {};
        for (const p of json.picks) {
          init[p.match_no] = {
            predHome: String(p.pred_home),
            predAway: String(p.pred_away),
            penaltyWinner: p.penalty_winner ?? "",
            state: "idle",
            error: null,
          };
        }
        setPicks(init);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSelectEntry(id: number) {
    setSelectedEntryId(id);
    setPicks({});
    loadPicks(id);
  }

  function updatePick(matchNo: number, patch: Partial<TourPick>) {
    setPicks((prev) => ({
      ...prev,
      [matchNo]: { ...(prev[matchNo] ?? EMPTY_PICK), ...patch },
    }));
  }

  async function savePick(matchNo: number) {
    if (!selectedEntryId) return;
    const pick = picks[matchNo];
    if (!pick || pick.predHome === "" || pick.predAway === "") return;

    updatePick(matchNo, { state: "saving", error: null });

    try {
      const res = await fetch("/api/admin/tour-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: selectedEntryId,
          matchNo,
          predHome: Number(pick.predHome),
          predAway: Number(pick.predAway),
          penaltyWinner: pick.penaltyWinner || null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        updatePick(matchNo, { state: "saved" });
      } else {
        updatePick(matchNo, { state: "error", error: json.error ?? "Failed to save." });
      }
    } catch {
      updatePick(matchNo, { state: "error", error: "Network error." });
    }
  }

  const selectedEntry = entries.find((e) => e.id === selectedEntryId);

  return (
    <section className="rounded-xl border border-black/10 dark:border-white/10 p-5 space-y-4">
      <h2 className="font-semibold text-base">Tour Predictions Override</h2>
      <p className="text-xs text-foreground/60">
        Enter round-tour picks on behalf of a player. Picks are backdated to just before the
        round&apos;s first kickoff so they count toward scoring.
      </p>

      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-foreground/60 w-16 shrink-0">Player</label>
        <select
          className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-background px-3 py-1.5 text-sm"
          value={selectedEntryId ?? ""}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) handleSelectEntry(id);
          }}
        >
          <option value="">— select a player —</option>
          {entries
            .filter((e) => !e.is_hidden)
            .sort((a, b) => a.username.localeCompare(b.username))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.username}
              </option>
            ))}
        </select>
      </div>

      {loading && <p className="text-xs text-foreground/50">Loading picks…</p>}

      {selectedEntry && !loading && (
        <div className="space-y-6">
          {activeRounds.length === 0 && (
            <p className="text-xs text-foreground/50">No knockout matches with known teams yet.</p>
          )}
          {activeRounds.map((round) => (
            <div key={round.label}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/50 mb-2">
                {round.label}
              </h3>
              <div className="space-y-1.5">
                {round.matchNos.map((matchNo) => {
                  const m = matchMap.get(matchNo);
                  if (!m?.home_team || !m?.away_team) return null;
                  const pick = picks[matchNo] ?? EMPTY_PICK;
                  const isLevel = pick.predHome !== "" && pick.predHome === pick.predAway;

                  return (
                    <div key={matchNo} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-5 text-right tabular-nums text-foreground/40">{matchNo}</span>
                      <span className="w-36 truncate font-medium">{m.home_team}</span>
                      <span className="text-foreground/40">vs</span>
                      <span className="w-36 truncate font-medium">{m.away_team}</span>

                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="H"
                        value={pick.predHome}
                        onChange={(e) => updatePick(matchNo, { predHome: clamp(e.target.value), state: "idle" })}
                        className="w-10 rounded border border-black/15 dark:border-white/15 bg-background px-2 py-0.5 text-center tabular-nums"
                      />
                      <span className="text-foreground/40">–</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="A"
                        value={pick.predAway}
                        onChange={(e) => updatePick(matchNo, { predAway: clamp(e.target.value), state: "idle" })}
                        className="w-10 rounded border border-black/15 dark:border-white/15 bg-background px-2 py-0.5 text-center tabular-nums"
                      />

                      {isLevel && (
                        <select
                          value={pick.penaltyWinner}
                          onChange={(e) => updatePick(matchNo, { penaltyWinner: e.target.value })}
                          className="rounded border border-black/15 dark:border-white/15 bg-background px-1.5 py-0.5 text-xs"
                        >
                          <option value="">Pen winner…</option>
                          <option value={m.home_team}>{m.home_team}</option>
                          <option value={m.away_team}>{m.away_team}</option>
                        </select>
                      )}

                      <button
                        onClick={() => savePick(matchNo)}
                        disabled={pick.state === "saving" || !pick.predHome || !pick.predAway}
                        className="rounded bg-foreground px-2.5 py-0.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-40 cursor-pointer"
                      >
                        {pick.state === "saving" ? "…" : "Save"}
                      </button>

                      {pick.state === "saved" && (
                        <span className="text-green-600 dark:text-green-400 font-semibold">✓</span>
                      )}
                      {pick.state === "error" && (
                        <span className="text-red-500">{pick.error}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
