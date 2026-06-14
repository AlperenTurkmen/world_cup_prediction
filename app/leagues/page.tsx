import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getMatches } from "@/lib/adminData";
import CreateLeagueForm, { type StartGameOption } from "./CreateLeagueForm";
import JoinByCode from "./JoinByCode";
import JoinButton from "./JoinButton";

export const dynamic = "force-dynamic";

interface MyLeague {
  id: number;
  name: string;
  slug: string;
  visibility: string;
  status: string;
  role: string;
}

interface PublicLeague {
  id: number;
  name: string;
  slug: string;
  memberCount: number;
  isMember: boolean;
}

async function getData(playerId: number) {
  const supabase = getSupabaseAdmin();

  const [mineRes, publicRes] = await Promise.all([
    supabase
      .from("league_members")
      .select("status, role, leagues ( id, name, slug, visibility )")
      .eq("entry_id", playerId),
    supabase
      .from("leagues")
      .select("id, name, slug, league_members ( entry_id, status )")
      .eq("visibility", "public")
      .order("created_at", { ascending: false }),
  ]);

  const myLeagues: MyLeague[] = (mineRes.data ?? [])
    .map((m: any) => ({
      id: m.leagues?.id,
      name: m.leagues?.name,
      slug: m.leagues?.slug,
      visibility: m.leagues?.visibility,
      status: m.status,
      role: m.role,
    }))
    .filter((l: MyLeague) => l.id);

  const myIds = new Set(myLeagues.map((l) => l.id));

  const publicLeagues: PublicLeague[] = (publicRes.data ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    memberCount: (l.league_members ?? []).filter(
      (m: any) => m.status === "active"
    ).length,
    isMember: myIds.has(l.id),
  }));

  return { myLeagues, publicLeagues };
}

export default async function LeaguesPage() {
  const player = await getCurrentPlayer();
  if (!player) {
    redirect("/login?redirectTo=/leagues");
  }

  const { myLeagues, publicLeagues } = await getData(player.id);

  // Group games in chronological order for the "start scoring from" dropdown.
  let startGames: StartGameOption[] = [];
  try {
    const matches = await getMatches();
    startGames = matches.map((m) => ({
      id: m.id,
      label: `Game ${m.match_no} — ${m.home_team} vs ${m.away_team}${
        m.kickoff_at
          ? ` (${new Date(m.kickoff_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })})`
          : ""
      }`,
    }));
  } catch {
    startGames = [];
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Leagues</h1>
      <p className="mt-1 text-sm opacity-70">
        Compete in your own group. Each league has its own leaderboard.
      </p>

      {/* ── My leagues ── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">My leagues</h2>
        {myLeagues.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">
            You haven&apos;t joined any leagues yet. Create one or join with a code below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-black/5 dark:divide-white/10">
            {myLeagues.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-3">
                <div>
                  <Link href={`/leagues/${l.slug}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                  <span className="ml-2 text-xs opacity-60">
                    {l.visibility === "private" ? "Private" : "Public"}
                    {l.role === "owner" && " · Owner"}
                  </span>
                </div>
                {l.status === "pending" ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                    Pending approval
                  </span>
                ) : (
                  <Link
                    href={`/leagues/${l.slug}`}
                    className="text-sm font-medium opacity-80 hover:opacity-100"
                  >
                    View →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Create + join by code ── */}
      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
          <h2 className="text-lg font-semibold">Create a league</h2>
          <CreateLeagueForm startGames={startGames} />
        </div>
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
          <h2 className="text-lg font-semibold">Join with a code</h2>
          <JoinByCode />
        </div>
      </section>

      {/* ── Public directory ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Public leagues</h2>
        {publicLeagues.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">No public leagues yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-black/5 dark:divide-white/10">
            {publicLeagues.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-3">
                <div>
                  <Link href={`/leagues/${l.slug}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                  <span className="ml-2 text-xs opacity-60">
                    {l.memberCount} {l.memberCount === 1 ? "member" : "members"}
                  </span>
                </div>
                {l.isMember ? (
                  <span className="text-xs opacity-60">Joined</span>
                ) : (
                  <JoinButton slug={l.slug} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
