/**
 * POST /api/upload/manual — finalize a manual prediction entry.
 *
 * The browser sends group scorelines (per the on-screen stepper) and the
 * knockout winners the user tapped through the bracket. The server:
 *   1. Loads the seeded fixtures + team→group map.
 *   2. Fills the full 72-match grid — games that already kicked off and weren't
 *      shown default to 0–0 (they score nothing anyway); every game that hasn't
 *      started yet must be filled, or the submit is rejected.
 *   3. Derives the advancement bracket from the predicted standings + picked
 *      winners (lib/deriveBracket) — the same advancer shape parseWorkbook
 *      produces from an Excel upload.
 *   4. Inserts everything atomically via the shared `create_entry` RPC, deletes
 *      the draft, and signs the user in.
 *
 * Mirrors POST /api/upload (one immutable entry per username). Supabase is
 * touched only on the server.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { clearGoogleIdentity, getPendingGoogleIdentity } from "@/lib/googleAuth";
import { getCurrentPlayer, hashPassword, setPlayerSession } from "@/lib/playerAuth";
import {
  deriveBracket,
  type GroupFixture,
  type GroupScores,
  type KnockoutScores,
} from "@/lib/deriveBracket";
import {
  sanitizeGroupScores,
  sanitizeKoScores,
  MAX_USERNAME_LEN,
} from "@/lib/manualEntry";

export const runtime = "nodejs";

interface CreateEntryResult {
  entry_id: number;
  late_prediction_count: number;
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  const [player, identity] = await Promise.all([getCurrentPlayer(), getPendingGoogleIdentity()]);
  if (player) {
    return badRequest("You are already signed in to an entry. Each person enters once.", 409);
  }
  if (!identity) {
    return badRequest("Please continue with Google before submitting predictions.", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Expected a JSON body.");
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  // --- Username + optional password (same rules as the Excel upload) --------
  const username = typeof raw.username === "string" ? raw.username.trim() : "";
  if (username.length === 0) return badRequest("Please enter a username.");
  if (username.length > MAX_USERNAME_LEN) {
    return badRequest(`Username must be ${MAX_USERNAME_LEN} characters or fewer.`);
  }
  const password = typeof raw.password === "string" ? raw.password : "";
  if (password.length > 0 && password.length < 6) {
    return badRequest("Password must be at least 6 characters, or leave it blank to use Google only.");
  }

  const groupScores = sanitizeGroupScores(raw.groupScores);
  const koScores = sanitizeKoScores(raw.koScores);
  const koScoresForDerive: KnockoutScores = {};
  for (const [k, v] of Object.entries(koScores)) {
    koScoresForDerive[Number(k)] = { home: v.h, away: v.a, penaltyWinner: v.pen ?? null };
  }

  // --- Load fixtures + team→group from the seeded tables --------------------
  const supabase = getSupabaseAdmin();
  const [matchesRes, groupsRes] = await Promise.all([
    supabase.from("matches").select("match_no, home_team, away_team, kickoff_at"),
    supabase.from("team_groups").select("team, group_letter"),
  ]);
  if (matchesRes.error || groupsRes.error) {
    console.error("Load fixtures failed:", matchesRes.error ?? groupsRes.error);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
  const matchRows = (matchesRes.data ?? []) as Array<{
    match_no: number;
    home_team: string;
    away_team: string;
    kickoff_at: string | null;
  }>;
  if (matchRows.length !== 72) {
    return NextResponse.json(
      { ok: false, error: "Fixtures are not set up yet. Please try again later." },
      { status: 500 },
    );
  }
  const groupOf = new Map<string, string>();
  for (const g of (groupsRes.data ?? []) as Array<{ team: string; group_letter: string }>) {
    groupOf.set(g.team, g.group_letter);
  }

  // --- Build the full 72-match grid + fixtures ------------------------------
  const now = Date.now();
  const fixtures: GroupFixture[] = [];
  const scores: GroupScores = {};
  const missing: number[] = [];
  for (const m of matchRows) {
    const group = groupOf.get(m.home_team);
    if (!group) {
      console.error(`No group for team "${m.home_team}" (match ${m.match_no}).`);
      return NextResponse.json(
        { ok: false, error: "Fixtures are not set up yet. Please try again later." },
        { status: 500 },
      );
    }
    fixtures.push({ matchNo: m.match_no, home: m.home_team, away: m.away_team, group });

    const provided = groupScores[String(m.match_no)];
    if (provided) {
      scores[m.match_no] = { home: provided.h, away: provided.a };
    } else {
      const started = m.kickoff_at != null && new Date(m.kickoff_at).getTime() <= now;
      if (started) {
        scores[m.match_no] = { home: 0, away: 0 }; // hidden past game — scores nothing
      } else {
        missing.push(m.match_no);
      }
    }
  }
  if (missing.length > 0) {
    return badRequest(
      `Please fill every upcoming game before submitting (${missing.length} still empty).`,
    );
  }

  // --- Derive the advancement bracket from the predicted scorelines ---------
  const { advancers, complete, knockoutPredictions } = deriveBracket(fixtures, scores, koScoresForDerive);
  if (!complete) {
    return badRequest(
      "Please enter a score for every knockout match (and pick the penalty winner for any draw) through to the final.",
    );
  }

  const predictions = fixtures.map((f) => ({
    match_no: f.matchNo,
    pred_home: scores[f.matchNo].home,
    pred_away: scores[f.matchNo].away,
  }));

  const knockout = knockoutPredictions.map((k) => ({
    match_no: k.matchNo,
    home_team: k.homeTeam,
    away_team: k.awayTeam,
    pred_home: k.predHome,
    pred_away: k.predAway,
    penalty_winner: k.penaltyWinner,
  }));

  // --- Atomic insert via the shared RPC ------------------------------------
  let data: CreateEntryResult | null;
  try {
    const res = await supabase.rpc("create_entry", {
      p_username: username,
      p_password_hash: password.length > 0 ? hashPassword(password) : null,
      p_predictions: predictions,
      p_advancers: advancers,
      p_google_sub: identity.sub,
      p_google_email: identity.email,
      p_knockout: knockout,
    });
    if (res.error) {
      if (res.error.code === "23505") {
        return badRequest(
          `The username "${username}" has already submitted an entry. Each person enters once.`,
          409,
        );
      }
      console.error("create_entry failed:", res.error);
      return NextResponse.json(
        { ok: false, error: "Could not save your entry. Please try again later." },
        { status: 500 },
      );
    }
    data = res.data as CreateEntryResult | null;
  } catch (err) {
    console.error("Database call threw:", err);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  // Finalized — clean up the draft and sign the user in.
  if (data?.entry_id) {
    await supabase.from("entry_drafts").delete().eq("google_sub", identity.sub);
    await setPlayerSession(data.entry_id, username);
    await clearGoogleIdentity();
  }

  return NextResponse.json({
    ok: true,
    username,
    predictionsSaved: predictions.length,
    latePredictionCount: data?.late_prediction_count ?? 0,
    champion: advancers.CHAMPION,
  });
}
