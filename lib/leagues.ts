import "server-only";

import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin";

export type LeagueVisibility = "public" | "private";
export type LeagueJoinPolicy = "open" | "approval";
export type MemberStatus = "active" | "pending";

export interface LeagueRow {
  id: number;
  name: string;
  slug: string;
  visibility: LeagueVisibility;
  join_policy: LeagueJoinPolicy;
  join_code: string;
  owner_id: number;
  start_match_id: number | null;
  created_at: string;
}

/** Turn a league name into a URL-safe base slug (no uniqueness suffix). */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "league";
}

/** Short, URL-safe random token (lowercase base36-ish). */
export function randomToken(bytes = 5): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Build a slug that is unique in the leagues table by appending a short random
 * suffix and retrying on the (rare) collision.
 */
export async function generateUniqueSlug(name: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const base = slugifyName(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${base}-${randomToken(3)}`;
    const { data, error } = await supabase
      .from("leagues")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return slug;
  }
  // Extremely unlikely; fall back to a fully random slug.
  return `${base}-${randomToken(6)}`;
}

/** A join code unique in the leagues table. */
export async function generateUniqueJoinCode(): Promise<string> {
  const supabase = getSupabaseAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomToken(5);
    const { data, error } = await supabase
      .from("leagues")
      .select("id")
      .eq("join_code", code)
      .maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
  return randomToken(8);
}

/** Fetch a league by slug, or null if it does not exist. */
export async function getLeagueBySlug(slug: string): Promise<LeagueRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leagues")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as LeagueRow | null) ?? null;
}

/** Fetch a league by join code, or null if it does not exist. */
export async function getLeagueByCode(code: string): Promise<LeagueRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("leagues")
    .select("*")
    .eq("join_code", code)
    .maybeSingle();
  if (error) throw error;
  return (data as LeagueRow | null) ?? null;
}

/**
 * The current player's membership in a league, or null if they are not a
 * member. Returns role + status so callers can gate on ownership/pending state.
 */
export async function getMembership(
  leagueId: number,
  entryId: number
): Promise<{ role: string; status: MemberStatus } | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("league_members")
    .select("role, status")
    .eq("league_id", leagueId)
    .eq("entry_id", entryId)
    .maybeSingle();
  if (error) throw error;
  return (data as { role: string; status: MemberStatus } | null) ?? null;
}
