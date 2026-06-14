import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyPassword, setPlayerSession } from "@/lib/playerAuth";

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Please enter both username and password." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    // Fetch user details by username (case-insensitive)
    const { data: entry, error } = await supabase
      .from("entries")
      .select("id, username, password_hash")
      .ilike("username", username.trim())
      .eq("is_hidden", false)
      .single();

    if (error || !entry) {
      return NextResponse.json(
        { ok: false, error: "Invalid username or password." },
        { status: 401 }
      );
    }

    // Verify password (older entries might not have a password, we must check if password_hash is set)
    if (!entry.password_hash) {
      return NextResponse.json(
        { ok: false, error: "This entry does not have a password configured. Please use Google sign-in." },
        { status: 401 }
      );
    }

    const isMatch = verifyPassword(password, entry.password_hash);
    if (!isMatch) {
      return NextResponse.json(
        { ok: false, error: "Invalid username or password." },
        { status: 401 }
      );
    }

    // Set the cookie
    await setPlayerSession(entry.id, entry.username);

    return NextResponse.json({
      ok: true,
      entryId: entry.id,
      username: entry.username,
    });
  } catch (err) {
    console.error("Login API error:", err);
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
