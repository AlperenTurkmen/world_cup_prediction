/**
 * Shared helpers for manual prediction entry — the typed shape of a draft and
 * lenient sanitizers used when saving/loading drafts. Strict validation
 * (completeness, canonical team names, bracket consistency) lives in the submit
 * route, which finalizes a draft into an immutable entry.
 *
 * Pure module (no server-only) so the client and both routes can share it.
 */
import { PICKABLE_KO_MATCHES } from "./deriveBracket";

/** Goals are entered via 0–4 rails or the keyboard; cap defensively. */
export const MAX_GOALS = 20;
export const MAX_USERNAME_LEN = 40;

/** A partial group scoreline map: match_no (as string key) → { h, a }. */
export type GroupScoresMap = Record<string, { h: number; a: number }>;
/** A partial knockout winners map: match_no (as string key) → team name. */
export type KoWinnersMap = Record<string, string>;

export interface DraftPayload {
  username: string;
  groupScores: GroupScoresMap;
  koWinners: KoWinnersMap;
}

function isGoal(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_GOALS;
}

/** Keep only well-formed group scorelines for matches 1..72. Drops the rest. */
export function sanitizeGroupScores(raw: unknown): GroupScoresMap {
  const out: GroupScoresMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const matchNo = Number(key);
    if (!Number.isInteger(matchNo) || matchNo < 1 || matchNo > 72) continue;
    if (!value || typeof value !== "object") continue;
    const { h, a } = value as { h?: unknown; a?: unknown };
    if (isGoal(h) && isGoal(a)) out[String(matchNo)] = { h, a };
  }
  return out;
}

const PICKABLE = new Set(PICKABLE_KO_MATCHES);

/** Keep only winner picks for real, pickable knockout matches. Drops the rest. */
export function sanitizeKoWinners(raw: unknown): KoWinnersMap {
  const out: KoWinnersMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const matchNo = Number(key);
    if (!PICKABLE.has(matchNo)) continue;
    if (typeof value === "string" && value.trim().length > 0) out[String(matchNo)] = value.trim();
  }
  return out;
}
