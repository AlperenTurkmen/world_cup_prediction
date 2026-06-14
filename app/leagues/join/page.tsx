import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getLeagueByCode, getMembership } from "@/lib/leagues";
import ConfirmJoin from "./ConfirmJoin";

export const dynamic = "force-dynamic";

interface JoinPageProps {
  searchParams: Promise<{ code?: string }>;
}

export default async function JoinLeaguePage({ searchParams }: JoinPageProps) {
  const { code } = await searchParams;

  if (!code) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Invalid invite link</h1>
        <p className="mt-2 text-sm opacity-70">This link is missing its code.</p>
        <Link href="/leagues" className="mt-4 inline-block text-sm underline">
          Browse leagues
        </Link>
      </main>
    );
  }

  const player = await getCurrentPlayer();
  if (!player) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/leagues/join?code=${code}`)}`);
  }

  const league = await getLeagueByCode(code);
  if (!league) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-bold">League not found</h1>
        <p className="mt-2 text-sm opacity-70">
          This invite link is invalid or the league no longer exists.
        </p>
        <Link href="/leagues" className="mt-4 inline-block text-sm underline">
          Browse leagues
        </Link>
      </main>
    );
  }

  // Already a member? Go straight to the league.
  const membership = await getMembership(league.id, player.id);
  if (membership?.status === "active") {
    redirect(`/leagues/${league.slug}`);
  }

  const needsApproval = league.join_policy === "approval";

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-bold">{league.name}</h1>
      <p className="mt-2 text-sm opacity-70">
        {membership?.status === "pending"
          ? "Your request to join is awaiting approval."
          : needsApproval
          ? "You've been invited. Request to join — the owner will approve you."
          : "You've been invited to this league."}
      </p>
      {membership?.status !== "pending" && (
        <div className="mt-6">
          <ConfirmJoin code={code} needsApproval={needsApproval} />
        </div>
      )}
      <Link href="/leagues" className="mt-4 inline-block text-sm underline opacity-70">
        ← All leagues
      </Link>
    </main>
  );
}
