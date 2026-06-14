"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SyncResponse {
  ok: boolean;
  error?: string;
  groupsApplied?: number;
  advancersByRound?: Record<string, number>;
  skipped?: string[];
}

/**
 * "Sync now" — pull finished results from football-data.org via /api/sync and
 * apply them. The same endpoint is hit automatically by an external scheduler;
 * this button is the manual/on-demand path. Manual forms below stay as overrides.
 */
export default function SyncResults() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResponse | null>(null);

  async function sync() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json()) as SyncResponse;
      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Sync failed.");
      } else {
        setResult(data);
        router.refresh();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const advSummary = result?.advancersByRound
    ? Object.entries(result.advancersByRound)
        .filter(([, n]) => n > 0)
        .map(([r, n]) => `${r}:${n}`)
        .join(" · ")
    : "";

  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Auto-sync results</h2>
      <p className="mt-1 text-sm opacity-70">
        Pull finished matches from football-data.org. Only writes newly-finished
        games — already-logged results are left untouched.
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {busy ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {result?.ok && (
        <div className="mt-3 text-sm text-green-700 dark:text-green-400">
          <p>
            Applied {result.groupsApplied ?? 0} new group result
            {result.groupsApplied === 1 ? "" : "s"}
            {advSummary ? ` · advancers ${advSummary}` : ""}.
          </p>
          {result.skipped && result.skipped.length > 0 && (
            <details className="mt-2 text-amber-700 dark:text-amber-400">
              <summary className="cursor-pointer">
                {result.skipped.length} skipped — review
              </summary>
              <ul className="mt-1 list-disc pl-5">
                {result.skipped.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
