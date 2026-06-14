import { NextResponse } from "next/server";
import {
  createGoogleOAuthState,
  getGoogleConfig,
  sanitizeRedirectTo,
  setGoogleOAuthStateCookie,
} from "@/lib/googleAuth";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const redirectTo = sanitizeRedirectTo(searchParams.get("redirectTo"));
    const state = createGoogleOAuthState(redirectTo);
    const { clientId } = getGoogleConfig();

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", new URL("/api/auth/google/callback", req.url).toString());
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");

    await setGoogleOAuthStateCookie(state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("Google OAuth start failed:", err);
    return NextResponse.redirect(new URL("/login?error=google_config", req.url));
  }
}
