/**
 * POST /api/sync — pull finished World Cup results from football-data.org and
 * apply them through the same write paths as the admin forms:
 *   - group scorelines → `matches` (only newly-finished rows; manual results kept)
 *   - knockout advancers → `replace_actual_advancers` (one call per non-empty round)
 *
 * Auth (either):
 *   - a valid admin session cookie (the "Sync now" button), OR
 *   - `Authorization: Bearer <SYNC_SECRET>` (an external scheduler / cron-job.org).
 *
 * No schema change and no scoring change — see lib/syncResults.ts for the logic.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getMatches, getCanonicalTeams } from "@/lib/adminData";
import { ADV_ROUNDS } from "@/lib/rounds";
import { fetchWorldCupMatches, FootballDataError } from "@/lib/footballData";
import { syncResults, type ExistingMatch } from "@/lib/syncResults";

export const runtime = "nodejs";

function bearerOk(req: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length);
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!bearerOk(req) && !(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 1. Pull live data + current fixtures.
  let apiMatches, matches, canonicalList;
  try {
    [apiMatches, matches, canonicalList] = await Promise.all([
      fetchWorldCupMatches(),
      getMatches(),
      getCanonicalTeams(),
    ]);
  } catch (err) {
    if (err instanceof FootballDataError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
    }
    console.error("sync fetch failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not load data to sync." },
      { status: 500 },
    );
  }

  // 2. Compute the diff (pure).
  const existing: ExistingMatch[] = matches.map((m) => ({
    match_no: m.match_no,
    home_team: m.home_team,
    away_team: m.away_team,
    home_goals: m.home_goals,
  }));
  const diff = syncResults(apiMatches, existing, new Set(canonicalList));

  // 3. Apply group results (one row each; mirrors app/api/admin/result/route.ts).
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  let groupsApplied = 0;
  try {
    for (const u of diff.groupUpdates) {
      const { error } = await supabase
        .from("matches")
        .update({ home_goals: u.home_goals, away_goals: u.away_goals, result_logged_at: now })
        .eq("match_no", u.match_no)
        .is("home_goals", null); // guard: never overwrite a logged result
      if (error) throw error;
      groupsApplied++;
    }

    // 4. Apply advancers per non-empty round (mirrors app/api/admin/advancers/route.ts).
    for (const round of ADV_ROUNDS) {
      const teams = diff.advancers[round];
      if (teams.length === 0) continue;
      const { error } = await supabase.rpc("replace_actual_advancers", {
        p_round: round,
        p_teams: teams,
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error("sync apply failed:", err);
    return NextResponse.json(
      { ok: false, error: "Synced data but failed to save some results." },
      { status: 500 },
    );
  }

  const advancersByRound = Object.fromEntries(
    ADV_ROUNDS.map((r) => [r, diff.advancers[r].length]),
  );
  return NextResponse.json({
    ok: true,
    groupsApplied,
    advancersByRound,
    skipped: diff.skipped,
  });
}
