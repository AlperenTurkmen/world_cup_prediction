import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createSignedToken, verifySignedToken } from "./signedToken";

export const GOOGLE_OAUTH_STATE_COOKIE = "wc_google_oauth_state";
export const GOOGLE_IDENTITY_COOKIE = "wc_google_identity";

export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
export const GOOGLE_IDENTITY_MAX_AGE_SECONDS = 15 * 60;

export interface GoogleOAuthState {
  nonce: string;
  redirectTo: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
}

export interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET environment variable");
  return secret;
}

export function sanitizeRedirectTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function createGoogleOAuthState(redirectTo: string): string {
  return createSignedToken<GoogleOAuthState>(
    { nonce: randomBytes(16).toString("base64url"), redirectTo },
    getAuthSecret(),
    GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  );
}

export function verifyGoogleOAuthState(token: string | undefined | null): GoogleOAuthState | null {
  return verifySignedToken<GoogleOAuthState>(token, getAuthSecret());
}

export function createGoogleIdentityToken(identity: GoogleIdentity): string {
  return createSignedToken<GoogleIdentity>(
    identity,
    getAuthSecret(),
    GOOGLE_IDENTITY_MAX_AGE_SECONDS,
  );
}

export function verifyGoogleIdentityToken(token: string | undefined | null): GoogleIdentity | null {
  return verifySignedToken<GoogleIdentity>(token, getAuthSecret());
}

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID environment variable");
  if (!clientSecret) throw new Error("Missing GOOGLE_CLIENT_SECRET environment variable");
  return { clientId, clientSecret };
}

export async function setGoogleOAuthStateCookie(token: string) {
  const store = await cookies();
  store.set(GOOGLE_OAUTH_STATE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export async function clearGoogleOAuthStateCookie() {
  const store = await cookies();
  store.set(GOOGLE_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
}

export async function getGoogleOAuthStateFromCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
}

export async function setGoogleIdentity(identity: GoogleIdentity) {
  const token = createGoogleIdentityToken(identity);
  const store = await cookies();
  store.set(GOOGLE_IDENTITY_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GOOGLE_IDENTITY_MAX_AGE_SECONDS,
  });
}

export async function getPendingGoogleIdentity(): Promise<GoogleIdentity | null> {
  const store = await cookies();
  return verifyGoogleIdentityToken(store.get(GOOGLE_IDENTITY_COOKIE)?.value);
}

export async function clearGoogleIdentity() {
  const store = await cookies();
  store.set(GOOGLE_IDENTITY_COOKIE, "", { path: "/", maxAge: 0 });
}

export function validateGoogleUserInfo(userInfo: GoogleUserInfo): GoogleIdentity {
  if (!userInfo.sub || !userInfo.email) {
    throw new Error("Google did not return the account identity.");
  }
  if (userInfo.email_verified === false) {
    throw new Error("Google account email is not verified.");
  }
  return { sub: userInfo.sub, email: userInfo.email };
}
