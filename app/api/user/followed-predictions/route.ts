import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const matchIdStr = searchParams.get("matchId");
    const matchId = Number(matchIdStr);

    if (!matchIdStr || Number.isNaN(matchId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid matchId parameter." },
        { status: 400 }
      );
    }

    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "Please log in to see followed users' predictions." },
        { status: 401 }
      );
    }

    const supabase = getSupabaseAdmin();

    // 1. Fetch followed users IDs
    const { data: follows, error: followsErr } = await supabase
      .from("follows")
      .select("followed_id")
      .eq("follower_id", player.id);

    if (followsErr) {
      console.error("Error fetching follows:", followsErr);
      return NextResponse.json(
        { ok: false, error: "Could not fetch followed users." },
        { status: 500 }
      );
    }

    const followedIds = follows?.map((f) => f.followed_id) || [];

    // 2. Fetch current user's own prediction + followed users' predictions in parallel
    const [myPredRes, predsRes] = await Promise.all([
      supabase
        .from("predictions")
        .select("pred_home, pred_away")
        .eq("match_id", matchId)
        .eq("entry_id", player.id)
        .maybeSingle(),
      followedIds.length > 0
        ? supabase
            .from("predictions")
            .select("pred_home, pred_away, entries ( username )")
            .eq("match_id", matchId)
            .in("entry_id", followedIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (predsRes.error) {
      console.error("Error fetching followed predictions:", predsRes.error);
      return NextResponse.json(
        { ok: false, error: "Could not fetch predictions." },
        { status: 500 }
      );
    }

    const myPrediction = myPredRes.data
      ? { username: player.username, predHome: myPredRes.data.pred_home, predAway: myPredRes.data.pred_away }
      : null;

    const friendPredictions = (predsRes.data || []).map((p: any) => ({
      username: p.entries?.username || "Unknown",
      predHome: p.pred_home,
      predAway: p.pred_away,
    }));

    return NextResponse.json({ ok: true, myPrediction, friendPredictions });
  } catch (err) {
    console.error("Followed predictions API threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
