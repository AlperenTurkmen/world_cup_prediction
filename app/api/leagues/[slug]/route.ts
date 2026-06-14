import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getLeagueBySlug, getMembership } from "@/lib/leagues";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/leagues/[slug]
 * League detail: meta, the viewer's membership, the active-member leaderboard
 * (the global view filtered to active members), and — for the owner — the list
 * of pending join requests. Private leagues are only visible to members.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const { slug } = await params;
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "Please log in to view this league." },
        { status: 401 }
      );
    }

    const league = await getLeagueBySlug(slug);
    if (!league) {
      return NextResponse.json(
        { ok: false, error: "League not found." },
        { status: 404 }
      );
    }

    const membership = await getMembership(league.id, player.id);
    const isOwner = league.owner_id === player.id;

    // Private leagues are only viewable by members (active or pending) / owner.
    if (league.visibility === "private" && !membership) {
      return NextResponse.json(
        { ok: false, error: "This league is private." },
        { status: 403 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: members, error: membersErr } = await supabase
      .from("league_members")
      .select("entry_id, role, status, joined_at, entries ( username )")
      .eq("league_id", league.id);

    if (membersErr) {
      console.error("league members fetch failed:", membersErr);
      return NextResponse.json(
        { ok: false, error: "Could not load league." },
        { status: 500 }
      );
    }

    const activeIds = (members ?? [])
      .filter((m: any) => m.status === "active")
      .map((m: any) => m.entry_id);

    const pending = isOwner
      ? (members ?? [])
          .filter((m: any) => m.status === "pending")
          .map((m: any) => ({
            entryId: m.entry_id,
            username: m.entries?.username ?? "Unknown",
            joinedAt: m.joined_at,
          }))
      : [];

    // Shared scoring restricted to active members + the league's start-game
    // cutoff (applied inside the SQL function).
    let board: any[] = [];
    if (activeIds.length > 0) {
      const { data: rows, error: boardErr } = await supabase.rpc(
        "league_leaderboard",
        { p_league_id: league.id }
      );
      if (boardErr) {
        console.error("league board fetch failed:", boardErr);
        return NextResponse.json(
          { ok: false, error: "Could not load league leaderboard." },
          { status: 500 }
        );
      }
      board = rows ?? [];
    }

    return NextResponse.json({
      ok: true,
      league: {
        name: league.name,
        slug: league.slug,
        visibility: league.visibility,
        joinPolicy: league.join_policy,
        joinCode: isOwner ? league.join_code : undefined,
        isOwner,
        myStatus: membership?.status ?? null,
        memberCount: activeIds.length,
      },
      board,
      pending,
    });
  } catch (err) {
    console.error("GET /api/leagues/[slug] threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leagues/[slug]
 * Owner-only league deletion (cascades to members).
 */
export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const { slug } = await params;
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "You must be logged in." },
        { status: 401 }
      );
    }

    const league = await getLeagueBySlug(slug);
    if (!league) {
      return NextResponse.json(
        { ok: false, error: "League not found." },
        { status: 404 }
      );
    }
    if (league.owner_id !== player.id) {
      return NextResponse.json(
        { ok: false, error: "Only the league owner can delete it." },
        { status: 403 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("leagues").delete().eq("id", league.id);
    if (error) {
      console.error("delete league failed:", error);
      return NextResponse.json(
        { ok: false, error: "Could not delete the league." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/leagues/[slug] threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
