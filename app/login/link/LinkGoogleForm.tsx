"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface LinkGoogleFormProps {
  email: string;
  redirectTo: string;
}

export default function LinkGoogleForm({ email, redirectTo }: LinkGoogleFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/google/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Could not link that Google account.");
      } else {
        router.refresh();
        router.push(redirectTo);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-black/15 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-[#111111]">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Link Google Account</h1>
      <p className="mt-2 text-sm text-foreground/60">
        You signed in as <strong>{email}</strong>. Enter your existing prediction username
        and password once to link it.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-foreground">
            Username
          </label>
          <input
            id="username"
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Linking..." : "Link and continue"}
        </button>
      </form>

      <div className="mt-6 text-center text-xs text-foreground/50">
        New here?{" "}
        <Link href="/upload" className="font-semibold text-foreground underline decoration-1 hover:opacity-80">
          Upload predictions with Google
        </Link>
      </div>
    </div>
  );
}
