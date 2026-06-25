"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface NavMenuProps {
  player: {
    id: number;
    username: string;
  } | null;
}

const LINKS = [
  { href: "/", label: "Leaderboard" },
  { href: "/upload", label: "Upload" },
  { href: "/tree", label: "Bracket" },
  { href: "/tours", label: "Knockouts" },
  { href: "/tutorial", label: "How it works" },
  { href: "/leagues", label: "Leagues" },
];

/**
 * Responsive primary navigation. On >=sm screens the links sit inline; on
 * mobile they collapse behind a hamburger toggle so the header never overflows
 * the viewport.
 */
export default function NavMenu({ player }: NavMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function handleLogout() {
    setOpen(false);
    try {
      const res = await fetch("/api/user/logout", { method: "POST" });
      if (res.ok) {
        router.refresh();
        router.push("/");
      }
    } catch (err) {
      console.error("Logout failed:", err);
    }
  }

  return (
    <>
      {/* Desktop / tablet: inline links */}
      <div className="hidden items-center gap-4 text-sm sm:flex">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="font-medium opacity-80 transition-opacity hover:opacity-100"
          >
            {l.label}
          </Link>
        ))}
        {player ? (
          <>
            <Link
              href={`/user/${encodeURIComponent(player.username)}`}
              className="font-medium opacity-80 transition-opacity hover:opacity-100"
            >
              My Profile
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="cursor-pointer font-medium text-red-600 opacity-80 transition-opacity hover:opacity-100 dark:text-red-400"
            >
              Sign Out
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="font-medium opacity-80 transition-opacity hover:opacity-100"
          >
            Log In
          </Link>
        )}
      </div>

      {/* Mobile: hamburger toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="-mr-1 flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5 sm:hidden dark:hover:bg-white/10"
      >
        <span className="relative block h-3.5 w-5">
          <span
            className={`absolute left-0 block h-0.5 w-5 bg-current transition-transform ${
              open ? "top-1.5 rotate-45" : "top-0"
            }`}
          />
          <span
            className={`absolute left-0 top-1.5 block h-0.5 w-5 bg-current transition-opacity ${
              open ? "opacity-0" : "opacity-100"
            }`}
          />
          <span
            className={`absolute left-0 block h-0.5 w-5 bg-current transition-transform ${
              open ? "top-1.5 -rotate-45" : "top-3"
            }`}
          />
        </span>
      </button>

      {/* Mobile: dropdown panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 border-b border-black/10 bg-background shadow-lg sm:hidden dark:border-white/15">
          <div className="mx-auto flex max-w-3xl flex-col px-4 py-2 text-sm">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-2 py-3 font-medium opacity-90 hover:bg-black/5 dark:hover:bg-white/5"
              >
                {l.label}
              </Link>
            ))}
            {player ? (
              <>
                <Link
                  href={`/user/${encodeURIComponent(player.username)}`}
                  className="rounded-md px-2 py-3 font-medium opacity-90 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  My Profile
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-md px-2 py-3 text-left font-medium text-red-600 hover:bg-black/5 dark:text-red-400 dark:hover:bg-white/5"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md px-2 py-3 font-medium opacity-90 hover:bg-black/5 dark:hover:bg-white/5"
              >
                Log In
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
