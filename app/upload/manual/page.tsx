import Link from "next/link";
import { getPendingGoogleIdentity } from "@/lib/googleAuth";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sanitizeGroupScores, sanitizeKoWinners } from "@/lib/manualEntry";
import ManualEntry, { type ClientFixture } from "../ManualEntry";

export const dynamic = "force-dynamic";

export default async function ManualEntryPage() {
  const [player, googleIdentity] = await Promise.all([
    getCurrentPlayer(),
    getPendingGoogleIdentity(),
  ]);

  if (player) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">You already have an entry</h1>
        <p className="mt-2 text-sm opacity-70">
          You are signed in as <strong>{player.username}</strong>. Each username enters once,
          and entries are immutable.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium underline">
          View the leaderboard
        </Link>
      </main>
    );
  }

  if (!googleIdentity) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Enter your predictions</h1>
        <p className="mt-2 text-sm opacity-70">
          Sign in with Google first. Your account is linked to the new entry and lets you save
          progress and come back later.
        </p>
        <Link
          href="/api/auth/google/start?redirectTo=%2Fupload%2Fmanual"
          className="mt-8 inline-flex justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-95"
        >
          Continue with Google
        </Link>
      </main>
    );
  }

  const supabase = getSupabaseAdmin();
  const [matchesRes, groupsRes, draftRes] = await Promise.all([
    supabase.from("matches").select("match_no, home_team, away_team, kickoff_at").order("match_no"),
    supabase.from("team_groups").select("team, group_letter"),
    supabase
      .from("entry_drafts")
      .select("username, group_scores, ko_winners")
      .eq("google_sub", googleIdentity.sub)
      .maybeSingle(),
  ]);

  if (matchesRes.error || groupsRes.error || (matchesRes.data?.length ?? 0) !== 72) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Manual entry isn&apos;t ready</h1>
        <p className="mt-2 text-sm opacity-70">
          The tournament fixtures aren&apos;t set up yet. Please try again later, or upload the
          Excel workbook instead.
        </p>
        <Link href="/upload" className="mt-6 inline-block text-sm font-medium underline">
          Back to upload
        </Link>
      </main>
    );
  }

  const groupOf = new Map<string, string>();
  for (const g of (groupsRes.data ?? []) as Array<{ team: string; group_letter: string }>) {
    groupOf.set(g.team, g.group_letter);
  }

  const now = Date.now();
  const fixtures: ClientFixture[] = (matchesRes.data as Array<{
    match_no: number;
    home_team: string;
    away_team: string;
    kickoff_at: string | null;
  }>).map((m) => ({
    matchNo: m.match_no,
    home: m.home_team,
    away: m.away_team,
    group: groupOf.get(m.home_team) ?? "?",
    kickoffAt: m.kickoff_at,
    started: m.kickoff_at != null && new Date(m.kickoff_at).getTime() <= now,
  }));

  const draft = draftRes.data
    ? {
        username: draftRes.data.username ?? "",
        groupScores: sanitizeGroupScores(draftRes.data.group_scores),
        koWinners: sanitizeKoWinners(draftRes.data.ko_winners),
      }
    : null;

  return (
    <ManualEntry googleEmail={googleIdentity.email} fixtures={fixtures} initialDraft={draft} />
  );
}
