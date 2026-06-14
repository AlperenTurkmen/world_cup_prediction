"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Accelerator: upload the filled master *results* workbook to auto-populate all
 * 72 group scores and every round's actual advancers at once. The manual forms
 * below remain available as a fallback.
 */
export default function ResultsUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/upload-results", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Upload failed.");
      } else {
        setDone(`Applied ${data.groupResults} group results · champion: ${data.champion}.`);
        router.refresh();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Quick import (optional)</h2>
      <p className="mt-1 text-sm opacity-70">
        Upload the filled master <strong>results</strong> workbook to set all group
        scores and advancers at once. Overwrites existing results.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-sm file:mr-4 file:rounded-md file:border-0 file:bg-foreground file:px-4 file:py-2 file:text-sm file:font-medium file:text-background hover:file:opacity-90"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!file || busy}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {busy ? "Importing…" : "Import results"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {done && <p className="mt-3 text-sm text-green-700 dark:text-green-400">{done}</p>}
    </section>
  );
}
