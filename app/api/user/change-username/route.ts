import { NextResponse } from "next/server";
import { getCurrentPlayer, setPlayerSession } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { MAX_USERNAME_LEN } from "@/lib/manualEntry";

/** Total number of times a player may change their username over their lifetime. */
export const MAX_USERNAME_CHANGES = 3;

export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "You must be logged in to change your username." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const raw = typeof body?.username === "string" ? body.username : "";
    const newUsername = raw.trim();

    if (newUsername.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Please enter a username." },
        { status: 400 }
      );
    }
    if (newUsername.length > MAX_USERNAME_LEN) {
      return NextResponse.json(
        { ok: false, error: `Username must be ${MAX_USERNAME_LEN} characters or fewer.` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Load current name + how many changes have been used so far.
    const { data: current, error: loadErr } = await supabase
      .from("entries")
      .select("username, username_changes_used")
      .eq("id", player.id)
      .maybeSingle();

    if (loadErr || !current) {
      return NextResponse.json(
        { ok: false, error: "Could not load your account. Please try again." },
        { status: 500 }
      );
    }

    const used = current.username_changes_used ?? 0;
    const sameSpelling = newUsername === current.username;
    // A case-only re-spelling of the *same* name (e.g. "sam" -> "Sam") is free.
    const caseOnly = newUsername.toLowerCase() === current.username.toLowerCase();

    // No-op: identical spelling, nothing to do (don't consume a change).
    if (sameSpelling) {
      return NextResponse.json({
        ok: true,
        username: current.username,
        changesUsed: used,
        changesRemaining: Math.max(0, MAX_USERNAME_CHANGES - used),
      });
    }

    // A genuine rename (different name, not just re-casing) consumes one change.
    if (!caseOnly && used >= MAX_USERNAME_CHANGES) {
      return NextResponse.json(
        {
          ok: false,
          error: `You have used all ${MAX_USERNAME_CHANGES} of your username changes.`,
        },
        { status: 403 }
      );
    }

    const nextUsed = caseOnly ? used : used + 1;

    const { error: updateErr } = await supabase
      .from("entries")
      .update({ username: newUsername, username_changes_used: nextUsed })
      .eq("id", player.id);

    if (updateErr) {
      // Unique-index violation on lower(username) — name is taken.
      if (updateErr.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "That username is already taken." },
          { status: 409 }
        );
      }
      console.error("Change username error:", updateErr);
      return NextResponse.json(
        { ok: false, error: "Could not change your username. Please try again." },
        { status: 500 }
      );
    }

    // The username is baked into the session token — re-issue it so the cookie
    // matches the new name.
    await setPlayerSession(player.id, newUsername);

    return NextResponse.json({
      ok: true,
      username: newUsername,
      changesUsed: nextUsed,
      changesRemaining: Math.max(0, MAX_USERNAME_CHANGES - nextUsed),
    });
  } catch (err) {
    console.error("Change username API threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
