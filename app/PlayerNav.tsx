"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

interface PlayerNavProps {
  player: {
    id: number;
    username: string;
  } | null;
}

export default function PlayerNav({ player }: PlayerNavProps) {
  const router = useRouter();

  async function handleLogout() {
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

  if (player) {
    return (
      <div className="flex items-center gap-4">
        <Link
          href={`/user/${encodeURIComponent(player.username)}`}
          className="font-medium opacity-80 hover:opacity-100 transition-opacity"
        >
          My Profile
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="font-medium text-red-600 dark:text-red-400 opacity-80 hover:opacity-100 transition-opacity cursor-pointer text-sm"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className="font-medium opacity-80 hover:opacity-100 transition-opacity"
    >
      Log In
    </Link>
  );
}
