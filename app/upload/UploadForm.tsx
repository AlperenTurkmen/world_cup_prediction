"use client";

import Link from "next/link";
import { useState } from "react";

interface UploadSuccess {
  ok: true;
  username: string;
  predictionsSaved: number;
  latePredictionCount: number;
  champion: string;
}

interface UploadFormProps {
  googleEmail: string;
}

export default function UploadForm({ googleEmail }: UploadFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadSuccess | null>(null);

  const canSubmit = username.trim().length > 0 && file !== null && status === "idle";

  async function handleSubmit() {
    if (!canSubmit || !file) return;
    setStatus("submitting");
    setError(null);
    setResult(null);

    try {
      const body = new FormData();
      body.append("username", username.trim());
      body.append("password", password);
      body.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
      } else {
        setResult(data as UploadSuccess);
      }
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setStatus("idle");
    }
  }

  if (result) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Entry submitted</h1>
        <div className="mt-4 rounded-lg border border-green-600/30 bg-green-600/10 p-4 text-sm">
          <p>
            Thanks, <strong>{result.username}</strong>! We saved{" "}
            <strong>{result.predictionsSaved}</strong> group predictions and your knockout picks.
          </p>
          <p className="mt-2">
            Your predicted champion: <strong>{result.champion}</strong>.
          </p>
          {result.latePredictionCount > 0 && (
            <p className="mt-2">
              Wow, you're really good, you have brilliant guesses{" "}
              <strong>({result.latePredictionCount})</strong> for the past games, but
              unfortunately they won't be included in your score.
            </p>
          )}
        </div>
        <Link href="/" className="mt-6 inline-block text-sm font-medium underline">
          View the leaderboard
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold">Upload your predictions</h1>
      <p className="mt-2 text-sm opacity-70">
        Signed in with Google as <strong>{googleEmail}</strong>. Fill in the WCup_2026
        Excel workbook, <strong>open and save it once in Excel</strong> so the bracket
        calculates, then upload it here. One entry per person.
      </p>

      <div className="mt-8 space-y-6">
        <div>
          <label htmlFor="username" className="block text-sm font-medium">
            Your prediction username
          </label>
          <input
            id="username"
            type="text"
            value={username}
            maxLength={40}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. alex"
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Optional password fallback
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to use Google only"
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          />
          <p className="mt-1 text-xs opacity-60">
            If you set one, it must be at least 6 characters.
          </p>
        </div>

        <div>
          <label htmlFor="file" className="block text-sm font-medium">
            Your filled workbook (.xlsx)
          </label>
          <input
            id="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-foreground file:px-4 file:py-2 file:text-sm file:font-medium file:text-background hover:file:opacity-90"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "submitting" ? "Uploading..." : "Submit entry"}
        </button>
      </div>
    </main>
  );
}
