/**
 * POST /api/admin/knockout-result — set (or clear) one knockout match's actual
 * matchup, scoreline, and penalty-shootout winner (actual_knockout_matches,
 * matches 73–102 and 104; never 103). The manual override for what the
 * football-data sync writes automatically — used to fix a tie-break-divergent
 * matchup or correct a result.
 *
 * Body: { match_no, home_team, away_team, home_goals, away_goals, penalty_winner }.
 *   - teams: a canonical name, or null/"" to leave the slot TBD.
 *   - goals: both provided together (0–99), or both null to clear the result.
 *   - penalty_winner: one of the two teams, only on a level score; ignored otherwise.
 * Cookie-protected. Leaves kickoff_at untouched.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getCanonicalTeams } from "@/lib/adminData";

export const runtime = "nodejs";

const MAX_GOALS = 99;
/** Scored knockout slots: 73–102 and 104 (the 3rd-place playoff 103 is excluded). */
const VALID_SLOT = (n: number) => Number.isInteger(n) && n >= 73 && n <= 104 && n !== 103;

function parseGoal(v: unknown): number | null | undefined {
  if (v === null || v === "" || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_GOALS) return undefined; // invalid
  return n;
}

/** A team field: null/"" → null (TBD); a canonical name → that name; else undefined (invalid). */
function parseTeam(v: unknown, canonical: Set<string>): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t === "") return null;
  return canonical.has(t) ? t : undefined;
}

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const matchNo = Number(body.match_no);
  if (!VALID_SLOT(matchNo)) {
    return NextResponse.json(
      { ok: false, error: "match_no must be a knockout match (73–102 or 104)." },
      { status: 400 },
    );
  }

  let canonical: Set<string>;
  try {
    canonical = new Set(await getCanonicalTeams());
  } catch (err) {
    console.error("knockout-result canonical load failed:", err);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  const homeTeam = parseTeam(body.home_team, canonical);
  const awayTeam = parseTeam(body.away_team, canonical);
  if (homeTeam === undefined || awayTeam === undefined) {
    return NextResponse.json({ ok: false, error: "Teams must be official tournament teams." }, { status: 400 });
  }
  if (homeTeam !== null && awayTeam !== null && homeTeam === awayTeam) {
    return NextResponse.json({ ok: false, error: "A match can't be a team against itself." }, { status: 400 });
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
    return NextResponse.json({ ok: false, error: "Enter both scores, or clear both." }, { status: 400 });
  }

  // Penalty winner only applies to a level score, and must be one of the two teams.
  let penaltyWinner: string | null = null;
  if (home !== null && away !== null && home === away) {
    const pw = parseTeam(body.penalty_winner, canonical);
    if (pw === undefined || (pw !== null && pw !== homeTeam && pw !== awayTeam)) {
      return NextResponse.json(
        { ok: false, error: "The penalty winner must be one of the two teams." },
        { status: 400 },
      );
    }
    // A level score between two known teams must name who went through on penalties.
    if (homeTeam !== null && awayTeam !== null && pw === null) {
      return NextResponse.json(
        { ok: false, error: "Pick the penalty-shootout winner for a level score." },
        { status: 400 },
      );
    }
    penaltyWinner = pw;
  }

  try {
    const { error } = await getSupabaseAdmin()
      .from("actual_knockout_matches")
      .upsert(
        {
          match_no: matchNo,
          home_team: homeTeam,
          away_team: awayTeam,
          home_goals: home,
          away_goals: away,
          penalty_winner: penaltyWinner,
          result_logged_at: home === null ? null : new Date().toISOString(),
        },
        { onConflict: "match_no" },
      );
    if (error) {
      console.error("knockout-result upsert failed:", error);
      return NextResponse.json({ ok: false, error: "Could not save the result." }, { status: 500 });
    }
  } catch (err) {
    console.error("knockout-result upsert threw:", err);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, match_no: matchNo });
}
