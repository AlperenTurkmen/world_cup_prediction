import Link from "next/link";
import { getCurrentPlayer } from "@/lib/playerAuth";
import PlayerNav from "./PlayerNav";

/** Simple site header with the title and primary nav, shown on every page. */
export default async function Header() {
  const player = await getCurrentPlayer();

  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-sm font-bold tracking-tight">
          ⚽ WC 2026 Predictions
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="font-medium opacity-80 hover:opacity-100">
            Leaderboard
          </Link>
          <Link href="/upload" className="font-medium opacity-80 hover:opacity-100">
            Upload
          </Link>
          <Link href="/tutorial" className="font-medium opacity-80 hover:opacity-100">
            How it works
          </Link>
          <Link href="/leagues" className="font-medium opacity-80 hover:opacity-100">
            Leagues
          </Link>
          <PlayerNav player={player} />
        </div>
      </nav>
    </header>
  );
}
