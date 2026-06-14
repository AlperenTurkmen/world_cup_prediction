/**
 * POST /api/admin/result — set (or clear) one group match's actual score.
 * Body: { match_no: 1..72, home_goals: int|null, away_goals: int|null }.
 * Both goals must be provided together (or both null to clear). Cookie-protected.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const MAX_GOALS = 99;

function parseGoal(v: unknown): number | null | undefined {
  if (v === null || v === "" || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_GOALS) return undefined; // invalid
  return n;
}

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { match_no?: unknown; home_goals?: unknown; away_goals?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const matchNo = Number(body.match_no);
  if (!Number.isInteger(matchNo) || matchNo < 1 || matchNo > 72) {
    return NextResponse.json({ ok: false, error: "match_no must be 1–72." }, { status: 400 });
  }

  const home = parseGoal(body.home_goals);
  const away = parseGoal(body.away_goals);
  if (home === undefined || away === undefined) {
    return NextResponse.json(
      { ok: false, error: `Scores must be whole numbers between 0 and ${MAX_GOALS}.` },
      { status: 400 },
    );
  }
  if ((home === null) !== (away === null)) {
    return NextResponse.json(
      { ok: false, error: "Enter both scores, or clear both." },
      { status: 400 },
    );
  }

  try {
    const { error } = await getSupabaseAdmin()
      .from("matches")
      .update({ home_goals: home, away_goals: away })
      .eq("match_no", matchNo);
    if (error) {
      console.error("result update failed:", error);
      return NextResponse.json({ ok: false, error: "Could not save the result." }, { status: 500 });
    }
  } catch (err) {
    console.error("result update threw:", err);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, match_no: matchNo, home_goals: home, away_goals: away });
}
