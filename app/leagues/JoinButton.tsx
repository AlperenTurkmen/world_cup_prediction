"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Self-join button for a public league in the directory. */
export default function JoinButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not join.");
        return;
      }
      router.push(`/leagues/${slug}`);
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={handleJoin}
        disabled={busy}
        className="rounded-md border border-black/20 px-3 py-1 text-sm font-medium disabled:opacity-50 dark:border-white/25"
      >
        {busy ? "Joining…" : "Join"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
