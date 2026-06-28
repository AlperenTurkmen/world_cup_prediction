/**
 * football-data.org API client (free tier).
 *
 * The free tier includes the FIFA World Cup competition (code `WC`), allows
 * ~10 requests/minute, and authenticates with an `X-Auth-Token` header. We only
 * ever read finished match results, so the lack of a true live feed is fine.
 *
 * `fetchWorldCupMatches` is the only network call; `normalizeMatches` is a pure
 * shaper so the sync logic in `lib/syncResults.ts` stays unit-testable.
 */

const API_BASE = "https://api.football-data.org/v4";
const WC_MATCHES_URL = `${API_BASE}/competitions/WC/matches`;
const WC_TEAMS_URL = `${API_BASE}/competitions/WC/teams`;

/** Knockout/group stage labels football-data.org returns for a 48-team World Cup. */
export type ApiStage =
  | "GROUP_STAGE"
  | "LAST_32"
  | "LAST_16"
  | "QUARTER_FINALS"
  | "SEMI_FINALS"
  | "THIRD_PLACE"
  | "FINAL"
  | (string & {});

export type ApiStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "EXTRA_TIME"
  | "PENALTY_SHOOTOUT"
  | "FINISHED"
  | "SUSPENDED"
  | "POSTPONED"
  | "CANCELLED"
  | "AWARDED"
  | (string & {});

export type ApiWinner = "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;

/** The slice of football-data.org's match object we depend on. */
interface RawMatch {
  stage?: string;
  status?: string;
  utcDate?: string | null;
  homeTeam?: { name?: string | null } | null;
  awayTeam?: { name?: string | null } | null;
  score?: {
    winner?: ApiWinner;
    fullTime?: { home?: number | null; away?: number | null } | null;
  } | null;
}

/** A match flattened to just what the sync needs. Team names are still API names. */
export interface NormalizedMatch {
  stage: ApiStage;
  status: ApiStatus;
  /** Raw API team names; null before the draw populates a knockout slot. */
  homeApi: string | null;
  awayApi: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  /** Match outcome per the API (accounts for ET/penalties on its side). */
  winner: ApiWinner;
  /** Scheduled kickoff (ISO, UTC) — the authoritative real schedule. */
  kickoff: string | null;
}

class FootballDataError extends Error {}

function authHeaders(): Record<string, string> {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new FootballDataError("Missing FOOTBALL_DATA_API_KEY environment variable.");
  return { "X-Auth-Token": key };
}

/** Fetch every World Cup match (all stages, all statuses). */
export async function fetchWorldCupMatches(): Promise<NormalizedMatch[]> {
  const res = await fetch(WC_MATCHES_URL, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new FootballDataError(`football-data.org returned ${res.status} ${res.statusText}.`);
  }
  const body = (await res.json()) as { matches?: RawMatch[] };
  return normalizeMatches(body.matches ?? []);
}

/** Fetch the World Cup team names as the API spells them (used by the map check script). */
export async function fetchWorldCupTeamNames(): Promise<string[]> {
  const res = await fetch(WC_TEAMS_URL, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new FootballDataError(`football-data.org returned ${res.status} ${res.statusText}.`);
  }
  const body = (await res.json()) as { teams?: { name?: string | null }[] };
  return (body.teams ?? [])
    .map((t) => (typeof t.name === "string" ? t.name.trim() : ""))
    .filter((n) => n.length > 0);
}

/** Pure: flatten raw API matches to NormalizedMatch[]. Exported for tests. */
export function normalizeMatches(raw: RawMatch[]): NormalizedMatch[] {
  return raw.map((m) => {
    const ft = m.score?.fullTime ?? null;
    const homeApi = typeof m.homeTeam?.name === "string" ? m.homeTeam.name.trim() : null;
    const awayApi = typeof m.awayTeam?.name === "string" ? m.awayTeam.name.trim() : null;
    return {
      stage: (m.stage ?? "") as ApiStage,
      status: (m.status ?? "") as ApiStatus,
      homeApi: homeApi || null,
      awayApi: awayApi || null,
      homeGoals: typeof ft?.home === "number" ? ft.home : null,
      awayGoals: typeof ft?.away === "number" ? ft.away : null,
      winner: (m.score?.winner ?? null) as ApiWinner,
      kickoff: typeof m.utcDate === "string" && m.utcDate ? m.utcDate : null,
    };
  });
}

export { FootballDataError };
