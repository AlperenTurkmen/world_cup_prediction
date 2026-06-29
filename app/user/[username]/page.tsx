import { notFound } from "next/navigation";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActualAdvancers } from "@/lib/adminData";
import ProfileClient from "./ProfileClient";

export const dynamic = "force-dynamic";

interface UserPageProps {
  params: Promise<{
    username: string;
  }>;
}

export default async function UserProfilePage({ params }: UserPageProps) {
  const { username: rawUsername } = await params;
  const decodedUsername = decodeURIComponent(rawUsername);

  const supabase = getSupabaseAdmin();

  // 1. Fetch user entry by username (case-insensitive)
  const { data: entry, error: entryErr } = await supabase
    .from("entries")
    .select("id, username, created_at, username_changes_used")
    .ilike("username", decodedUsername)
    .eq("is_hidden", false)
    .single();

  if (entryErr || !entry) {
    return notFound();
  }

  // 2. Fetch all leaderboard rows to compute rank and retrieve scores
  const { data: boardRows } = await supabase
    .from("leaderboard")
    .select("*")
    .order("total", { ascending: false })
    .order("exact_count", { ascending: false })
    .order("created_at", { ascending: true });

  const rankIndex = boardRows?.findIndex((r: any) => r.entry_id === entry.id) ?? -1;
  const rank = rankIndex !== -1 ? rankIndex + 1 : null;
  const stats = rankIndex !== -1 ? boardRows?.[rankIndex] : null;

  // 3. Fetch followers. `follows` has two FKs to `entries` (follower_id and
  // followed_id), so the embed must name the constraint to disambiguate —
  // otherwise PostgREST returns an error and the list comes back empty.
  const { data: followersData, error: followersErr } = await supabase
    .from("follows")
    .select("follower:entries!follows_follower_id_fkey(id, username, is_hidden)")
    .eq("followed_id", entry.id);
  if (followersErr) console.error("Error fetching followers:", followersErr);

  const followers = (followersData || [])
    .map((f: any) => f.follower)
    .filter((f: any) => f && !f.is_hidden);

  // 4. Fetch following (same disambiguation, via the followed_id FK).
  const { data: followingData, error: followingErr } = await supabase
    .from("follows")
    .select("followed:entries!follows_followed_id_fkey(id, username, is_hidden)")
    .eq("follower_id", entry.id);
  if (followingErr) console.error("Error fetching following:", followingErr);

  const following = (followingData || [])
    .map((f: any) => f.followed)
    .filter((f: any) => f && !f.is_hidden);

  // 5. Check if logged-in visitor is following this profile
  const currentUser = await getCurrentPlayer();
  let isFollowing = false;
  if (currentUser && currentUser.id !== entry.id) {
    const { count } = await supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", currentUser.id)
      .eq("followed_id", entry.id);
    isFollowing = (count ?? 0) > 0;
  }

  // 6. Fetch user predictions (group stage + knockout tour), and actual knockout matches
  const [predictionsRes, tourPredictionsRes, actualKnockoutRes] = await Promise.all([
    supabase
      .from("predictions")
      .select(`
        pred_home,
        pred_away,
        is_score_eligible,
        matches (
          id,
          match_no,
          home_team,
          away_team,
          kickoff_at,
          home_goals,
          away_goals,
          result_logged_at
        )
      `)
      .eq("entry_id", entry.id)
      .order("match_id", { ascending: true }),
    supabase
      .from("round_tour_predictions")
      .select("match_no, pred_home, pred_away, penalty_winner, updated_at")
      .eq("entry_id", entry.id),
    supabase
      .from("actual_knockout_matches")
      .select("match_no, home_team, away_team, kickoff_at, home_goals, away_goals, result_logged_at"),
  ]);

  // Map group predictions to a clean structure
  const groupPredictions = (predictionsRes.data || [])
    .map((p: any) => ({
      predHome: p.pred_home,
      predAway: p.pred_away,
      isScoreEligible: p.is_score_eligible,
      matchId: p.matches?.id,
      matchNo: p.matches?.match_no,
      homeTeam: p.matches?.home_team,
      awayTeam: p.matches?.away_team,
      kickoffAt: p.matches?.kickoff_at,
      homeGoals: p.matches?.home_goals,
      awayGoals: p.matches?.away_goals,
      resultLoggedAt: p.matches?.result_logged_at,
      isKnockout: false as const,
    }));

  // Map knockout tour predictions, joined with actual knockout matches
  const actualKnockoutMap = new Map(
    (actualKnockoutRes.data || []).map((m: any) => [m.match_no, m])
  );
  const tourPredictions = (tourPredictionsRes.data || [])
    .map((p: any) => {
      const actual = actualKnockoutMap.get(p.match_no);
      if (!actual) return null;
      return {
        predHome: p.pred_home,
        predAway: p.pred_away,
        isScoreEligible: true,
        matchId: null,
        matchNo: p.match_no,
        homeTeam: actual.home_team,
        awayTeam: actual.away_team,
        kickoffAt: actual.kickoff_at,
        homeGoals: actual.home_goals,
        awayGoals: actual.away_goals,
        resultLoggedAt: actual.result_logged_at,
        isKnockout: true as const,
        penaltyWinner: p.penalty_winner ?? null,
      };
    })
    .filter(Boolean);

  // Merge and sort all predictions chronologically
  const predictions = ([...groupPredictions, ...tourPredictions] as NonNullable<typeof tourPredictions[number]>[]).sort((a, b) => {
    const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return (a.matchNo ?? 0) - (b.matchNo ?? 0);
  });

  // 7. Fetch knockout predictions
  const { data: knockPredictions } = await supabase
    .from("advancement_predictions")
    .select("round, team")
    .eq("entry_id", entry.id);

  // 8. Fetch actual advancers
  const actualAdvancers = await getActualAdvancers();

  // 9. Fetch scoring & round weights for display details
  const [weightsRes, roundWeightsRes] = await Promise.all([
    supabase.from("scoring_weights").select("key, value"),
    supabase.from("round_weights").select("round, weight"),
  ]);

  const scoringWeights = (weightsRes.data || []).reduce((acc: any, cur: any) => {
    acc[cur.key] = cur.value;
    return acc;
  }, {});

  const roundWeights = (roundWeightsRes.data || []).reduce((acc: any, cur: any) => {
    acc[cur.round] = cur.weight;
    return acc;
  }, {});

  return (
    <ProfileClient
      profileId={entry.id}
      username={entry.username}
      createdAt={entry.created_at}
      usernameChangesUsed={entry.username_changes_used ?? 0}
      rank={rank}
      stats={stats}
      followers={followers}
      following={following}
      currentUser={currentUser}
      isFollowingInitial={isFollowing}
      predictions={predictions}
      knockoutPredictions={knockPredictions || []}
      actualAdvancers={actualAdvancers}
      scoringWeights={scoringWeights}
      roundWeights={roundWeights}
    />
  );
}
