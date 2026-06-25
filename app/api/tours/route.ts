/**
 * GET/PUT /api/tours — the per-round knockout prediction tours.
 *
 * GET  returns the signed-in player's full tour state: every knockout round, its
 *      real matchups (from actual_knockout_matches), the round deadline (its first
 *      kickoff), whether it's pending / open / locked, and the player's saved picks.
 * PUT  saves one round's picks. Rejected unless the player is signed in, the round
 *      is still open (now is before its first kickoff), and every pick names a real
 *      matchup (with a penalty winner on a level score). Picks are an editable
 *      upsert keyed by (entry_id, match_no) — never immutable, unlike the original
 *      bracket — and only score if last edited before the deadline (enforced again
 *      in the leaderboard SQL).
 *
 * Supabase is touched only here on the server — never from the client.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentPlayer } from "@/lib/playerAuth";
import { ADV_ROUNDS, type AdvRound } from "@/lib/rounds";
import {
  buildTourState,
  sanitizeTourPicks,
  TOUR_ROUNDS,
  type ActualKoRow,
  type TourPick,
} from "@/lib/tours";

export const runtime = "nodejs";

/** Rounds that have a tour (everything but CHAMPION, which is the final's winner). */
const TOUR_ROUND_SET = new Set<AdvRound>(TOUR_ROUNDS.map((r) => r.round));

const KO_COLUMNS = "match_no, home_team, away_team, kickoff_at, home_goals, away_goals, penalty_winner";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Sign in to make knockout predictions." },
    { status: 401 },
  );
}

export async function GET() {
  const player = await getCurrentPlayer();
  if (!player) return unauthorized();

  const supabase = getSupabaseAdmin();
  const [koRes, picksRes] = await Promise.all([
    supabase.from("actual_knockout_matches").select(KO_COLUMNS),
    supabase
      .from("round_tour_predictions")
      .select("match_no, pred_home, pred_away, penalty_winner")
      .eq("entry_id", player.id),
  ]);
  if (koRes.error || picksRes.error) {
    console.error("Load tours failed:", koRes.error ?? picksRes.error);
    return NextResponse.json({ ok: false, error: "Could not load the knockout tours." }, { status: 500 });
  }

  const rounds = buildTourState(
    (koRes.data ?? []) as ActualKoRow[],
    (picksRes.data ?? []) as TourPick[],
    Date.now(),
  );
  return NextResponse.json({ ok: true, rounds });
}

export async function PUT(req: Request) {
  const player = await getCurrentPlayer();
  if (!player) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const round = raw.round as AdvRound;
  if (!ADV_ROUNDS.includes(round) || !TOUR_ROUND_SET.has(round)) {
    return NextResponse.json({ ok: false, error: "Unknown knockout round." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Load this round's actual matchups + kickoffs to validate against and to find
  // the deadline (the round's first kickoff). The matchup must be known to predict.
  const matchNos = TOUR_ROUNDS.find((r) => r.round === round)!.matches;
  const { data: koData, error: koErr } = await supabase
    .from("actual_knockout_matches")
    .select(KO_COLUMNS)
    .in("match_no", matchNos);
  if (koErr) {
    console.error("Load round matchups failed:", koErr);
    return NextResponse.json({ ok: false, error: "Could not load the round." }, { status: 500 });
  }

  const rows = (koData ?? []) as ActualKoRow[];
  const matchupOf = new Map<number, { home: string; away: string }>();
  let deadlineMs: number | null = null;
  for (const r of rows) {
    if (r.home_team && r.away_team) matchupOf.set(r.match_no, { home: r.home_team, away: r.away_team });
    if (r.kickoff_at) {
      const ms = new Date(r.kickoff_at).getTime();
      if (deadlineMs === null || ms < deadlineMs) deadlineMs = ms;
    }
  }

  // The whole round locks at its first kickoff.
  if (deadlineMs !== null && Date.now() >= deadlineMs) {
    return NextResponse.json(
      { ok: false, error: "This round is locked — its first game has kicked off." },
      { status: 409 },
    );
  }
  if (matchupOf.size === 0) {
    return NextResponse.json(
      { ok: false, error: "This round's matchups aren't known yet." },
      { status: 409 },
    );
  }

  const { picks, error } = sanitizeTourPicks(round, raw.picks, matchupOf);
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 });

  if (picks.length > 0) {
    const now = new Date().toISOString();
    const { error: upErr } = await supabase.from("round_tour_predictions").upsert(
      picks.map((p) => ({
        entry_id: player.id,
        match_no: p.matchNo,
        pred_home: p.predHome,
        pred_away: p.predAway,
        penalty_winner: p.penaltyWinner,
        updated_at: now,
      })),
      { onConflict: "entry_id,match_no" },
    );
    if (upErr) {
      console.error("Save tour picks failed:", upErr);
      return NextResponse.json({ ok: false, error: "Could not save your picks." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, savedCount: picks.length });
}
