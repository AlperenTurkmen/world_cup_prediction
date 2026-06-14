import "server-only";

import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "./supabaseAdmin";

export const PLAYER_COOKIE = "wc_player";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days for players

interface PlayerSession {
  id: number;
  username: string;
}

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
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Hash a password using scryptSync with a random salt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

/** Verify a password against a stored scrypt hash. */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, expectedKey] = storedHash.split(":");
  const testKey = scryptSync(password, salt, 64).toString("hex");
  return safeEqual(testKey, expectedKey);
}

/** Create a signed session token for a player. */
export function createPlayerSessionToken(id: number, username: string): string {
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${id}:${username}:${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Parse and verify a player session token. */
export function verifyPlayerSessionToken(token: string | undefined | null): PlayerSession | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(payload))) return null;

  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [idStr, username, expStr] = parts;
  const id = Number(idStr);
  const exp = Number(expStr);

  if (!Number.isFinite(id) || !Number.isFinite(exp) || Date.now() > exp) {
    return null;
  }

  return { id, username };
}

/** Get the currently logged-in player. */
export async function getCurrentPlayer(): Promise<PlayerSession | null> {
  try {
    const store = await cookies();
    const token = store.get(PLAYER_COOKIE)?.value;
    return verifyPlayerSessionToken(token);
  } catch {
    return null;
  }
}

/** Set the player session cookie on the response. */
export async function setPlayerSession(id: number, username: string) {
  const token = createPlayerSessionToken(id, username);
  const store = await cookies();
  store.set(PLAYER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Clear the player session cookie. */
export async function clearPlayerSession() {
  const store = await cookies();
  store.set(PLAYER_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
}
