import { NextResponse } from "next/server";
import { clearPlayerSession } from "@/lib/playerAuth";

export async function POST() {
  await clearPlayerSession();
  return NextResponse.json({ ok: true });
}
