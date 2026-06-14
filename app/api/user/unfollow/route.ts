import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "You must be logged in to unfollow users." },
        { status: 401 }
      );
    }

    const { followedId } = await req.json();
    const followed_id = Number(followedId);

    if (!followed_id || Number.isNaN(followed_id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid user to unfollow." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    // Delete from follows table
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", player.id)
      .eq("followed_id", followed_id);

    if (error) {
      console.error("Unfollow error:", error);
      return NextResponse.json(
        { ok: false, error: "Could not unfollow user. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Unfollow API threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
