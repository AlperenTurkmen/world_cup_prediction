"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConfirmJoin({
  code,
  needsApproval,
}: {
  code: string;
  needsApproval: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleJoin() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not join the league.");
        return;
      }
      if (data.status === "pending") {
        setPending(true);
      } else {
        router.push(`/leagues/${data.slug}`);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <p className="text-sm text-green-700 dark:text-green-400">
        Request sent — you&apos;ll appear on the board once the owner approves.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleJoin}
        disabled={busy}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {busy ? "Joining…" : needsApproval ? "Request to join" : "Join league"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
