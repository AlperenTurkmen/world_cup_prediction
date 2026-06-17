import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  scoreGroupMatch,
  DEFAULT_MATCH_WEIGHTS,
  type ScoringWeights,
} from "@/lib/groupMatchScore";

export const dynamic = "force-dynamic";

/**
 * Per-game group-match breakdown for one leaderboard entry. Returns every group
 * match that COUNTS toward that entry's score — i.e. it passes the exact same
 * fairness gate as the `leaderboard` view (result logged, prediction eligible,
 * entry predates the result, and — when a cutoff applies — the match is at/after
 * it). So the sum of the returned points equals the entry's group_points column.
 *
 * The cutoff mirrors the board being viewed: a league board applies that
 * league's start game (?leagueId=), the global board applies app_settings'
 * global_start_match_id. A player's predictions/points are already public (the
 * profile page shows the full per-match table), so no auth is required here.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const entryId = Number(searchParams.get("entryId"));
    const leagueIdStr = searchParams.get("leagueId");
    const leagueId = leagueIdStr ? Number(leagueIdStr) : null;

    if (!Number.isInteger(entryId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid entryId parameter." },
        { status: 400 }
      );
    }
    if (leagueIdStr && !Number.isInteger(leagueId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid leagueId parameter." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // 1. Resolve the chronological cutoff for this board, if any. A league uses
    //    its start game; the global board uses the tournament-wide floor.
    const cutoffSrc = leagueId
      ? await supabase.from("leagues").select("start_match_id").eq("id", leagueId).maybeSingle()
      : await supabase.from("app_settings").select("global_start_match_id").eq("id", 1).maybeSingle();
    const cutoffMatchId =
      (cutoffSrc.data as any)?.start_match_id ??
      (cutoffSrc.data as any)?.global_start_match_id ??
      null;

    // 2. Entry timestamp, weights, the cutoff game, and the predictions — together.
    const [entryRes, weightsRes, cutoffMatchRes, predsRes] = await Promise.all([
      supabase.from("entries").select("created_at").eq("id", entryId).maybeSingle(),
      supabase.from("scoring_weights").select("key, value"),
      cutoffMatchId
        ? supabase.from("matches").select("kickoff_at, match_no").eq("id", cutoffMatchId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("predictions")
        .select(
          "pred_home, pred_away, is_score_eligible, matches ( match_no, home_team, away_team, kickoff_at, home_goals, away_goals, result_logged_at )"
        )
        .eq("entry_id", entryId),
    ]);

    if (entryRes.error || !entryRes.data) {
      return NextResponse.json({ ok: false, error: "Entry not found." }, { status: 404 });
    }
    if (predsRes.error) {
      console.error("Breakdown predictions query failed:", predsRes.error);
      return NextResponse.json(
        { ok: false, error: "Could not load predictions." },
        { status: 500 }
      );
    }

    const entryCreatedAt = new Date(entryRes.data.created_at).getTime();

    const weights: ScoringWeights = { ...DEFAULT_MATCH_WEIGHTS };
    for (const r of weightsRes.data ?? []) {
      if (r.key in weights) weights[r.key as keyof ScoringWeights] = r.value as number;
    }

    // Cutoff key as (kickoff_at, match_no). The SQL only applies a cutoff when
    // the start game's kickoff is non-null, so we do the same.
    const cm = cutoffMatchRes.data as any | null;
    const cutoffKickoff = cm?.kickoff_at ? new Date(cm.kickoff_at).getTime() : null;
    const cutoffMatchNo = cm?.match_no ?? null;
    const POS_INF = Number.POSITIVE_INFINITY;

    const games = (predsRes.data ?? [])
      .map((p: any) => ({ p, m: p.matches }))
      .filter(({ p, m }) => {
        if (!m) return false;
        // Must have a logged result.
        if (m.home_goals === null || m.away_goals === null) return false;
        // Fairness gate — identical to compute_leaderboard's group-match CTE.
        if (p.is_score_eligible !== true) return false;
        if (m.result_logged_at !== null && entryCreatedAt >= new Date(m.result_logged_at).getTime())
          return false;
        // League/global cutoff: (kickoff, match_no) >= (cutoffKickoff, cutoffMatchNo).
        if (cutoffKickoff !== null) {
          const mk = m.kickoff_at ? new Date(m.kickoff_at).getTime() : POS_INF;
          if (mk < cutoffKickoff) return false;
          if (mk === cutoffKickoff && m.match_no < (cutoffMatchNo ?? 0)) return false;
        }
        return true;
      })
      .map(({ p, m }) => {
        const s = scoreGroupMatch(p.pred_home, p.pred_away, m.home_goals, m.away_goals, weights);
        return {
          matchNo: m.match_no,
          homeTeam: m.home_team,
          awayTeam: m.away_team,
          kickoffAt: m.kickoff_at,
          homeGoals: m.home_goals,
          awayGoals: m.away_goals,
          predHome: p.pred_home,
          predAway: p.pred_away,
          points: s.points,
          isExact: s.isExact,
          isOutcome: s.isOutcome,
        };
      });

    // Default order: most recent first (the client can re-sort by points).
    games.sort((a, b) => {
      const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : 0;
      const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : 0;
      if (ta !== tb) return tb - ta;
      return b.matchNo - a.matchNo;
    });

    return NextResponse.json({ ok: true, games });
  } catch (err) {
    console.error("Breakdown API threw:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
