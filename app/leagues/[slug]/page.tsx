import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getLeagueBySlug, getMembership } from "@/lib/leagues";
import LeaderboardTable, { type LeaderboardRow } from "../../LeaderboardTable";
import LeagueActions from "./LeagueActions";

export const dynamic = "force-dynamic";

interface LeaguePageProps {
  params: Promise<{ slug: string }>;
}

interface MemberRow {
  entryId: number;
  username: string;
  role: string;
}

export default async function LeaguePage({ params }: LeaguePageProps) {
  const { slug } = await params;

  const player = await getCurrentPlayer();
  if (!player) {
    redirect(`/login?redirectTo=/leagues/${slug}`);
  }

  const league = await getLeagueBySlug(slug);
  if (!league) return notFound();

  const membership = await getMembership(league.id, player.id);
  const isOwner = league.owner_id === player.id;

  // Private leagues are only viewable by members / owner.
  if (league.visibility === "private" && !membership) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">{league.name}</h1>
        <p className="mt-3 text-sm opacity-70">
          This is a private league. You need an invite link to join.
        </p>
        <Link href="/leagues" className="mt-4 inline-block text-sm underline">
          ← Back to leagues
        </Link>
      </main>
    );
  }

  const supabase = getSupabaseAdmin();

  // The chosen "start scoring from" game (if any), for display.
  let startGameLabel: string | null = null;
  if (league.start_match_id) {
    const { data: sm } = await supabase
      .from("matches")
      .select("match_no, home_team, away_team")
      .eq("id", league.start_match_id)
      .maybeSingle();
    if (sm) startGameLabel = `Game ${sm.match_no} — ${sm.home_team} vs ${sm.away_team}`;
  }

  const { data: members } = await supabase
    .from("league_members")
    .select("entry_id, role, status, joined_at, entries ( username, is_hidden )")
    .eq("league_id", league.id);

  const activeMembers: MemberRow[] = (members ?? [])
    .filter((m: any) => m.status === "active" && !m.entries?.is_hidden)
    .map((m: any) => ({
      entryId: m.entry_id,
      username: m.entries?.username ?? "Unknown",
      role: m.role,
    }));

  const activeIds = activeMembers.map((m) => m.entryId);

  const pending = isOwner
    ? (members ?? [])
        .filter((m: any) => m.status === "pending" && !m.entries?.is_hidden)
        .map((m: any) => ({
          entryId: m.entry_id,
          username: m.entries?.username ?? "Unknown",
        }))
    : [];

  // The league board: shared scoring restricted to active members and computed
  // from the league's start game onward (the SQL function applies the cutoff).
  let board: LeaderboardRow[] = [];
  if (activeIds.length > 0) {
    const { data: rows, error: boardErr } = await supabase.rpc(
      "league_leaderboard",
      { p_league_id: league.id }
    );
    if (!boardErr) board = (rows ?? []) as LeaderboardRow[];
  }

  const isPendingViewer = membership?.status === "pending";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/leagues" className="text-xs opacity-60 hover:underline">
            ← All leagues
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{league.name}</h1>
          <p className="mt-1 text-sm opacity-60">
            {league.visibility === "private" ? "Private league" : "Public league"} ·{" "}
            {activeMembers.length} {activeMembers.length === 1 ? "member" : "members"}
          </p>
          {startGameLabel && (
            <p className="mt-1 text-xs opacity-60">
              Scoring from {startGameLabel}
            </p>
          )}
        </div>
      </div>

      {isPendingViewer && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Your request to join is awaiting the owner&apos;s approval.
        </div>
      )}

      <LeagueActions
        slug={league.slug}
        isOwner={isOwner}
        joinCode={isOwner ? league.join_code : null}
        canLeave={!!membership && !isOwner}
        pending={pending}
        members={activeMembers.filter((m) => m.role !== "owner")}
      />

      {/* ── League leaderboard ── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Leaderboard</h2>
        {board.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">
            No active members with predictions yet.
          </p>
        ) : (
          <LeaderboardTable rows={board} />
        )}
      </section>
    </main>
  );
}
