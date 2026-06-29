/**
 * Admin: read and write round_tour_predictions for any entry.
 *
 * GET  ?entryId=N  — return all existing tour picks for this entry.
 * POST { entryId, matchNo, predHome, predAway, penaltyWinner? }
 *       — upsert one pick. If the round's deadline (first kickoff) has already
 *         passed, the updated_at is backdated to 1 minute before that deadline
 *         so the pick is still eligible for scoring.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function knockoutRoundMatchNos(matchNo: number): number[] {
  if (matchNo >= 73 && matchNo <= 88) return Array.from({ length: 16 }, (_, i) => 73 + i);
  if (matchNo >= 89 && matchNo <= 96) return Array.from({ length: 8 }, (_, i) => 89 + i);
  if (matchNo >= 97 && matchNo <= 100) return [97, 98, 99, 100];
  if (matchNo >= 101 && matchNo <= 102) return [101, 102];
  if (matchNo === 104) return [104];
  return [];
}

export async function GET(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const entryId = Number(searchParams.get("entryId"));
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid entryId." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("round_tour_predictions")
    .select("match_no, pred_home, pred_away, penalty_winner, updated_at")
    .eq("entry_id", entryId)
    .order("match_no");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, picks: data ?? [] });
}

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { entryId, matchNo, predHome, predAway, penaltyWinner } = body as Record<string, unknown>;

  if (!Number.isInteger(entryId) || (entryId as number) <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid entryId." }, { status: 400 });
  }
  if (!Number.isInteger(matchNo) || (matchNo as number) < 73 || (matchNo as number) > 104 || matchNo === 103) {
    return NextResponse.json({ ok: false, error: "Invalid matchNo." }, { status: 400 });
  }
  if (!Number.isInteger(predHome) || (predHome as number) < 0 || !Number.isInteger(predAway) || (predAway as number) < 0) {
    return NextResponse.json({ ok: false, error: "Invalid scores." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Find the round's first kickoff to know whether we need to backdate.
  const roundMatchNos = knockoutRoundMatchNos(matchNo as number);
  const { data: koMatches } = await supabase
    .from("actual_knockout_matches")
    .select("kickoff_at")
    .in("match_no", roundMatchNos)
    .not("kickoff_at", "is", null);

  const kickoffs = (koMatches ?? [])
    .map((m: { kickoff_at: string }) => new Date(m.kickoff_at).getTime())
    .filter(Boolean);
  const roundFirstKickoff = kickoffs.length > 0 ? Math.min(...kickoffs) : null;
  const now = Date.now();

  // If the round's deadline has already passed, backdate to 1 minute before it.
  let updatedAt: string;
  if (roundFirstKickoff !== null && now >= roundFirstKickoff) {
    updatedAt = new Date(roundFirstKickoff - 60_000).toISOString();
  } else {
    updatedAt = new Date(now).toISOString();
  }

  // Validate penalty_winner — only valid on a level score, must be one of the teams.
  const isLevel = predHome === predAway;
  let resolvedPenWinner: string | null = null;
  if (isLevel && penaltyWinner) {
    const { data: slot } = await supabase
      .from("actual_knockout_matches")
      .select("home_team, away_team")
      .eq("match_no", matchNo)
      .maybeSingle();
    if (slot && (penaltyWinner === slot.home_team || penaltyWinner === slot.away_team)) {
      resolvedPenWinner = penaltyWinner as string;
    }
  }

  const { error } = await supabase
    .from("round_tour_predictions")
    .upsert(
      {
        entry_id: entryId,
        match_no: matchNo,
        pred_home: predHome,
        pred_away: predAway,
        penalty_winner: resolvedPenWinner,
        updated_at: updatedAt,
      },
      { onConflict: "entry_id,match_no" }
    );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updatedAt });
}
