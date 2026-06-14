/**
 * POST /api/admin/advancers — replace the set of teams that actually reached a
 * round. Body: { round: 'R32'|'R16'|'QF'|'SF'|'FINAL'|'CHAMPION', teams: string[] }.
 * Team names are validated against the canonical 48-team list. Cookie-protected.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ADV_ROUNDS, getCanonicalTeams } from "@/lib/adminData";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { round?: unknown; teams?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const round = body.round;
  if (typeof round !== "string" || !(ADV_ROUNDS as readonly string[]).includes(round)) {
    return NextResponse.json({ ok: false, error: "Invalid round." }, { status: 400 });
  }

  if (!Array.isArray(body.teams) || body.teams.some((t) => typeof t !== "string")) {
    return NextResponse.json({ ok: false, error: "teams must be an array of names." }, { status: 400 });
  }
  const teams = Array.from(new Set((body.teams as string[]).map((t) => t.trim())));

  if (round === "CHAMPION" && teams.length > 1) {
    return NextResponse.json({ ok: false, error: "Only one champion allowed." }, { status: 400 });
  }

  try {
    // Validate every name against the canonical list.
    const canonical = new Set(await getCanonicalTeams());
    const unknown = teams.find((t) => !canonical.has(t));
    if (unknown) {
      return NextResponse.json(
        { ok: false, error: `"${unknown}" is not one of the 48 tournament teams.` },
        { status: 400 },
      );
    }

    const { error } = await getSupabaseAdmin().rpc("replace_actual_advancers", {
      p_round: round,
      p_teams: teams,
    });
    if (error) {
      console.error("replace_actual_advancers failed:", error);
      return NextResponse.json({ ok: false, error: "Could not save advancers." }, { status: 500 });
    }
  } catch (err) {
    console.error("advancers save threw:", err);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, round, count: teams.length });
}
