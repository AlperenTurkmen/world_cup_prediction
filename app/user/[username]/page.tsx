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
    .select("id, username, created_at")
    .ilike("username", decodedUsername)
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

  // 3. Fetch followers
  const { data: followersData } = await supabase
    .from("follows")
    .select("follower:entries(id, username)")
    .eq("followed_id", entry.id);

  const followers = (followersData || [])
    .map((f: any) => f.follower)
    .filter(Boolean);

  // 4. Fetch following
  const { data: followingData } = await supabase
    .from("follows")
    .select("followed:entries(id, username)")
    .eq("follower_id", entry.id);

  const following = (followingData || [])
    .map((f: any) => f.followed)
    .filter(Boolean);

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

  // 6. Fetch user predictions
  const { data: predictionsData } = await supabase
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
    .order("match_id", { ascending: true });

  // Map predictions to a clean structure
  const predictions = (predictionsData || []).map((p: any) => ({
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
  }));

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
