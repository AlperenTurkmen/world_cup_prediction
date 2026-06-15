import Link from "next/link";
import { getCurrentPlayer } from "@/lib/playerAuth";
import NavMenu from "./NavMenu";

/** Simple site header with the title and primary nav, shown on every page. */
export default async function Header() {
  const player = await getCurrentPlayer();

  return (
    <header className="relative border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="shrink-0 text-sm font-bold tracking-tight">
          ⚽ WC 2026 Predictions
        </Link>
        <NavMenu player={player} />
      </nav>
    </header>
  );
}
