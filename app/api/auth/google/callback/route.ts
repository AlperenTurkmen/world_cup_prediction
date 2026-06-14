import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { setPlayerSession } from "@/lib/playerAuth";
import {
  clearGoogleIdentity,
  clearGoogleOAuthStateCookie,
  getGoogleConfig,
  getGoogleOAuthStateFromCookie,
  setGoogleIdentity,
  validateGoogleUserInfo,
  verifyGoogleOAuthState,
  type GoogleUserInfo,
} from "@/lib/googleAuth";

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as GoogleTokenResponse;

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token exchange failed.");
  }

  return data.access_token;
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("Google userinfo request failed.");
  }

  return (await res.json()) as GoogleUserInfo;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/login?error=google_denied", req.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=google_invalid", req.url));
  }

  try {
    const cookieState = await getGoogleOAuthStateFromCookie();
    if (cookieState !== state) {
      return NextResponse.redirect(new URL("/login?error=google_state", req.url));
    }

    const verifiedState = verifyGoogleOAuthState(state);
    if (!verifiedState) {
      return NextResponse.redirect(new URL("/login?error=google_state", req.url));
    }

    await clearGoogleOAuthStateCookie();

    const accessToken = await exchangeCodeForToken(
      code,
      new URL("/api/auth/google/callback", req.url).toString(),
    );
    const identity = validateGoogleUserInfo(await fetchGoogleUserInfo(accessToken));

    const { data: linkedEntry, error: linkedErr } = await getSupabaseAdmin()
      .from("entries")
      .select("id, username")
      .eq("google_sub", identity.sub)
      .eq("is_hidden", false)
      .maybeSingle();

    if (linkedErr) {
      console.error("Google linked-entry lookup failed:", linkedErr);
      return NextResponse.redirect(new URL("/login?error=google_lookup", req.url));
    }

    if (linkedEntry) {
      await clearGoogleIdentity();
      await setPlayerSession(linkedEntry.id, linkedEntry.username);
      return NextResponse.redirect(new URL(verifiedState.redirectTo, req.url));
    }

    await setGoogleIdentity(identity);
    const linkUrl = new URL("/login/link", req.url);
    linkUrl.searchParams.set("redirectTo", verifiedState.redirectTo);
    return NextResponse.redirect(linkUrl);
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    return NextResponse.redirect(new URL("/login?error=google_failed", req.url));
  }
}
