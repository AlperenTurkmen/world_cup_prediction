/**
 * POST /api/admin/global-start — set (or clear) the tournament-wide start-game
 * floor for the PUBLIC leaderboard. Body: { match_id: number | null }.
 * When set, the global board scores group-match points only from that game
 * onward (chronologically) — exactly the per-league cutoff, applied globally.
 * null clears the floor (whole tournament). Cookie-protected.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { match_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // null/empty clears the floor; otherwise it must be a real match id.
  let matchId: number | null;
  if (body.match_id === null || body.match_id === undefined || body.match_id === "") {
    matchId = null;
  } else {
    const n = Number(body.match_id);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid start game." }, { status: 400 });
    }
    matchId = n;
  }

  const supabase = getSupabaseAdmin();

  if (matchId !== null) {
    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .select("id")
      .eq("id", matchId)
      .maybeSingle();
    if (matchErr) {
      console.error("global-start match lookup failed:", matchErr);
      return NextResponse.json({ ok: false, error: "Could not verify the game." }, { status: 500 });
    }
    if (!match) {
      return NextResponse.json({ ok: false, error: "That game does not exist." }, { status: 400 });
    }
  }

  // app_settings is a singleton (id = 1); the schema seeds the row, but upsert
  // keeps this route correct even on a fresh database.
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: 1, global_start_match_id: matchId }, { onConflict: "id" });

  if (error) {
    console.error("global-start update failed:", error);
    return NextResponse.json({ ok: false, error: "Could not save the start game." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, match_id: matchId });
}
