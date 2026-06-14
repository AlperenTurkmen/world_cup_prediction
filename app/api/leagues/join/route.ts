import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getLeagueByCode, getLeagueBySlug, getMembership } from "@/lib/leagues";

/**
 * POST /api/leagues/join
 * Join a league by { code } or { slug }. Open leagues add you as active; an
 * approval-policy league adds you as pending (a request the owner must OK).
 * Idempotent: re-joining returns your existing status. Auth required.
 */
export async function POST(req: Request) {
  try {
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "You must be logged in to join a league." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";

    if (!code && !slug) {
      return NextResponse.json(
        { ok: false, error: "Provide a league code or slug." },
        { status: 400 }
      );
    }

    const league = code
      ? await getLeagueByCode(code)
      : await getLeagueBySlug(slug);

    if (!league) {
      return NextResponse.json(
        { ok: false, error: "No league found for that code or link." },
        { status: 404 }
      );
    }

    // A private league can only be discovered via its code, never by slug guess.
    if (league.visibility === "private" && !code) {
      return NextResponse.json(
        { ok: false, error: "This league is private — you need an invite link." },
        { status: 403 }
      );
    }

    const existing = await getMembership(league.id, player.id);
    if (existing) {
      return NextResponse.json({
        ok: true,
        slug: league.slug,
        status: existing.status,
        alreadyMember: true,
      });
    }

    const status = league.join_policy === "open" ? "active" : "pending";

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("league_members").insert({
      league_id: league.id,
      entry_id: player.id,
      role: "member",
      status,
    });

    if (error) {
      // Concurrent insert — treat as already a member.
      if (error.code === "23505") {
        const m = await getMembership(league.id, player.id);
        return NextResponse.json({
          ok: true,
          slug: league.slug,
          status: m?.status ?? status,
          alreadyMember: true,
        });
      }
      console.error("join league failed:", error);
      return NextResponse.json(
        { ok: false, error: "Could not join the league. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, slug: league.slug, status });
  } catch (err) {
    console.error("POST /api/leagues/join threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
