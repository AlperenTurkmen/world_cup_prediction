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

type RawScorePair = { home?: number | null; away?: number | null } | null;

/** The slice of football-data.org's match object we depend on. */
interface RawMatch {
  stage?: string;
  status?: string;
  utcDate?: string | null;
  homeTeam?: { name?: string | null } | null;
  awayTeam?: { name?: string | null } | null;
  score?: {
    winner?: ApiWinner;
    /** How the match was decided: REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT. */
    duration?: string | null;
    /**
     * The final score. Cumulative through extra time — but for a shoot-out it
     * ALSO includes the penalty goals, so it can't be stored as-is then.
     */
    fullTime?: RawScorePair;
    /** 90-minute score (only present when the match went beyond regulation). */
    regularTime?: RawScorePair;
    /** Goals scored in the extra-time period ONLY (not cumulative). */
    extraTime?: RawScorePair;
    /** Shoot-out goals only. */
    penalties?: RawScorePair;
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

function num(v: number | null | undefined): number | null {
  return typeof v === "number" ? v : null;
}

/**
 * The match score (through extra time, excluding any shoot-out), or nulls.
 *
 * `fullTime` is the final cumulative score for REGULAR and EXTRA_TIME matches,
 * but for a PENALTY_SHOOTOUT it also counts the penalty goals (e.g. a 1-1 game
 * decided 4-3 on penalties arrives as fullTime 5-4). For those we rebuild the
 * 120-minute score from regularTime + extraTime (period scores), falling back
 * to fullTime − penalties.
 */
function matchScore(score: RawMatch["score"]): { home: number | null; away: number | null } {
  const ft = score?.fullTime ?? null;
  let home = num(ft?.home);
  let away = num(ft?.away);
  if (score?.duration === "PENALTY_SHOOTOUT") {
    const rtH = num(score.regularTime?.home);
    const rtA = num(score.regularTime?.away);
    const etH = num(score.extraTime?.home);
    const etA = num(score.extraTime?.away);
    const penH = num(score.penalties?.home);
    const penA = num(score.penalties?.away);
    if (rtH !== null && rtA !== null && etH !== null && etA !== null) {
      home = rtH + etH;
      away = rtA + etA;
    } else if (home !== null && away !== null && penH !== null && penA !== null) {
      home -= penH;
      away -= penA;
    } else {
      home = null;
      away = null;
    }
  }
  return { home, away };
}

/** Pure: flatten raw API matches to NormalizedMatch[]. Exported for tests. */
export function normalizeMatches(raw: RawMatch[]): NormalizedMatch[] {
  return raw.map((m) => {
    const homeApi = typeof m.homeTeam?.name === "string" ? m.homeTeam.name.trim() : null;
    const awayApi = typeof m.awayTeam?.name === "string" ? m.awayTeam.name.trim() : null;
    const { home, away } = matchScore(m.score ?? null);
    return {
      stage: (m.stage ?? "") as ApiStage,
      status: (m.status ?? "") as ApiStatus,
      homeApi: homeApi || null,
      awayApi: awayApi || null,
      homeGoals: home,
      awayGoals: away,
      winner: (m.score?.winner ?? null) as ApiWinner,
      kickoff: typeof m.utcDate === "string" && m.utcDate ? m.utcDate : null,
    };
  });
}

export { FootballDataError };
