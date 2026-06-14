/**
 * GET   /api/admin/eligibility?entry_id=123 — list one user's 72 group
 *       predictions with their match, scoreline, and current validity.
 * PATCH /api/admin/eligibility — flip one prediction's validity (whether it
 *       counts toward scoring). Body: { entry_id, match_id, eligible }.
 *
 * This is the per-prediction override that composes with the global start-game
 * floor: the floor decides the cutoff for everyone; this decides, game by game
 * for a single user, whether an otherwise-eligible prediction counts. Setting a
 * prediction valid still can't beat the other fairness gates (a result logged
 * before the entry was created stays unscored). Cookie-protected.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function parseId(v: unknown): number | null {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const entryId = parseId(new URL(req.url).searchParams.get("entry_id"));
  if (!entryId) {
    return NextResponse.json({ ok: false, error: "Invalid entry id." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("predictions")
    .select(
      "match_id, pred_home, pred_away, is_score_eligible, matches ( match_no, home_team, away_team, kickoff_at, home_goals, away_goals )"
    )
    .eq("entry_id", entryId);

  if (error) {
    console.error("eligibility load failed:", error);
    return NextResponse.json({ ok: false, error: "Could not load predictions." }, { status: 500 });
  }

  const predictions = (data ?? [])
    .map((row: any) => ({
      match_id: row.match_id,
      match_no: row.matches?.match_no as number,
      home_team: row.matches?.home_team as string,
      away_team: row.matches?.away_team as string,
      kickoff_at: (row.matches?.kickoff_at ?? null) as string | null,
      pred_home: row.pred_home as number,
      pred_away: row.pred_away as number,
      is_logged:
        row.matches?.home_goals !== null && row.matches?.away_goals !== null,
      is_score_eligible: row.is_score_eligible as boolean,
    }))
    .sort(
      (a, b) =>
        (a.kickoff_at ?? "9999").localeCompare(b.kickoff_at ?? "9999") ||
        a.match_no - b.match_no
    );

  return NextResponse.json({ ok: true, predictions });
}

export async function PATCH(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { entry_id?: unknown; match_id?: unknown; eligible?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const entryId = parseId(body.entry_id);
  const matchId = parseId(body.match_id);
  if (!entryId || !matchId || typeof body.eligible !== "boolean") {
    return NextResponse.json({ ok: false, error: "Invalid update." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from("predictions")
    .update({ is_score_eligible: body.eligible })
    .eq("entry_id", entryId)
    .eq("match_id", matchId);

  if (error) {
    console.error("eligibility update failed:", error);
    return NextResponse.json({ ok: false, error: "Could not update the prediction." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entry_id: entryId, match_id: matchId, eligible: body.eligible });
}
