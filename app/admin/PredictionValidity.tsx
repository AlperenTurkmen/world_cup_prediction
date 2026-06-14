"use client";

import { useState } from "react";
import type { AdminEntryRow } from "@/lib/adminData";

interface PredictionRow {
  match_id: number;
  match_no: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  pred_home: number;
  pred_away: number;
  is_logged: boolean;
  is_score_eligible: boolean;
}

/**
 * Per-prediction override: pick a user, then toggle game-by-game whether each of
 * their predictions counts toward scoring. Composes with the global start-game
 * floor — use this for one-off exceptions (a single user, a single game), not to
 * set everyone's start (that's "Global start game").
 */
export default function PredictionValidity({ entries }: { entries: AdminEntryRow[] }) {
  const [entryId, setEntryId] = useState<string>("");
  const [rows, setRows] = useState<PredictionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyMatch, setBusyMatch] = useState<number | null>(null);

  async function load(id: string) {
    setEntryId(id);
    setRows([]);
    setError(null);
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/eligibility?entry_id=${id}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Failed to load.");
      } else {
        setRows(data.predictions as PredictionRow[]);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(row: PredictionRow) {
    const eligible = !row.is_score_eligible;
    setBusyMatch(row.match_id);
    setError(null);
    try {
      const res = await fetch("/api/admin/eligibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: Number(entryId), match_id: row.match_id, eligible }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Update failed.");
      } else {
        setRows((current) =>
          current.map((r) =>
            r.match_id === row.match_id ? { ...r, is_score_eligible: eligible } : r
          )
        );
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusyMatch(null);
    }
  }

  const validCount = rows.filter((r) => r.is_score_eligible).length;

  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Prediction validity</h2>
      <p className="mt-1 text-sm opacity-70">
        Choose a user, then toggle which of their game predictions count toward
        scoring. For a single exception only — use <em>Global start game</em> to
        set everyone&rsquo;s start.
      </p>

      <div className="mt-4">
        <select
          value={entryId}
          onChange={(e) => load(e.target.value)}
          className="min-w-[16rem] rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-black/40 dark:border-white/20"
        >
          <option value="">Select a user…</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.username}
              {e.is_hidden ? " (hidden)" : ""}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {loading ? (
        <p className="mt-4 text-sm opacity-60">Loading…</p>
      ) : rows.length > 0 ? (
        <>
          <p className="mt-4 text-xs opacity-60">
            {validCount} of {rows.length} predictions valid
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.match_id} className="border-b border-black/5 dark:border-white/10">
                    <td className="py-1.5 pr-2 tabular-nums opacity-50">{r.match_no}</td>
                    <td className="py-1.5 pr-2 text-right">{r.home_team}</td>
                    <td className="py-1.5 px-1 tabular-nums opacity-70">
                      {r.pred_home}–{r.pred_away}
                    </td>
                    <td className="py-1.5 pl-2 text-left">{r.away_team}</td>
                    <td className="py-1.5 px-2 text-xs opacity-50">
                      {r.is_logged ? "logged" : ""}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={r.is_score_eligible}
                          disabled={busyMatch === r.match_id}
                          onChange={() => toggle(r)}
                        />
                        <span
                          className={
                            r.is_score_eligible
                              ? "text-xs font-medium text-green-700 dark:text-green-400"
                              : "text-xs font-medium opacity-50"
                          }
                        >
                          {r.is_score_eligible ? "Valid" : "Excluded"}
                        </span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : entryId && !error ? (
        <p className="mt-4 text-sm opacity-60">No predictions for this user.</p>
      ) : null}
    </section>
  );
}
