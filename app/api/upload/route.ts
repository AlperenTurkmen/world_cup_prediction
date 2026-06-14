/**
 * POST /api/upload — accept a filled WCup_2026 workbook and store one entry.
 *
 * Multipart body: `username` (text) + `file` (.xlsx). The file is parsed
 * server-side with lib/parseWorkbook.ts, then the entry, its 72 group
 * predictions, and all advancement picks are inserted atomically via the
 * `create_entry` Postgres function. One upload per username (case-insensitive);
 * duplicates and malformed files are rejected with readable messages.
 *
 * Supabase is touched only here on the server — never from the client.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseWorkbook, WorkbookParseError } from "@/lib/parseWorkbook";

// xlsx parsing needs the Node runtime (not edge).
export const runtime = "nodejs";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB — master file is ~3.3 MB
const MAX_USERNAME_LEN = 40;

function badRequest(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
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

  // --- Validate file ---
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return badRequest("Please choose your filled .xlsx file.");
  }
  if (file.size > MAX_FILE_BYTES) {
    return badRequest("That file is too large. Please upload the WCup_2026 workbook (.xlsx).");
  }

  // --- Parse the workbook ---
  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = parseWorkbook(buffer);
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

  // --- Atomic insert via RPC ---
  let data: unknown;
  try {
    const res = await getSupabaseAdmin().rpc("create_entry", {
      p_username: username,
      p_predictions: predictions,
      p_advancers: advancers,
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
        { ok: false, error: "Could not save your entry. Please try again later." },
        { status: 500 },
      );
    }
    data = res.data;
  } catch (err) {
    // Misconfigured env or network failure reaching Supabase.
    console.error("Database call threw:", err);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    entryId: data,
    username,
    predictionsSaved: predictions.length,
    champion: advancers.CHAMPION,
  });
}
