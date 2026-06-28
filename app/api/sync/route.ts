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
import { deriveActualKnockout } from "@/lib/actualBracket";
import type { GroupFixture, GroupScores } from "@/lib/deriveBracket";

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

  // 1. Pull live data + current fixtures (incl. team→group for bracket derivation).
  const supabase = getSupabaseAdmin();
  let apiMatches, matches, canonicalList, groupsRes;
  try {
    [apiMatches, matches, canonicalList, groupsRes] = await Promise.all([
      fetchWorldCupMatches(),
      getMatches(),
      getCanonicalTeams(),
      supabase.from("team_groups").select("team, group_letter"),
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
  const now = new Date().toISOString();
  let groupsApplied = 0;
  let knockoutMatchesApplied = 0;
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

    // 5. Derive + apply actual knockout matchups/scores (matches 73–104). Reuses
    //    the bracket engine on the REAL group results to fix R32 slots, then maps
    //    the API's knockout fixtures onto them. Writes drive the tree + the tours.
    const groupOf = new Map<string, string>();
    for (const g of (groupsRes.data ?? []) as Array<{ team: string; group_letter: string }>) {
      groupOf.set(g.team, g.group_letter);
    }
    // Group scores AFTER this sync = already-logged results + the ones just applied.
    const actualGroupScores: GroupScores = {};
    for (const m of matches) {
      if (m.home_goals !== null && m.away_goals !== null) {
        actualGroupScores[m.match_no] = { home: m.home_goals, away: m.away_goals };
      }
    }
    for (const u of diff.groupUpdates) {
      actualGroupScores[u.match_no] = { home: u.home_goals, away: u.away_goals };
    }
    const fixtures: GroupFixture[] = [];
    for (const m of matches) {
      const group = groupOf.get(m.home_team);
      if (group) fixtures.push({ matchNo: m.match_no, home: m.home_team, away: m.away_team, group });
    }
    // Only derive once the group stage is fully known (deriveActualKnockout also
    // guards this); otherwise it's a no-op that leaves the seeded kickoffs intact.
    if (fixtures.length === 72) {
      const { writes } = deriveActualKnockout(
        apiMatches,
        fixtures,
        actualGroupScores,
        new Set(canonicalList),
      );
      for (const w of writes) {
        // (Re)set the corroborated matchup, and correct the kickoff to the API's
        // real schedule when known (the seeded workbook time is only a fallback).
        const matchupUpdate: Record<string, unknown> = {
          home_team: w.home_team,
          away_team: w.away_team,
        };
        if (w.kickoff) matchupUpdate.kickoff_at = w.kickoff;
        const { error: tErr } = await supabase
          .from("actual_knockout_matches")
          .update(matchupUpdate)
          .eq("match_no", w.match_no);
        if (tErr) throw tErr;
        // Log the scoreline once it exists, never overwriting a logged result.
        if (w.home_goals !== null && w.away_goals !== null) {
          const { data: sData, error: sErr } = await supabase
            .from("actual_knockout_matches")
            .update({
              home_goals: w.home_goals,
              away_goals: w.away_goals,
              penalty_winner: w.penalty_winner,
              result_logged_at: now,
            })
            .eq("match_no", w.match_no)
            .is("home_goals", null) // guard: never overwrite a logged knockout result
            .select("match_no");
          if (sErr) throw sErr;
          if (sData && sData.length > 0) knockoutMatchesApplied++; // count only newly-logged
        }
      }
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
    knockoutMatchesApplied,
    advancersByRound,
    skipped: diff.skipped,
  });
}
