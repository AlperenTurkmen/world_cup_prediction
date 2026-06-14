"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin tool: create an entry on behalf of a player. Set their username +
 * password and upload their filled prediction workbook. Uses the same parse +
 * create_entry path as the public upload, but admin-authenticated and without
 * logging anyone in — the player can later sign in with these credentials.
 */
export default function CreateEntry() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && password.length >= 6 && file && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      body.append("username", username.trim());
      body.append("password", password);
      body.append("file", file!);
      const res = await fetch("/api/admin/create-entry", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Could not create the entry.");
      } else {
        setDone(
          `Created entry for "${data.username}" · ${data.predictionsSaved} group predictions · champion: ${data.champion}.`,
        );
        setUsername("");
        setPassword("");
        setFile(null);
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
      <h2 className="text-lg font-semibold">Create entry for a player</h2>
      <p className="mt-1 text-sm opacity-70">
        Set a username and password, then upload their filled prediction workbook.
        The player can sign in later with these credentials. One entry per username.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="opacity-70">Username</span>
          <input
            type="text"
            value={username}
            maxLength={40}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
            placeholder="player name"
          />
        </label>
        <label className="block text-sm">
          <span className="opacity-70">Password (min 6 chars)</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
            placeholder="set a password"
          />
        </label>
      </div>
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
          disabled={!canSubmit}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create entry"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {done && <p className="mt-3 text-sm text-green-700 dark:text-green-400">{done}</p>}
    </section>
  );
}
