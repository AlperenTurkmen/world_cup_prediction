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
/**
 * A partial knockout scoreline map: match_no (as string key) → { h, a, pen? }.
 * `pen` (the penalty-shoot-out winner team) is present only on a level score.
 */
export type KoScoresMap = Record<string, { h: number; a: number; pen?: string }>;

export interface DraftPayload {
  username: string;
  groupScores: GroupScoresMap;
  koScores: KoScoresMap;
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

/** Keep only well-formed scorelines for real, pickable knockout matches. */
export function sanitizeKoScores(raw: unknown): KoScoresMap {
  const out: KoScoresMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const matchNo = Number(key);
    if (!PICKABLE.has(matchNo)) continue;
    if (!value || typeof value !== "object") continue;
    const { h, a, pen } = value as { h?: unknown; a?: unknown; pen?: unknown };
    if (!isGoal(h) || !isGoal(a)) continue;
    const entry: { h: number; a: number; pen?: string } = { h, a };
    if (typeof pen === "string" && pen.trim().length > 0) entry.pen = pen.trim();
    out[String(matchNo)] = entry;
  }
  return out;
}
