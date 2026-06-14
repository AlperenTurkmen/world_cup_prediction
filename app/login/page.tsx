"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/";
  const oauthError = searchParams.get("error");

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
      const res = await fetch("/api/user/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Invalid username or password.");
      } else {
        // Successful login, refresh router and redirect
        router.refresh();
        router.push(redirectTo);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function googleErrorMessage(code: string | null): string | null {
    if (!code) return null;
    if (code === "google_config") return "Google sign-in is not configured yet.";
    if (code === "google_denied") return "Google sign-in was cancelled.";
    if (code === "google_state") return "Google sign-in expired. Please try again.";
    return "Google sign-in failed. Please try again.";
  }

  const googleStartHref = `/api/auth/google/start?redirectTo=${encodeURIComponent(redirectTo)}`;
  const displayedError = error ?? googleErrorMessage(oauthError);

  return (
    <div className="w-full max-w-md rounded-2xl border border-black/15 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-[#111111]">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Sign In</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Access your profile and manage your followed players.
      </p>

      <a
        href={googleStartHref}
        className="mt-6 flex w-full items-center justify-center rounded-lg border border-black/15 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      >
        Continue with Google
      </a>

      <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-foreground/40">
        <div className="h-px flex-1 bg-black/10 dark:bg-white/15" />
        or
        <div className="h-px flex-1 bg-black/10 dark:bg-white/15" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
            placeholder="e.g. alex"
            className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50 text-foreground"
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
            placeholder="••••••••"
            className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50 text-foreground"
          />
        </div>

        {displayedError && (
          <div className="rounded-lg border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            {displayedError}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="mt-2 w-full rounded-lg bg-foreground py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-foreground/50">
        Don't have an entry yet?{" "}
        <Link href="/upload" className="font-semibold text-foreground underline decoration-1 hover:opacity-80">
          Upload your predictions
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-12">
      <Suspense fallback={<div className="text-sm opacity-50">Loading form...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
