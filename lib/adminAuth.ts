import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Admin session auth (PLAN §Phase 5).
 *
 * A successful password login sets a signed, httpOnly cookie. The cookie value
 * is `<expiry>.<hmac>` where the HMAC is keyed by AUTH_SECRET — so it cannot be
 * forged without the secret, and it carries its own expiry. No session store
 * needed. All checks run server-side only (`server-only` guard above).
 */

export const ADMIN_COOKIE = "wc_admin";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET environment variable");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/** Constant-time string compare that doesn't early-exit on length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against self to keep timing roughly constant, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Mint a fresh session token valid for SESSION_MAX_AGE_SECONDS. */
export function createSessionToken(): string {
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(exp);
  return `${payload}.${sign(payload)}`;
}

/** Verify a token's signature and expiry. */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(payload))) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && Date.now() <= exp;
}

/** Constant-time check of a submitted password against ADMIN_PASSWORD. */
export function checkAdminPassword(input: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("Missing ADMIN_PASSWORD environment variable");
  if (typeof input !== "string") return false;
  return safeEqual(input, expected);
}

/** True if the current request carries a valid admin session cookie. */
export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value);
}

/** Cookie attributes for the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
