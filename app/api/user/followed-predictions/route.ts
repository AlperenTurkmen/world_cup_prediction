import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const matchIdStr = searchParams.get("matchId");
    const matchNoStr = searchParams.get("matchNo");

    const isKnockout = matchNoStr !== null;
    const matchId = matchIdStr ? Number(matchIdStr) : null;
    const matchNo = matchNoStr ? Number(matchNoStr) : null;

    if (isKnockout ? (matchNo === null || Number.isNaN(matchNo)) : (matchId === null || Number.isNaN(matchId))) {
      return NextResponse.json(
        { ok: false, error: "Invalid match parameter." },
        { status: 400 }
      );
    }

    // Viewing picks is public — anonymous visitors see everyone's picks too.
    // A logged-in player additionally gets their own pick split out and their
    // followed users prioritised in the list.
    const player = await getCurrentPlayer();
    const supabase = getSupabaseAdmin();

    // 1. Followed user IDs (only relevant when logged in) and every prediction
    //    logged for this match, in parallel.
    const [followsRes, predsRes] = await Promise.all([
      player
        ? supabase.from("follows").select("followed_id").eq("follower_id", player.id)
        : Promise.resolve({ data: [], error: null }),
      isKnockout
        ? supabase
            .from("round_tour_predictions")
            .select("entry_id, pred_home, pred_away, penalty_winner, entries ( username, is_hidden )")
            .eq("match_no", matchNo!)
        : supabase
            .from("predictions")
            .select("entry_id, pred_home, pred_away, entries ( username, is_hidden )")
            .eq("match_id", matchId!),
    ]);

    if (followsRes.error) {
      console.error("Error fetching follows:", followsRes.error);
      return NextResponse.json(
        { ok: false, error: "Could not fetch followed users." },
        { status: 500 }
      );
    }
    if (predsRes.error) {
      console.error("Error fetching predictions:", predsRes.error);
      return NextResponse.json(
        { ok: false, error: "Could not fetch predictions." },
        { status: 500 }
      );
    }

    const followedSet = new Set((followsRes.data ?? []).map((f: any) => f.followed_id));
    const selfId = player?.id ?? null;

    // 2. Split the current player's own pick out; collect everyone else's
    //    (non-hidden) picks, flagging the ones the viewer follows.
    let myPrediction: { username: string; predHome: number; predAway: number } | null = null;
    const predictions: {
      username: string;
      predHome: number;
      predAway: number;
      isFollowed: boolean;
    }[] = [];

    for (const p of (predsRes.data ?? []) as any[]) {
      if (selfId !== null && p.entry_id === selfId) {
        myPrediction = {
          username: player!.username,
          predHome: p.pred_home,
          predAway: p.pred_away,
        };
        continue;
      }
      if (!p.entries || p.entries.is_hidden) continue;
      predictions.push({
        username: p.entries.username || "Unknown",
        predHome: p.pred_home,
        predAway: p.pred_away,
        isFollowed: followedSet.has(p.entry_id),
      });
    }

    // 3. Followed users first, then everyone else; alphabetical within each group.
    predictions.sort((a, b) => {
      if (a.isFollowed !== b.isFollowed) return a.isFollowed ? -1 : 1;
      return a.username.localeCompare(b.username);
    });

    return NextResponse.json({ ok: true, myPrediction, predictions });
  } catch (err) {
    console.error("Predictions API threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
