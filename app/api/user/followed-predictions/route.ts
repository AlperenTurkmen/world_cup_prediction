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
    if (followedIds.length === 0) {
      return NextResponse.json({ ok: true, predictions: [] });
    }

    // 2. Fetch predictions for this match by followed users
    const { data: preds, error: predsErr } = await supabase
      .from("predictions")
      .select(`
        pred_home,
        pred_away,
        entries (
          username
        )
      `)
      .eq("match_id", matchId)
      .in("entry_id", followedIds);

    if (predsErr) {
      console.error("Error fetching followed predictions:", predsErr);
      return NextResponse.json(
        { ok: false, error: "Could not fetch predictions." },
        { status: 500 }
      );
    }

    const results = (preds || []).map((p: any) => ({
      username: p.entries?.username || "Unknown",
      predHome: p.pred_home,
      predAway: p.pred_away,
    }));

    return NextResponse.json({ ok: true, predictions: results });
  } catch (err) {
    console.error("Followed predictions API threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
