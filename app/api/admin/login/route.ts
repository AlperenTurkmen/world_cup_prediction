/**
 * POST /api/admin/login — compare the submitted password (constant-time) to
 * ADMIN_PASSWORD; on success, set the signed httpOnly session cookie.
 */
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  checkAdminPassword,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let password: unknown;
  try {
    const body = await req.json();
    password = body?.password;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  let ok: boolean;
  try {
    ok = checkAdminPassword(password);
  } catch (err) {
    console.error("admin login config error:", err);
    return NextResponse.json(
      { ok: false, error: "Admin login is not configured on the server." },
      { status: 500 },
    );
  }

  if (!ok) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, createSessionToken(), sessionCookieOptions());
  return res;
}
