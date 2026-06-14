"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface StartGameOption {
  id: number;
  label: string;
}

export default function CreateLeagueForm({
  startGames,
}: {
  startGames: StartGameOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [joinPolicy, setJoinPolicy] = useState<"approval" | "open">("approval");
  const [startMatchId, setStartMatchId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          visibility,
          joinPolicy,
          startMatchId: startMatchId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not create league.");
        return;
      }
      router.push(`/leagues/${data.slug}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 text-sm">
      <div>
        <label className="block text-xs font-medium opacity-70">League name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
          placeholder="The Office Cup"
          className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
        />
      </div>

      <div>
        <label className="block text-xs font-medium opacity-70">Visibility</label>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "private" | "public")}
          className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
        >
          <option value="private">Private — invite by link only</option>
          <option value="public">Public — listed in the directory</option>
        </select>
      </div>

      {visibility === "private" && (
        <div>
          <label className="block text-xs font-medium opacity-70">Joining</label>
          <select
            value={joinPolicy}
            onChange={(e) => setJoinPolicy(e.target.value as "approval" | "open")}
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          >
            <option value="approval">Approve each request</option>
            <option value="open">Anyone with the link joins instantly</option>
          </select>
        </div>
      )}

      {startGames.length > 0 && (
        <div>
          <label className="block text-xs font-medium opacity-70">
            Start scoring from
          </label>
          <select
            value={startMatchId}
            onChange={(e) => setStartMatchId(e.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          >
            <option value="">First game (whole tournament)</option>
            {startGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs opacity-60">
            Group-game points only count from this game onward. Knockout points
            always count.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="w-full rounded-md bg-black px-3 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {busy ? "Creating…" : "Create league"}
      </button>
    </form>
  );
}
