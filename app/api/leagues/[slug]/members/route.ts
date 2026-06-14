import { NextResponse } from "next/server";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getLeagueBySlug } from "@/lib/leagues";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * POST /api/leagues/[slug]/members
 * One endpoint for membership mutations. Body { action, entryId? }:
 *   approve / deny  — owner only, acts on a pending entryId
 *   remove          — owner only, removes an active member (not themselves)
 *   leave           — the caller leaves the league (owner cannot leave)
 */
export async function POST(req: Request, { params }: RouteContext) {
  try {
    const { slug } = await params;
    const player = await getCurrentPlayer();
    if (!player) {
      return NextResponse.json(
        { ok: false, error: "You must be logged in." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const targetId = Number(body.entryId);

    const league = await getLeagueBySlug(slug);
    if (!league) {
      return NextResponse.json(
        { ok: false, error: "League not found." },
        { status: 404 }
      );
    }

    const isOwner = league.owner_id === player.id;
    const supabase = getSupabaseAdmin();

    switch (action) {
      case "approve":
      case "deny":
      case "remove": {
        if (!isOwner) {
          return NextResponse.json(
            { ok: false, error: "Only the league owner can manage members." },
            { status: 403 }
          );
        }
        if (!targetId || Number.isNaN(targetId)) {
          return NextResponse.json(
            { ok: false, error: "Invalid member." },
            { status: 400 }
          );
        }
        if (targetId === league.owner_id) {
          return NextResponse.json(
            { ok: false, error: "The owner cannot be removed." },
            { status: 400 }
          );
        }

        if (action === "approve") {
          const { error } = await supabase
            .from("league_members")
            .update({ status: "active" })
            .eq("league_id", league.id)
            .eq("entry_id", targetId)
            .eq("status", "pending");
          if (error) throw error;
        } else {
          // deny (pending) or remove (active): delete the membership row.
          const { error } = await supabase
            .from("league_members")
            .delete()
            .eq("league_id", league.id)
            .eq("entry_id", targetId);
          if (error) throw error;
        }
        return NextResponse.json({ ok: true });
      }

      case "leave": {
        if (isOwner) {
          return NextResponse.json(
            {
              ok: false,
              error: "The owner cannot leave. Delete the league instead.",
            },
            { status: 400 }
          );
        }
        const { error } = await supabase
          .from("league_members")
          .delete()
          .eq("league_id", league.id)
          .eq("entry_id", player.id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json(
          { ok: false, error: "Unknown action." },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("POST /api/leagues/[slug]/members threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
