"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leagues/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not join the league.");
        return;
      }
      if (data.status === "pending") {
        setMessage("Request sent — waiting for the owner to approve.");
        router.refresh();
      } else {
        router.push(`/leagues/${data.slug}`);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 text-sm">
      <p className="text-xs opacity-70">
        Paste an invite code or the code from a share link.
      </p>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
        placeholder="e.g. 3f9a1c2b7d"
        className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-700 dark:text-green-400">{message}</p>}
      <button
        type="submit"
        disabled={busy || !code.trim()}
        className="w-full rounded-md border border-black/20 px-3 py-2 font-medium disabled:opacity-50 dark:border-white/25"
      >
        {busy ? "Joining…" : "Join league"}
      </button>
    </form>
  );
}
