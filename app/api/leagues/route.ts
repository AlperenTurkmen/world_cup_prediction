import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  generateUniqueJoinCode,
  generateUniqueSlug,
  type LeagueJoinPolicy,
  type LeagueVisibility,
} from "@/lib/leagues";

/**
 * GET /api/leagues
 * Returns the player's own leagues (with their membership status) and the
 * public-league directory with member counts. Auth required.
 */
export async function GET() {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "Please log in to see leagues." },
        { status: 401 }
      );
    }

    const supabase = getSupabaseAdmin();

    const [mineRes, publicRes] = await Promise.all([
      supabase
        .from("league_members")
        .select("status, role, leagues ( id, name, slug, visibility, join_policy, is_hidden )")
        .eq("entry_id", player.id),
      supabase
        .from("leagues")
        .select("id, name, slug, league_members ( entry_id )")
        .eq("visibility", "public")
        .eq("is_hidden", false)
        .order("created_at", { ascending: false }),
    ]);

    if (mineRes.error || publicRes.error) {
      console.error("leagues list failed:", mineRes.error || publicRes.error);
      return NextResponse.json(
        { ok: false, error: "Could not load leagues." },
        { status: 500 }
      );
    }

    const myLeagues = (mineRes.data ?? []).map((m: any) => ({
      ...m.leagues,
      status: m.status,
      role: m.role,
    })).filter((l: any) => l.id && !l.is_hidden);

    const publicLeagues = (publicRes.data ?? []).map((l: any) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      memberCount: (l.league_members ?? []).length,
    }));

    return NextResponse.json({ ok: true, myLeagues, publicLeagues });
  } catch (err) {
    console.error("GET /api/leagues threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leagues
 * Create a league owned by the current player. Body: { name, visibility,
 * joinPolicy }. Public leagues are forced to join_policy='open'. The owner is
 * inserted as an active 'owner' member. Auth required.
 */
export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "You must be logged in to create a league." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const visibility: LeagueVisibility =
      body.visibility === "public" ? "public" : "private";
    // Public leagues are always open-join; private leagues honour the choice.
    const joinPolicy: LeagueJoinPolicy =
      visibility === "public"
        ? "open"
        : body.joinPolicy === "open"
        ? "open"
        : "approval";

    if (name.length < 1 || name.length > 60) {
      return NextResponse.json(
        { ok: false, error: "League name must be 1–60 characters." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Optional "start scoring from this game". null = whole tournament.
    let startMatchId: number | null = null;
    if (body.startMatchId !== null && body.startMatchId !== undefined && body.startMatchId !== "") {
      const n = Number(body.startMatchId);
      if (!Number.isInteger(n)) {
        return NextResponse.json(
          { ok: false, error: "Invalid start game." },
          { status: 400 }
        );
      }
      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("id", n)
        .maybeSingle();
      if (!match) {
        return NextResponse.json(
          { ok: false, error: "That start game does not exist." },
          { status: 400 }
        );
      }
      startMatchId = n;
    }
    const [slug, joinCode] = await Promise.all([
      generateUniqueSlug(name),
      generateUniqueJoinCode(),
    ]);

    const { data: league, error: leagueErr } = await supabase
      .from("leagues")
      .insert({
        name,
        slug,
        visibility,
        join_policy: joinPolicy,
        join_code: joinCode,
        owner_id: player.id,
        start_match_id: startMatchId,
      })
      .select("id, slug, join_code")
      .single();

    if (leagueErr || !league) {
      console.error("create league failed:", leagueErr);
      return NextResponse.json(
        { ok: false, error: "Could not create league. Please try again." },
        { status: 500 }
      );
    }

    const { error: memberErr } = await supabase.from("league_members").insert({
      league_id: league.id,
      entry_id: player.id,
      role: "owner",
      status: "active",
    });

    if (memberErr) {
      // Roll back the league so we don't leave an owner-less shell.
      await supabase.from("leagues").delete().eq("id", league.id);
      console.error("create owner membership failed:", memberErr);
      return NextResponse.json(
        { ok: false, error: "Could not create league. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      slug: league.slug,
      joinCode: league.join_code,
    });
  } catch (err) {
    console.error("POST /api/leagues threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
