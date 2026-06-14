import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { setPlayerSession, verifyPassword } from "@/lib/playerAuth";
import { clearGoogleIdentity, getPendingGoogleIdentity } from "@/lib/googleAuth";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  const identity = await getPendingGoogleIdentity();
  if (!identity) {
    return jsonError("Please continue with Google again before linking an entry.", 401);
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Expected a JSON request body.", 400);
  }

  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return jsonError("Please enter both username and password.", 400);
  }

  const supabase = getSupabaseAdmin();
  const { data: entry, error } = await supabase
    .from("entries")
    .select("id, username, password_hash, google_sub")
    .ilike("username", username)
    .single();

  if (error || !entry) {
    return jsonError("Invalid username or password.", 401);
  }
  if (!entry.password_hash || !verifyPassword(password, entry.password_hash)) {
    return jsonError("Invalid username or password.", 401);
  }
  if (entry.google_sub && entry.google_sub !== identity.sub) {
    return jsonError("That entry is already linked to a different Google account.", 409);
  }

  if (!entry.google_sub) {
    const { data: updatedEntry, error: updateErr } = await supabase
      .from("entries")
      .update({
        google_sub: identity.sub,
        google_email: identity.email,
        google_linked_at: new Date().toISOString(),
      })
      .eq("id", entry.id)
      .is("google_sub", null)
      .select("id")
      .maybeSingle();

    if (updateErr) {
      if (updateErr.code === "23505") {
        return jsonError("That Google account is already linked to another entry.", 409);
      }
      console.error("Google entry link failed:", updateErr);
      return jsonError("Could not link that Google account. Please try again.", 500);
    }
    if (!updatedEntry) {
      return jsonError("That entry is already linked to a different Google account.", 409);
    }
  }

  await clearGoogleIdentity();
  await setPlayerSession(entry.id, entry.username);
  return NextResponse.json({ ok: true, entryId: entry.id, username: entry.username });
}
