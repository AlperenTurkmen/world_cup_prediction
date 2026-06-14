/**
 * POST /api/admin/create-entry — admin-only: create an entry on behalf of a
 * player by supplying their username + password and uploading their filled
 * WCup_2026 workbook. Same storage path as the public /api/upload (parse with
 * lib/parseWorkbook.ts, then the atomic `create_entry` RPC) — but cookie-
 * protected for the admin and it does NOT set a player session (the admin is
 * acting for someone else). One entry per username (case-insensitive).
 *
 * Multipart body: `username` (text), `password` (text, >= 6 chars), `file` (.xlsx).
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseWorkbook, WorkbookParseError } from "@/lib/parseWorkbook";
import { hashPassword } from "@/lib/playerAuth";

// xlsx parsing needs the Node runtime (not edge).
export const runtime = "nodejs";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB — master file is ~3.3 MB
const MAX_USERNAME_LEN = 40;

interface CreateEntryResult {
  entry_id: number;
  late_prediction_count: number;
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return badRequest("Unauthorized", 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Expected a multipart form upload.");
  }

  // --- Validate username ---
  const rawUsername = form.get("username");
  if (typeof rawUsername !== "string") {
    return badRequest("Please enter a username.");
  }
  const username = rawUsername.trim();
  if (username.length === 0) {
    return badRequest("Please enter a username.");
  }
  if (username.length > MAX_USERNAME_LEN) {
    return badRequest(`Username must be ${MAX_USERNAME_LEN} characters or fewer.`);
  }

  // --- Validate password (always required when an admin creates an entry) ---
  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (password.length < 6) {
    return badRequest("Password must be at least 6 characters.");
  }

  // --- Validate file ---
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return badRequest("Please choose the player's filled .xlsx file.");
  }
  if (file.size > MAX_FILE_BYTES) {
    return badRequest("That file is too large. Please upload the WCup_2026 workbook (.xlsx).");
  }

  // --- Parse the workbook ---
  let parsed;
  try {
    parsed = parseWorkbook(await file.arrayBuffer());
  } catch (err) {
    if (err instanceof WorkbookParseError) {
      return badRequest(err.message);
    }
    console.error("Unexpected parse error:", err);
    return badRequest("Could not read that file. Make sure it is the WCup_2026 workbook (.xlsx).");
  }

  const predictions = parsed.groupPredictions.map((g) => ({
    match_no: g.matchNo,
    pred_home: g.predHome,
    pred_away: g.predAway,
  }));
  const advancers = parsed.advancers; // { R32, R16, QF, SF, FINAL, CHAMPION }
  const knockout = parsed.knockoutPredictions.map((k) => ({
    match_no: k.matchNo,
    home_team: k.homeTeam,
    away_team: k.awayTeam,
    pred_home: k.predHome,
    pred_away: k.predAway,
    penalty_winner: k.penaltyWinner,
  }));

  const hashedPassword = hashPassword(password);

  // --- Atomic insert via RPC (no Google link, no auto-login) ---
  let data: CreateEntryResult | null;
  try {
    const res = await getSupabaseAdmin().rpc("create_entry", {
      p_username: username,
      p_password_hash: hashedPassword,
      p_predictions: predictions,
      p_advancers: advancers,
      p_google_sub: null,
      p_google_email: null,
      p_knockout: knockout,
    });
    if (res.error) {
      if (res.error.code === "23505") {
        return badRequest(
          `The username "${username}" has already submitted an entry. Each person uploads once.`,
          409,
        );
      }
      console.error("create_entry failed:", res.error);
      return NextResponse.json(
        { ok: false, error: "Could not save the entry. Please try again later." },
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

  return NextResponse.json({
    ok: true,
    entryId: data?.entry_id,
    username,
    predictionsSaved: predictions.length,
    latePredictionCount: data?.late_prediction_count ?? 0,
    champion: advancers.CHAMPION,
  });
}
