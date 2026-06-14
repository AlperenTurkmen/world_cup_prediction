/**
 * PATCH /api/admin/leagues — hide or restore a league.
 * DELETE /api/admin/leagues — permanently remove a league.
 * Body: { id: number, hidden?: boolean }. Cookie-protected.
 */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function parseId(v: unknown): number | null {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: unknown; hidden?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const id = parseId(body.id);
  if (!id || typeof body.hidden !== "boolean") {
    return NextResponse.json({ ok: false, error: "Invalid league update." }, { status: 400 });
  }

  const hidden = body.hidden;
  const { error } = await getSupabaseAdmin()
    .from("leagues")
    .update({
      is_hidden: hidden,
      hidden_at: hidden ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) {
    console.error("admin league visibility update failed:", error);
    return NextResponse.json({ ok: false, error: "Could not update the league." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, hidden });
}

export async function DELETE(req: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const id = parseId(body.id);
  if (!id) {
    return NextResponse.json({ ok: false, error: "Invalid league id." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin().from("leagues").delete().eq("id", id);
  if (error) {
    console.error("admin league delete failed:", error);
    return NextResponse.json({ ok: false, error: "Could not remove the league." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id });
}
