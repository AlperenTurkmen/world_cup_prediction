import Link from "next/link";
import { getCurrentPlayer } from "@/lib/playerAuth";
import ToursClient from "./ToursClient";

export const dynamic = "force-dynamic";

/**
 * /tours — the per-round knockout prediction tours (the "second round of
 * guessing"). Requires a signed-in player (predictions are tied to their entry);
 * the client fetches the live round state from /api/tours.
 */
export default async function ToursPage() {
  const player = await getCurrentPlayer();

  if (!player) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Knockout predictions</h1>
        <p className="mt-3 text-sm opacity-70">
          Once the group stage ends, each knockout round opens a fresh prediction window — predict
          every real matchup, right up until that round&apos;s first kickoff.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>{" "}
          to make your knockout picks.
        </p>
      </main>
    );
  }

  return <ToursClient username={player.username} />;
}
