import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "You must be logged in to follow users." },
        { status: 401 }
      );
    }

    const { followedId } = await req.json();
    const followed_id = Number(followedId);

    if (!followed_id || Number.isNaN(followed_id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid user to follow." },
        { status: 400 }
      );
    }

    if (player.id === followed_id) {
      return NextResponse.json(
        { ok: false, error: "You cannot follow yourself." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    // Insert into follows table
    const { error } = await supabase
      .from("follows")
      .insert({
        follower_id: player.id,
        followed_id: followed_id,
      });

    if (error) {
      // Duplicate follow
      if (error.code === "23505") {
        return NextResponse.json({ ok: true }); // already following
      }
      console.error("Follow error:", error);
      return NextResponse.json(
        { ok: false, error: "Could not follow user. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Follow API threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
