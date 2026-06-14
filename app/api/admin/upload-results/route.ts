/**
 * POST /api/admin/upload-results — accelerator: parse the admin's filled master
 * workbook with the same lib/parseWorkbook.ts and auto-populate BOTH the 72
 * group actual scores AND actual_advancers for every round in one transaction.
 * Multipart body: `file` (.xlsx). Cookie-protected.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseWorkbook, WorkbookParseError } from "@/lib/parseWorkbook";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "Please choose the master .xlsx file." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ ok: false, error: "That file is too large." }, { status: 400 });
  }

  // In the master *results* file, the "predictions" cells hold the real scores
  // and the bracket holds the real advancers.
  let parsed;
  try {
    parsed = parseWorkbook(await file.arrayBuffer());
  } catch (err) {
    if (err instanceof WorkbookParseError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("master parse error:", err);
    return NextResponse.json({ ok: false, error: "Could not read that file." }, { status: 400 });
  }

  const results = parsed.groupPredictions.map((g) => ({
    match_no: g.matchNo,
    home_goals: g.predHome,
    away_goals: g.predAway,
  }));

  try {
    const { error } = await getSupabaseAdmin().rpc("apply_master_results", {
      p_results: results,
      p_advancers: parsed.advancers,
    });
    if (error) {
      console.error("apply_master_results failed:", error);
      return NextResponse.json({ ok: false, error: "Could not apply the results." }, { status: 500 });
    }
  } catch (err) {
    console.error("apply_master_results threw:", err);
    return NextResponse.json(
      { ok: false, error: "The server is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    groupResults: results.length,
    champion: parsed.advancers.CHAMPION,
  });
}
