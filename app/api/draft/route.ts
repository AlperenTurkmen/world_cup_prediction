/**
 * GET/PUT /api/draft — resumable manual-entry drafts.
 *
 * A draft is keyed to the user's Google account (the pending Google identity
 * cookie set by the OAuth flow), so progress can be saved and resumed on any
 * device by signing in with Google again. Drafts are never scored; finalizing
 * one into an immutable entry happens in POST /api/upload/manual, which also
 * deletes the draft.
 *
 * Supabase is touched only here on the server — never from the client.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getPendingGoogleIdentity } from "@/lib/googleAuth";
import { getCurrentPlayer } from "@/lib/playerAuth";
import {
  sanitizeGroupScores,
  sanitizeKoWinners,
  MAX_USERNAME_LEN,
  type DraftPayload,
} from "@/lib/manualEntry";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Please continue with Google before entering predictions." },
    { status: 401 },
  );
}

export async function GET() {
  const [player, identity] = await Promise.all([getCurrentPlayer(), getPendingGoogleIdentity()]);
  if (player) {
    return NextResponse.json({ ok: false, error: "You already have an entry." }, { status: 409 });
  }
  if (!identity) return unauthorized();

  const { data, error } = await getSupabaseAdmin()
    .from("entry_drafts")
    .select("username, group_scores, ko_winners, updated_at")
    .eq("google_sub", identity.sub)
    .maybeSingle();

  if (error) {
    console.error("Load draft failed:", error);
    return NextResponse.json({ ok: false, error: "Could not load your draft." }, { status: 500 });
  }

  const draft: DraftPayload | null = data
    ? {
        username: data.username ?? "",
        groupScores: sanitizeGroupScores(data.group_scores),
        koWinners: sanitizeKoWinners(data.ko_winners),
      }
    : null;

  return NextResponse.json({ ok: true, draft, updatedAt: data?.updated_at ?? null });
}

export async function PUT(req: Request) {
  const [player, identity] = await Promise.all([getCurrentPlayer(), getPendingGoogleIdentity()]);
  if (player) {
    return NextResponse.json({ ok: false, error: "You already have an entry." }, { status: 409 });
  }
  if (!identity) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const username = typeof raw.username === "string" ? raw.username.trim().slice(0, MAX_USERNAME_LEN) : "";
  const groupScores = sanitizeGroupScores(raw.groupScores);
  const koWinners = sanitizeKoWinners(raw.koWinners);

  const { error } = await getSupabaseAdmin().from("entry_drafts").upsert(
    {
      google_sub: identity.sub,
      google_email: identity.email,
      username: username || null,
      group_scores: groupScores,
      ko_winners: koWinners,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "google_sub" },
  );

  if (error) {
    console.error("Save draft failed:", error);
    return NextResponse.json({ ok: false, error: "Could not save your draft." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    savedCount: Object.keys(groupScores).length,
  });
}
