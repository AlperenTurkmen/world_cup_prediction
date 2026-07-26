/**
 * "Wrapped" — end-of-tournament analytics (docs/WRAPPED_PLAN.md).
 *
 * PURE module (no `server-only`, no Supabase): it takes the raw, frozen
 * tournament rows as `WrappedInput` and returns a fully-typed `WrappedData`
 * (global block + per-user blocks + agreement matrix + awards + personas +
 * snapshot timeline + team difficulty). The DB fetch + cache write live in
 * `scripts/buildWrapped.ts`; the UI just renders the returned object.
 *
 * Design note (n = 5): with exactly five predictors we drop percentiles/clusters
 * and lean on named, per-player + full-pairwise + per-game narratives.
 *
 * Scoring split (Phase 0 finding): the authoritative per-bucket totals
 * (group / ranking / knockout) come straight from the SQL `leaderboard` view
 * (correctly fairness-gated). This module only *re-derives* the knockout points
 * BY ROUND (for the timeline) and validates that its per-round sum equals the
 * view's `knockout_points`. All the "fun accuracy" stats (exacts, biases,
 * similarity, contrarian calls) are computed raw over each player's 72 group
 * predictions — fair here because the eligibility gate (group matches 1–8) is
 * identical for all five players.
 */

import {
  scoreGroupMatch,
  DEFAULT_MATCH_WEIGHTS,
  type ScoringWeights,
} from "@/lib/groupMatchScore";
import { ADV_ROUNDS, type AdvRound } from "@/lib/rounds";

// =============================================================================
// Input row shapes (mirror the DB tables / leaderboard view)
// =============================================================================

export interface DbEntry {
  id: number;
  username: string;
  created_at: string;
  is_hidden?: boolean;
}
export interface DbPrediction {
  entry_id: number;
  match_id: number;
  pred_home: number;
  pred_away: number;
  is_score_eligible: boolean;
}
export interface DbMatch {
  id: number;
  match_no: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  home_goals: number | null;
  away_goals: number | null;
}
export interface DbKnockoutPrediction {
  entry_id: number;
  match_no: number;
  home_team: string;
  away_team: string;
  pred_home: number;
  pred_away: number;
  penalty_winner: string | null;
  is_score_eligible: boolean;
}
export interface DbTourPrediction {
  entry_id: number;
  match_no: number;
  pred_home: number;
  pred_away: number;
  penalty_winner: string | null;
  updated_at: string;
}
export interface DbAdvancementPrediction {
  entry_id: number;
  round: AdvRound;
  team: string;
}
export interface DbActualAdvancer {
  round: AdvRound;
  team: string;
  logged_at: string;
}
export interface DbActualKnockout {
  match_no: number;
  home_team: string | null;
  away_team: string | null;
  home_goals: number | null;
  away_goals: number | null;
  penalty_winner: string | null;
  kickoff_at: string | null;
}
export interface DbTeamGroup {
  team: string;
  group_letter: string;
}
export interface DbRoundWeight {
  round: string;
  weight: number;
}
export interface DbScoringWeight {
  key: string;
  value: number;
}
export interface DbLeaderboardRow {
  entry_id: number;
  username: string;
  champion_pick: string | null;
  group_points: number;
  ranking_points: number;
  knockout_points: number;
  total: number;
  exact_count: number;
  played_count: number;
  champion_correct: number;
  created_at: string;
}

export interface WrappedInput {
  entries: DbEntry[];
  predictions: DbPrediction[];
  matches: DbMatch[];
  knockoutPredictions: DbKnockoutPrediction[];
  tourPredictions: DbTourPrediction[];
  advancementPredictions: DbAdvancementPrediction[];
  actualAdvancers: DbActualAdvancer[];
  actualKnockout: DbActualKnockout[];
  teamGroups: DbTeamGroup[];
  roundWeights: DbRoundWeight[];
  scoringWeights: DbScoringWeight[];
  leaderboard: DbLeaderboardRow[];
}

// =============================================================================
// Output shapes
// =============================================================================

/** Knockout rounds used for the timeline / phase breakdown. THIRD = 3rd-place. */
export const KO_ROUNDS = ["R32", "R16", "QF", "SF", "THIRD", "FINAL"] as const;
export type KoRound = (typeof KO_ROUNDS)[number];

/** Human phase labels for the timeline checkpoints. */
export const TIMELINE_CHECKPOINTS = [
  "Groups",
  "R32",
  "R16",
  "QF",
  "SF",
  "Final",
] as const;

export interface MatchLine {
  matchNo: number;
  home: string;
  away: string;
  actualHome: number;
  actualAway: number;
}

export interface UserGamePick extends MatchLine {
  predHome: number;
  predAway: number;
  points: number;
  isExact: boolean;
  isOutcome: boolean;
  eligible: boolean;
}

export interface Superlative {
  key: string;
  emoji: string;
  title: string;
  blurb: string;
  winner: string; // username
  value: string; // formatted stat behind the award
}

export interface TeamDifficulty {
  team: string;
  group: string;
  avgGoalError: number; // mean |pred-actual| over 5 players × its group games
  rankExactShare: number; // fraction of 5 who nailed its exact group finish
  actualRank: number; // final group position 1..4
}

export interface TeamRating {
  team: string;
  predictedDepth: number; // pool avg depth 0..6
  actualDepth: number; // 0..6
  gap: number; // actual - predicted (positive = underrated)
}

export interface Persona {
  key: string;
  emoji: string;
  name: string;
  scoutingReport: string;
}

export interface PairSimilarity {
  a: string; // username
  b: string;
  identicalScorelines: number; // of 72
  sameOutcome: number; // of 72
  sameChampion: boolean;
}

export interface UserWrapped {
  entryId: number;
  username: string;
  slug: string;

  // headline (authoritative, from the leaderboard view)
  rank: number;
  total: number;
  groupPoints: number;
  rankingPoints: number;
  knockoutPoints: number;
  championPick: string | null;
  championCorrect: boolean;

  // group-stage accuracy (raw over 72)
  exactCountRaw: number;
  exactCountEligible: number;
  outcomeHits: number; // of 72
  nearMissCount: number; // 1 goal from a perfect score
  bestGame: UserGamePick;
  worstGame: UserGamePick; // biggest goal-error whiff
  soloCorrectCount: number; // only one of 5 to call the outcome
  bestSoloCall: UserGamePick | null;

  // tendencies
  goalsPerGame: number;
  drawsPredicted: number;
  homeBias: number; // mean(predHome - predAway)
  favoriteScoreline: { score: string; count: number; landed: number };
  maverickScore: number; // of 72, times against the pool-majority outcome

  // ranking
  rankExact: number; // of 48
  rankAdjacent: number;

  // knockouts
  koPointsByRound: Record<KoRound, number>;
  advancementByRound: Record<AdvRound, { predicted: number; correct: number }>;
  championJourneyRounds: number; // how many rounds the champion pick actually reached
  bracketSurvival: { qf: number; sf: number; finalists: number };
  tourGamesPlayed: number;
  tourPoints: number;
  tourExacts: number;
  foresightPoints: number;
  penaltyProphet: number; // correct shoot-out winners called (tours)
  mvpTeam: { team: string; points: number } | null;
  believedIn: string | null; // deepest team they backed (champion pick)
  kryptoniteGroup: { group: string; points: number } | null;

  // phases
  phasePoints: { phase: string; points: number }[];
  bestPhase: string;

  // social
  twin: { username: string; identical: number } | null;
  opposite: { username: string; identical: number } | null;
  closestRival: { username: string; margin: number } | null;
  headToHead: { username: string; wins: number; losses: number; ties: number }[];

  // timing
  submissionRank: number; // 1 = earliest of 5
  submittedAt: string;

  // narrative
  persona: Persona;

  // timeline
  cumulative: number[]; // per checkpoint
  rankAt: number[]; // per checkpoint
}

export interface GlobalWrapped {
  podium: DbLeaderboardRow[]; // top 3
  leaderboard: (DbLeaderboardRow & { rank: number })[];
  champion: string | null;
  awards: Superlative[];
  agreementMatrix: {
    usernames: string[];
    identical: number[][]; // symmetric, of 72
  };
  mostSimilarPair: PairSimilarity | null;
  mostDifferentPair: PairSimilarity | null;
  hardestTeams: TeamDifficulty[]; // top few, hardest first
  easiestTeams: TeamDifficulty[]; // easiest first
  mostOverrated: TeamRating[];
  mostUnderrated: TeamRating[];
  groupReportCards: { group: string; avgRankAccuracy: number }[];
  collectiveTriumphs: MatchLine[]; // all 5 got the outcome
  collectiveBlunders: MatchLine[]; // all 5 missed the outcome
  biggestShock: (MatchLine & { collectiveError: number }) | null;
  mostPredictable: (MatchLine & { collectiveError: number }) | null;
  singleGameHero: { username: string; game: UserGamePick } | null;
  championPicks: { username: string; pick: string | null; correct: boolean }[];
  goals: {
    actualTotal: number;
    perGame: number;
    poolPredictedTotal: number;
    biggestOptimist: { username: string; perGame: number };
    biggestPragmatist: { username: string; perGame: number };
  };
  timeline: {
    checkpoints: string[];
    series: {
      username: string;
      entryId: number;
      cumulative: number[];
      rankAt: number[];
    }[];
    leadChanges: { checkpoint: string; leader: string; from: string | null }[];
  };
}

export interface WrappedMeta {
  generatedAt: string;
  playerCount: number;
  champion: string | null;
  groupGoals: number;
  groupGoalsPerGame: number;
  groupDraws: number;
  groupHomeWins: number;
  groupAwayWins: number;
  ineligibleGroupMatchNos: number[];
  firstKickoff: string | null;
  /** KO-by-round reconciliation mismatches vs the SQL view (should be empty). */
  warnings: string[];
}

export interface WrappedData {
  meta: WrappedMeta;
  global: GlobalWrapped;
  users: UserWrapped[]; // ranked order (1st … 5th)
}

// =============================================================================
// Helpers
// =============================================================================

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "player"
  );
}

/** R32 / R16 / QF / SF / THIRD / FINAL for a knockout match_no (73–104). */
export function koRoundOf(matchNo: number): KoRound | null {
  if (matchNo >= 73 && matchNo <= 88) return "R32";
  if (matchNo >= 89 && matchNo <= 96) return "R16";
  if (matchNo >= 97 && matchNo <= 100) return "QF";
  if (matchNo === 101 || matchNo === 102) return "SF";
  if (matchNo === 103) return "THIRD";
  if (matchNo === 104) return "FINAL";
  return null;
}

const DEPTH: Record<AdvRound, number> = {
  R32: 1,
  R16: 2,
  QF: 3,
  SF: 4,
  FINAL: 5,
  CHAMPION: 6,
};

interface StandingRow {
  team: string;
  group: string;
  rank: number;
  pts: number;
  gd: number;
  gf: number;
}

/** Group standings (pts → GD → GF → name) from a set of results, keyed by team. */
function computeStandings(
  results: { home: string; away: string; hg: number; ag: number }[],
  teamGroup: Map<string, string>,
): Map<string, StandingRow> {
  const acc = new Map<string, { group: string; pts: number; gf: number; ga: number }>();
  const bump = (team: string, gf: number, ga: number) => {
    const group = teamGroup.get(team);
    if (!group) return;
    const cur = acc.get(team) ?? { group, pts: 0, gf: 0, ga: 0 };
    const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
    cur.pts += pts;
    cur.gf += gf;
    cur.ga += ga;
    acc.set(team, cur);
  };
  for (const r of results) {
    bump(r.home, r.hg, r.ag);
    bump(r.away, r.ag, r.hg);
  }
  // group → sorted teams → rank
  const byGroup = new Map<string, { team: string; pts: number; gd: number; gf: number }[]>();
  for (const [team, v] of acc) {
    const list = byGroup.get(v.group) ?? [];
    list.push({ team, pts: v.pts, gd: v.gf - v.ga, gf: v.gf });
    byGroup.set(v.group, list);
  }
  const out = new Map<string, StandingRow>();
  for (const [group, list] of byGroup) {
    list.sort(
      (a, b) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team),
    );
    list.forEach((row, i) => {
      out.set(row.team, {
        team: row.team,
        group,
        rank: i + 1,
        pts: row.pts,
        gd: row.gd,
        gf: row.gf,
      });
    });
  }
  return out;
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

function scoreLineWeightsFrom(rows: DbScoringWeight[]): ScoringWeights {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    W_OUTCOME: map.get("W_OUTCOME") ?? DEFAULT_MATCH_WEIGHTS.W_OUTCOME,
    W_GOALDIFF: map.get("W_GOALDIFF") ?? DEFAULT_MATCH_WEIGHTS.W_GOALDIFF,
    W_TEAMGOALS: map.get("W_TEAMGOALS") ?? DEFAULT_MATCH_WEIGHTS.W_TEAMGOALS,
    W_EXACT: map.get("W_EXACT") ?? DEFAULT_MATCH_WEIGHTS.W_EXACT,
  };
}

// =============================================================================
// Main
// =============================================================================

export function buildWrapped(
  input: WrappedInput,
  now: string = new Date().toISOString(),
): WrappedData {
  const weights = scoreLineWeightsFrom(input.scoringWeights);
  const roundWeight = new Map(input.roundWeights.map((r) => [r.round, r.weight]));

  const entries = input.entries
    .filter((e) => !e.is_hidden)
    .slice()
    .sort((a, b) => a.id - b.id);
  const usernameOf = new Map(entries.map((e) => [e.id, e.username]));
  const teamGroup = new Map(input.teamGroups.map((t) => [t.team, t.group_letter]));

  const matchById = new Map(input.matches.map((m) => [m.id, m]));
  const matchByNo = new Map(input.matches.map((m) => [m.match_no, m]));
  const playedGroup = input.matches.filter(
    (m) => m.home_goals !== null && m.away_goals !== null,
  );

  // ---- Actual group aggregates ---------------------------------------------
  let groupGoals = 0;
  let groupDraws = 0;
  let groupHomeWins = 0;
  let groupAwayWins = 0;
  for (const m of playedGroup) {
    const hg = m.home_goals!;
    const ag = m.away_goals!;
    groupGoals += hg + ag;
    if (hg === ag) groupDraws++;
    else if (hg > ag) groupHomeWins++;
    else groupAwayWins++;
  }
  const firstKickoff =
    input.matches
      .map((m) => m.kickoff_at)
      .filter((k): k is string => !!k)
      .sort()[0] ?? null;

  // ineligible group match_nos (uniform across users; take the union to be safe)
  const ineligibleSet = new Set<number>();
  for (const p of input.predictions) {
    if (!p.is_score_eligible) {
      const m = matchById.get(p.match_id);
      if (m) ineligibleSet.add(m.match_no);
    }
  }

  // ---- Actual standings & advancers ----------------------------------------
  const actualStandings = computeStandings(
    playedGroup.map((m) => ({
      home: m.home_team,
      away: m.away_team,
      hg: m.home_goals!,
      ag: m.away_goals!,
    })),
    teamGroup,
  );
  const advancersByRound = new Map<AdvRound, Set<string>>();
  for (const r of ADV_ROUNDS) advancersByRound.set(r, new Set());
  for (const a of input.actualAdvancers) {
    advancersByRound.get(a.round)?.add(a.team);
  }
  const champion =
    [...(advancersByRound.get("CHAMPION") ?? [])][0] ?? null;

  // team → deepest actual round reached (depth number)
  const actualDepth = new Map<string, number>();
  for (const r of ADV_ROUNDS) {
    for (const team of advancersByRound.get(r) ?? []) {
      actualDepth.set(team, Math.max(actualDepth.get(team) ?? 0, DEPTH[r]));
    }
  }

  const koRoundDeadline = new Map<KoRound, number>(); // first kickoff ms per round
  for (const k of input.actualKnockout) {
    const r = koRoundOf(k.match_no);
    if (!r || !k.kickoff_at) continue;
    const t = new Date(k.kickoff_at).getTime();
    const cur = koRoundDeadline.get(r);
    if (cur === undefined || t < cur) koRoundDeadline.set(r, t);
  }
  const actualKoByNo = new Map(input.actualKnockout.map((k) => [k.match_no, k]));

  // ---- Group picks per user (72 games each) --------------------------------
  const predByEntry = new Map<number, DbPrediction[]>();
  for (const p of input.predictions) {
    const list = predByEntry.get(p.entry_id) ?? [];
    list.push(p);
    predByEntry.set(p.entry_id, list);
  }

  // Per-user per-match pick+score, indexed [entryId][matchNo]
  const gamePicks = new Map<number, Map<number, UserGamePick>>();
  for (const e of entries) {
    const inner = new Map<number, UserGamePick>();
    for (const p of predByEntry.get(e.id) ?? []) {
      const m = matchById.get(p.match_id);
      if (!m || m.home_goals === null || m.away_goals === null) continue;
      const s = scoreGroupMatch(
        p.pred_home,
        p.pred_away,
        m.home_goals,
        m.away_goals,
        weights,
      );
      inner.set(m.match_no, {
        matchNo: m.match_no,
        home: m.home_team,
        away: m.away_team,
        actualHome: m.home_goals,
        actualAway: m.away_goals,
        predHome: p.pred_home,
        predAway: p.pred_away,
        points: s.points,
        isExact: s.isExact,
        isOutcome: s.isOutcome,
        eligible: p.is_score_eligible,
      });
    }
    gamePicks.set(e.id, inner);
  }

  // pool-majority outcome per match (for maverick + contrarian)
  const majorityOutcome = new Map<number, number>();
  const outcomeCounts = new Map<number, Map<number, number>>(); // matchNo → outcome → count
  for (const m of playedGroup) {
    const counts = new Map<number, number>();
    for (const e of entries) {
      const g = gamePicks.get(e.id)?.get(m.match_no);
      if (!g) continue;
      const o = sign(g.predHome - g.predAway);
      counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    outcomeCounts.set(m.match_no, counts);
    let best = 0;
    let bestN = -1;
    for (const [o, n] of counts) {
      if (n > bestN) {
        bestN = n;
        best = o;
      }
    }
    majorityOutcome.set(m.match_no, best);
  }

  // ---- Pairwise similarity (identical scoreline / same outcome) -------------
  const usernames = entries.map((e) => e.username);
  const idIndex = new Map(entries.map((e, i) => [e.id, i]));
  const identical = entries.map(() => entries.map(() => 0));
  const sameOutcomeM = entries.map(() => entries.map(() => 0));
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      let idn = 0;
      let so = 0;
      for (const m of playedGroup) {
        const a = gamePicks.get(entries[i].id)?.get(m.match_no);
        const b = gamePicks.get(entries[j].id)?.get(m.match_no);
        if (!a || !b) continue;
        if (a.predHome === b.predHome && a.predAway === b.predAway) idn++;
        if (sign(a.predHome - a.predAway) === sign(b.predHome - b.predAway)) so++;
      }
      identical[i][j] = identical[j][i] = idn;
      sameOutcomeM[i][j] = sameOutcomeM[j][i] = so;
    }
  }

  // ---- Leaderboard lookups --------------------------------------------------
  const boardByEntry = new Map(input.leaderboard.map((r) => [r.entry_id, r]));
  const rankedBoard = input.leaderboard
    .slice()
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.exact_count - a.exact_count ||
        b.champion_correct - a.champion_correct ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  const finalRankOf = new Map(rankedBoard.map((r, i) => [r.entry_id, i + 1]));

  // submission order
  const bySubmission = entries
    .slice()
    .sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  const submissionRankOf = new Map(bySubmission.map((e, i) => [e.id, i + 1]));

  // advancement predictions per user
  const advPredByEntry = new Map<number, Map<AdvRound, Set<string>>>();
  for (const e of entries) {
    const m = new Map<AdvRound, Set<string>>();
    for (const r of ADV_ROUNDS) m.set(r, new Set());
    advPredByEntry.set(e.id, m);
  }
  for (const ap of input.advancementPredictions) {
    advPredByEntry.get(ap.entry_id)?.get(ap.round)?.add(ap.team);
  }

  // tour predictions per user
  const tourByEntry = new Map<number, DbTourPrediction[]>();
  for (const t of input.tourPredictions) {
    const list = tourByEntry.get(t.entry_id) ?? [];
    list.push(t);
    tourByEntry.set(t.entry_id, list);
  }
  // own-bracket KO predictions per user
  const koPredByEntry = new Map<number, DbKnockoutPrediction[]>();
  for (const k of input.knockoutPredictions) {
    const list = koPredByEntry.get(k.entry_id) ?? [];
    list.push(k);
    koPredByEntry.set(k.entry_id, list);
  }

  // =========================================================================
  // Per-user knockout points BY ROUND (advancement + tour + foresight + champ)
  // =========================================================================
  function koByRound(entryId: number): {
    byRound: Record<KoRound, number>;
    championPts: number;
    tourPoints: number;
    tourExacts: number;
    tourGamesPlayed: number;
    foresightPoints: number;
    penaltyProphet: number;
  } {
    const byRound: Record<KoRound, number> = {
      R32: 0,
      R16: 0,
      QF: 0,
      SF: 0,
      THIRD: 0,
      FINAL: 0,
    };

    // Advancement (C): intersection × weight, per round (R32..FINAL)
    const advPred = advPredByEntry.get(entryId)!;
    for (const r of ["R32", "R16", "QF", "SF", "FINAL"] as AdvRound[]) {
      const w = roundWeight.get(r) ?? 0;
      let correct = 0;
      for (const team of advPred.get(r) ?? []) {
        if (advancersByRound.get(r)?.has(team)) correct++;
      }
      byRound[r as KoRound] += correct * w;
    }
    // Champion (D)
    let championPts = 0;
    const champPick = [...(advPred.get("CHAMPION") ?? [])][0];
    if (champPick && advancersByRound.get("CHAMPION")?.has(champPick)) {
      championPts = roundWeight.get("CHAMPION") ?? 0;
    }

    // Tours (F): A-style scoreline, per round, gated by round deadline
    let tourPoints = 0;
    let tourExacts = 0;
    let tourGamesPlayed = 0;
    let penaltyProphet = 0;
    for (const t of tourByEntry.get(entryId) ?? []) {
      const r = koRoundOf(t.match_no);
      if (!r) continue;
      const akm = actualKoByNo.get(t.match_no);
      if (!akm || akm.home_goals === null || akm.away_goals === null) continue;
      const deadline = koRoundDeadline.get(r);
      if (deadline !== undefined && new Date(t.updated_at).getTime() >= deadline)
        continue;
      const s = scoreGroupMatch(
        t.pred_home,
        t.pred_away,
        akm.home_goals,
        akm.away_goals,
        weights,
      );
      byRound[r] += s.points;
      tourPoints += s.points;
      tourGamesPlayed++;
      if (s.isExact) tourExacts++;
      if (
        akm.home_goals === akm.away_goals &&
        t.penalty_winner &&
        akm.penalty_winner &&
        t.penalty_winner === akm.penalty_winner
      )
        penaltyProphet++;
    }

    // Foresight: exact matchup + exact score on own bracket, per round
    let foresightPoints = 0;
    for (const k of koPredByEntry.get(entryId) ?? []) {
      const r = koRoundOf(k.match_no);
      if (!r || r === "THIRD") continue;
      if (!k.is_score_eligible) continue;
      const akm = actualKoByNo.get(k.match_no);
      if (!akm || akm.home_goals === null || akm.away_goals === null) continue;
      if (
        k.home_team === akm.home_team &&
        k.away_team === akm.away_team &&
        k.pred_home === akm.home_goals &&
        k.pred_away === akm.away_goals
      ) {
        const w = roundWeight.get(r === "FINAL" ? "FINAL" : r) ?? 0;
        byRound[r] += w;
        foresightPoints += w;
      }
    }
    return {
      byRound,
      championPts,
      tourPoints,
      tourExacts,
      tourGamesPlayed,
      foresightPoints,
      penaltyProphet,
    };
  }

  // =========================================================================
  // Build each user
  // =========================================================================
  const users: UserWrapped[] = [];

  // precompute predicted standings per user (for ranking + team difficulty)
  const predStandingsByEntry = new Map<number, Map<string, StandingRow>>();
  for (const e of entries) {
    const results: { home: string; away: string; hg: number; ag: number }[] = [];
    for (const p of predByEntry.get(e.id) ?? []) {
      const m = matchById.get(p.match_id);
      if (!m) continue;
      results.push({
        home: m.home_team,
        away: m.away_team,
        hg: p.pred_home,
        ag: p.pred_away,
      });
    }
    predStandingsByEntry.set(e.id, computeStandings(results, teamGroup));
  }

  for (const e of entries) {
    const board = boardByEntry.get(e.id)!;
    const picks = [...(gamePicks.get(e.id)?.values() ?? [])];

    // accuracy
    let exactRaw = 0;
    let exactElig = 0;
    let outcomeHits = 0;
    let nearMiss = 0;
    let goalsPredicted = 0;
    let drawsPredicted = 0;
    let homeBiasSum = 0;
    let maverick = 0;
    let soloCorrect = 0;
    let bestGame: UserGamePick | null = null;
    let worstGame: UserGamePick | null = null;
    let bestSolo: UserGamePick | null = null;
    const scoreCounts = new Map<string, { count: number; landed: number }>();

    for (const g of picks) {
      goalsPredicted += g.predHome + g.predAway;
      homeBiasSum += g.predHome - g.predAway;
      if (g.predHome === g.predAway) drawsPredicted++;
      if (g.isExact) exactRaw++;
      if (g.isExact && g.eligible) exactElig++;
      if (g.isOutcome) outcomeHits++;
      const goalErr = Math.abs(g.predHome - g.actualHome) + Math.abs(g.predAway - g.actualAway);
      if (!g.isExact && goalErr === 1) nearMiss++;

      // favorite scoreline
      const key = `${g.predHome}-${g.predAway}`;
      const sc = scoreCounts.get(key) ?? { count: 0, landed: 0 };
      sc.count++;
      if (g.isExact) sc.landed++;
      scoreCounts.set(key, sc);

      // maverick vs pool majority
      const o = sign(g.predHome - g.predAway);
      if (o !== majorityOutcome.get(g.matchNo)) maverick++;

      // solo-correct: only one of 5 called this outcome AND it was right
      if (g.isOutcome) {
        const counts = outcomeCounts.get(g.matchNo);
        const actualO = sign(g.actualHome - g.actualAway);
        if (counts && counts.get(actualO) === 1) {
          soloCorrect++;
          if (!bestSolo || g.points > bestSolo.points) bestSolo = g;
        }
      }

      if (!bestGame || g.points > bestGame.points || (g.points === bestGame.points && g.matchNo < bestGame.matchNo))
        bestGame = g;
      if (!worstGame || goalErr > (Math.abs(worstGame.predHome - worstGame.actualHome) + Math.abs(worstGame.predAway - worstGame.actualAway)))
        worstGame = g;
    }

    // favorite scoreline (mode)
    let favScore = "";
    let favCount = 0;
    let favLanded = 0;
    for (const [key, sc] of scoreCounts) {
      if (sc.count > favCount) {
        favCount = sc.count;
        favScore = key;
        favLanded = sc.landed;
      }
    }

    // ranking accuracy vs actual
    const predSt = predStandingsByEntry.get(e.id)!;
    let rankExact = 0;
    let rankAdjacent = 0;
    for (const [team, actual] of actualStandings) {
      const pr = predSt.get(team);
      if (!pr) continue;
      if (pr.rank === actual.rank) rankExact++;
      else if (Math.abs(pr.rank - actual.rank) === 1) rankAdjacent++;
    }

    // knockout by round
    const ko = koByRound(e.id);
    const advByRound: Record<AdvRound, { predicted: number; correct: number }> = {
      R32: { predicted: 0, correct: 0 },
      R16: { predicted: 0, correct: 0 },
      QF: { predicted: 0, correct: 0 },
      SF: { predicted: 0, correct: 0 },
      FINAL: { predicted: 0, correct: 0 },
      CHAMPION: { predicted: 0, correct: 0 },
    };
    const advPred = advPredByEntry.get(e.id)!;
    for (const r of ADV_ROUNDS) {
      const pset = advPred.get(r) ?? new Set();
      let correct = 0;
      for (const team of pset) if (advancersByRound.get(r)?.has(team)) correct++;
      advByRound[r] = { predicted: pset.size, correct };
    }

    // champion journey
    const champPick = [...(advPred.get("CHAMPION") ?? [])][0] ?? board.champion_pick ?? null;
    const championJourneyRounds = champPick ? (actualDepth.get(champPick) ?? 0) : 0;
    const bracketSurvival = {
      qf: advByRound.QF.correct,
      sf: advByRound.SF.correct,
      finalists: advByRound.FINAL.correct,
    };

    // MVP team: sum group-match points attributed to each team + advancement weight
    const teamPoints = new Map<string, number>();
    for (const g of picks) {
      teamPoints.set(g.home, (teamPoints.get(g.home) ?? 0) + g.points);
      teamPoints.set(g.away, (teamPoints.get(g.away) ?? 0) + g.points);
    }
    for (const r of ["R32", "R16", "QF", "SF", "FINAL"] as AdvRound[]) {
      const w = roundWeight.get(r) ?? 0;
      for (const team of advPred.get(r) ?? []) {
        if (advancersByRound.get(r)?.has(team))
          teamPoints.set(team, (teamPoints.get(team) ?? 0) + w);
      }
    }
    let mvpTeam: { team: string; points: number } | null = null;
    for (const [team, pts] of teamPoints) {
      if (!mvpTeam || pts > mvpTeam.points) mvpTeam = { team, points: pts };
    }

    // kryptonite group: lowest group-match points among the 12 groups
    const groupPts = new Map<string, number>();
    for (const g of picks) {
      const grp = teamGroup.get(g.home);
      if (grp) groupPts.set(grp, (groupPts.get(grp) ?? 0) + g.points);
    }
    let kryptonite: { group: string; points: number } | null = null;
    for (const [grp, pts] of groupPts) {
      if (!kryptonite || pts < kryptonite.points) kryptonite = { group: grp, points: pts };
    }

    // phase points
    const phasePoints = [
      { phase: "Groups", points: board.group_points + board.ranking_points },
      { phase: "R32", points: ko.byRound.R32 },
      { phase: "R16", points: ko.byRound.R16 },
      { phase: "QF", points: ko.byRound.QF },
      { phase: "SF", points: ko.byRound.SF },
      { phase: "Final", points: ko.byRound.FINAL + ko.byRound.THIRD + ko.championPts },
    ];
    const bestPhase = phasePoints.reduce((a, b) => (b.points > a.points ? b : a)).phase;

    // social
    const i = idIndex.get(e.id)!;
    let twin: { username: string; identical: number } | null = null;
    let opposite: { username: string; identical: number } | null = null;
    for (let j = 0; j < entries.length; j++) {
      if (j === i) continue;
      const idn = identical[i][j];
      if (!twin || idn > twin.identical) twin = { username: usernames[j], identical: idn };
      if (!opposite || idn < opposite.identical)
        opposite = { username: usernames[j], identical: idn };
    }
    // closest rival by total
    let closestRival: { username: string; margin: number } | null = null;
    for (const other of entries) {
      if (other.id === e.id) continue;
      const ob = boardByEntry.get(other.id)!;
      const margin = Math.abs(ob.total - board.total);
      if (!closestRival || margin < closestRival.margin)
        closestRival = { username: other.username, margin };
    }
    // head to head over 72 games
    const headToHead: { username: string; wins: number; losses: number; ties: number }[] = [];
    for (const other of entries) {
      if (other.id === e.id) continue;
      let w = 0;
      let l = 0;
      let t = 0;
      for (const m of playedGroup) {
        const a = gamePicks.get(e.id)?.get(m.match_no);
        const b = gamePicks.get(other.id)?.get(m.match_no);
        if (!a || !b) continue;
        if (a.points > b.points) w++;
        else if (a.points < b.points) l++;
        else t++;
      }
      headToHead.push({ username: other.username, wins: w, losses: l, ties: t });
    }

    users.push({
      entryId: e.id,
      username: e.username,
      slug: slugify(e.username),
      rank: finalRankOf.get(e.id)!,
      total: board.total,
      groupPoints: board.group_points,
      rankingPoints: board.ranking_points,
      knockoutPoints: board.knockout_points,
      championPick: board.champion_pick,
      championCorrect: board.champion_correct === 1,
      exactCountRaw: exactRaw,
      exactCountEligible: exactElig,
      outcomeHits,
      nearMissCount: nearMiss,
      bestGame: bestGame!,
      worstGame: worstGame!,
      soloCorrectCount: soloCorrect,
      bestSoloCall: bestSolo,
      goalsPerGame: picks.length ? goalsPredicted / picks.length : 0,
      drawsPredicted,
      homeBias: picks.length ? homeBiasSum / picks.length : 0,
      favoriteScoreline: { score: favScore, count: favCount, landed: favLanded },
      maverickScore: maverick,
      rankExact,
      rankAdjacent,
      koPointsByRound: ko.byRound,
      advancementByRound: advByRound,
      championJourneyRounds,
      bracketSurvival,
      tourGamesPlayed: ko.tourGamesPlayed,
      tourPoints: ko.tourPoints,
      tourExacts: ko.tourExacts,
      foresightPoints: ko.foresightPoints,
      penaltyProphet: ko.penaltyProphet,
      mvpTeam,
      believedIn: champPick,
      kryptoniteGroup: kryptonite,
      phasePoints,
      bestPhase,
      twin,
      opposite,
      closestRival,
      headToHead,
      submissionRank: submissionRankOf.get(e.id)!,
      submittedAt: e.created_at,
      persona: { key: "", emoji: "", name: "", scoutingReport: "" }, // filled below
      cumulative: [],
      rankAt: [],
    });
  }

  // =========================================================================
  // KO-by-round reconciliation check vs the view's knockout_points
  // =========================================================================
  const warnings: string[] = [];
  for (const u of users) {
    const roundSum = KO_ROUNDS.reduce((s, r) => s + u.koPointsByRound[r], 0);
    // championPts already folded into phasePoints Final; recover it:
    const ko = koByRound(u.entryId);
    const mySum = roundSum + ko.championPts;
    if (mySum !== u.knockoutPoints) {
      warnings.push(
        `KO reconciliation mismatch for ${u.username}: derived ${mySum} vs view ${u.knockoutPoints}`,
      );
    }
  }

  // =========================================================================
  // Timeline (snapshot checkpoints)
  // =========================================================================
  const checkpoints = [...TIMELINE_CHECKPOINTS];
  for (const u of users) {
    const base = u.groupPoints + u.rankingPoints;
    const ko = u.koPointsByRound;
    const champPts = koByRound(u.entryId).championPts;
    const cum = [
      base,
      base + ko.R32,
      base + ko.R32 + ko.R16,
      base + ko.R32 + ko.R16 + ko.QF,
      base + ko.R32 + ko.R16 + ko.QF + ko.SF,
      base + ko.R32 + ko.R16 + ko.QF + ko.SF + ko.THIRD + ko.FINAL + champPts,
    ];
    u.cumulative = cum;
  }
  // rank at each checkpoint
  for (let c = 0; c < checkpoints.length; c++) {
    const order = users
      .slice()
      .sort((a, b) => b.cumulative[c] - a.cumulative[c] || a.entryId - b.entryId);
    order.forEach((u, idx) => {
      u.rankAt[c] = idx + 1;
    });
  }
  // lead changes
  const leadChanges: { checkpoint: string; leader: string; from: string | null }[] = [];
  let prevLeader: string | null = null;
  for (let c = 0; c < checkpoints.length; c++) {
    const leader = users.find((u) => u.rankAt[c] === 1)!;
    if (leader.username !== prevLeader) {
      leadChanges.push({ checkpoint: checkpoints[c], leader: leader.username, from: prevLeader });
      prevLeader = leader.username;
    }
  }

  // =========================================================================
  // Personas (greedy distinct assignment)
  // =========================================================================
  assignPersonas(users);

  // =========================================================================
  // Global block
  // =========================================================================
  const global = buildGlobal({
    users,
    rankedBoard,
    champion,
    entries,
    usernames,
    identical,
    gamePicks,
    playedGroup,
    teamGroup,
    actualStandings,
    predStandingsByEntry,
    advPredByEntry,
    actualDepth,
    weights,
    groupGoals,
    groupHomeWins,
    groupAwayWins,
    boardByEntry,
    checkpoints,
  });

  return {
    meta: {
      generatedAt: now,
      playerCount: entries.length,
      champion,
      groupGoals,
      groupGoalsPerGame: playedGroup.length ? groupGoals / playedGroup.length : 0,
      groupDraws,
      groupHomeWins,
      groupAwayWins,
      ineligibleGroupMatchNos: [...ineligibleSet].sort((a, b) => a - b),
      firstKickoff,
      warnings,
    },
    global,
    users: users.slice().sort((a, b) => a.rank - b.rank),
  };
}

// =============================================================================
// Personas
// =============================================================================

const PERSONA_DEFS: { key: string; emoji: string; name: string; report: string }[] = [
  { key: "precisionist", emoji: "🎯", name: "The Precisionist", report: "Lives for the exact scoreline — nailed more perfect scores than anyone." },
  { key: "gambler", emoji: "🃏", name: "The Gambler", report: "High risk, high variance — big swings, bigger stories." },
  { key: "chalk", emoji: "🐑", name: "The Chalk Merchant", report: "Trusts the form book and the crowd — rarely strays from consensus." },
  { key: "optimist", emoji: "📈", name: "The Optimist", report: "Sees goals everywhere — the pool's most generous scoreline-setter." },
  { key: "analyst", emoji: "🧮", name: "The Analyst", report: "Reads groups like a spreadsheet — the sharpest final-table forecaster." },
];

function assignPersonas(users: UserWrapped[]): void {
  const n = users.length;
  const rank = (vals: number[]): number[] => {
    // higher value = better; returns 0..1 normalized rank
    const order = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const out = new Array(vals.length).fill(0);
    order.forEach(([, i], idx) => (out[i] = n > 1 ? idx / (n - 1) : 1));
    return out;
  };
  const variance = users.map((u) => {
    const vals = u.phasePoints.map((p) => p.points);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  });
  const precision = rank(users.map((u) => u.exactCountRaw));
  const maverick = rank(users.map((u) => u.maverickScore));
  const chalk = rank(users.map((u) => -u.maverickScore));
  const optimist = rank(users.map((u) => u.goalsPerGame));
  const analyst = rank(users.map((u) => u.rankExact));
  const gambler = rank(users.map((u, i) => maverick[i] * 0.5 + rank(variance)[i] * 0.5));

  const signals: Record<string, number[]> = {
    precisionist: precision,
    gambler,
    chalk,
    optimist,
    analyst,
  };

  // greedy: strongest (user, persona) signal first, each used once
  const candidates: { user: number; persona: string; score: number }[] = [];
  users.forEach((_, ui) => {
    for (const key of Object.keys(signals)) {
      candidates.push({ user: ui, persona: key, score: signals[key][ui] });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.user - b.user);
  const takenUser = new Set<number>();
  const takenPersona = new Set<string>();
  for (const c of candidates) {
    if (takenUser.has(c.user) || takenPersona.has(c.persona)) continue;
    takenUser.add(c.user);
    takenPersona.add(c.persona);
    const def = PERSONA_DEFS.find((d) => d.key === c.persona)!;
    users[c.user].persona = {
      key: def.key,
      emoji: def.emoji,
      name: def.name,
      scoutingReport: def.report,
    };
  }
}

// =============================================================================
// Global block builder
// =============================================================================

interface GlobalArgs {
  users: UserWrapped[];
  rankedBoard: DbLeaderboardRow[];
  champion: string | null;
  entries: DbEntry[];
  usernames: string[];
  identical: number[][];
  gamePicks: Map<number, Map<number, UserGamePick>>;
  playedGroup: DbMatch[];
  teamGroup: Map<string, string>;
  actualStandings: Map<string, StandingRow>;
  predStandingsByEntry: Map<number, Map<string, StandingRow>>;
  advPredByEntry: Map<number, Map<AdvRound, Set<string>>>;
  actualDepth: Map<string, number>;
  weights: ScoringWeights;
  groupGoals: number;
  groupHomeWins: number;
  groupAwayWins: number;
  boardByEntry: Map<number, DbLeaderboardRow>;
  checkpoints: string[];
}

function buildGlobal(a: GlobalArgs): GlobalWrapped {
  const {
    users,
    rankedBoard,
    champion,
    entries,
    usernames,
    identical,
    gamePicks,
    playedGroup,
    teamGroup,
    actualStandings,
    predStandingsByEntry,
    advPredByEntry,
    actualDepth,
    boardByEntry,
  } = a;

  const byUsername = new Map(users.map((u) => [u.username, u]));

  // ---- Awards --------------------------------------------------------------
  const awards: Superlative[] = [];
  const argmax = (fn: (u: UserWrapped) => number) =>
    users.reduce((best, u) => (fn(u) > fn(best) ? u : best));
  const argmin = (fn: (u: UserWrapped) => number) =>
    users.reduce((best, u) => (fn(u) < fn(best) ? u : best));

  const oracle = rankedBoard[0];
  awards.push({
    key: "oracle",
    emoji: "🧠",
    title: "The Oracle",
    blurb: "Highest total score — the champion predictor.",
    winner: oracle.username,
    value: `${oracle.total} pts`,
  });
  const sharp = argmax((u) => u.exactCountRaw);
  awards.push({
    key: "sharpshooter",
    emoji: "🎯",
    title: "Sharpshooter",
    blurb: "Most exact group scorelines.",
    winner: sharp.username,
    value: `${sharp.exactCountRaw} exact scores`,
  });
  const maverick = argmax((u) => u.soloCorrectCount);
  awards.push({
    key: "maverick",
    emoji: "🃏",
    title: "The Maverick",
    blurb: "Most calls only they got right (lone correct outcome).",
    winner: maverick.username,
    value: `${maverick.soloCorrectCount} solo calls`,
  });
  const chalk = argmin((u) => u.maverickScore);
  awards.push({
    key: "chalk",
    emoji: "🐑",
    title: "The Chalk-Eater",
    blurb: "Most often sided with the pool majority.",
    winner: chalk.username,
    value: `${72 - chalk.maverickScore}/72 with the crowd`,
  });
  const optimist = argmax((u) => u.goalsPerGame);
  awards.push({
    key: "optimist",
    emoji: "📈",
    title: "The Optimist",
    blurb: "Highest average goals predicted per game.",
    winner: optimist.username,
    value: `${optimist.goalsPerGame.toFixed(2)} goals/game`,
  });
  const pragmatist = argmin((u) => u.goalsPerGame);
  awards.push({
    key: "pragmatist",
    emoji: "📉",
    title: "The Pragmatist",
    blurb: "Fewest goals predicted per game.",
    winner: pragmatist.username,
    value: `${pragmatist.goalsPerGame.toFixed(2)} goals/game`,
  });
  const draws = argmax(
    (u) => {
      // correct draws = predicted draw AND actual draw
      let c = 0;
      for (const g of gamePicks.get(u.entryId)?.values() ?? []) {
        if (g.predHome === g.predAway && g.actualHome === g.actualAway) c++;
      }
      return c;
    },
  );
  const drawWins = (() => {
    let c = 0;
    for (const g of gamePicks.get(draws.entryId)?.values() ?? [])
      if (g.predHome === g.predAway && g.actualHome === g.actualAway) c++;
    return c;
  })();
  awards.push({
    key: "draws",
    emoji: "🤝",
    title: "The Draw Whisperer",
    blurb: "Most correctly-called draws.",
    winner: draws.username,
    value: `${drawWins} draws called`,
  });
  const bracketeer = argmax((u) => u.knockoutPoints);
  awards.push({
    key: "knockout-king",
    emoji: "👑",
    title: "Knockout King",
    blurb: "Most points earned in the knockout phase.",
    winner: bracketeer.username,
    value: `${bracketeer.knockoutPoints} KO pts`,
  });
  const groupKing = argmax((u) => u.groupPoints);
  awards.push({
    key: "group-king",
    emoji: "🎖️",
    title: "Group-Stage King",
    blurb: "Most points from the 72 group matches.",
    winner: groupKing.username,
    value: `${groupKing.groupPoints} group pts`,
  });
  const ranker = argmax((u) => u.rankExact);
  awards.push({
    key: "ranker",
    emoji: "🧮",
    title: "Best Forecaster of Tables",
    blurb: "Most exact group finishing positions (of 48).",
    winner: ranker.username,
    value: `${ranker.rankExact}/48 exact`,
  });
  const unlucky = argmax((u) => u.nearMissCount);
  awards.push({
    key: "unlucky",
    emoji: "😬",
    title: "The Unluckiest",
    blurb: "Most scores that were one goal from perfect.",
    winner: unlucky.username,
    value: `${unlucky.nearMissCount} near-misses`,
  });
  const foreseer = users.some((u) => u.foresightPoints > 0)
    ? argmax((u) => u.foresightPoints)
    : null;
  if (foreseer && foreseer.foresightPoints > 0) {
    awards.push({
      key: "foreseer",
      emoji: "🔮",
      title: "The Foreseer",
      blurb: "Nailed exact knockout matchups AND scorelines pre-tournament.",
      winner: foreseer.username,
      value: `${foreseer.foresightPoints} foresight pts`,
    });
  }
  // comeback / collapse (biggest rank climb / fall groups → final)
  const climb = (u: UserWrapped) => u.rankAt[0] - u.rank; // positive = climbed
  const comeback = argmax(climb);
  if (climb(comeback) > 0) {
    awards.push({
      key: "comeback",
      emoji: "🎢",
      title: "The Comeback",
      blurb: "Biggest rank climb from the group stage to the finish.",
      winner: comeback.username,
      value: `up ${climb(comeback)} (#${comeback.rankAt[0]} → #${comeback.rank})`,
    });
  }
  const collapse = argmin(climb);
  if (climb(collapse) < 0) {
    awards.push({
      key: "collapse",
      emoji: "💥",
      title: "The Collapse",
      blurb: "Biggest rank drop from the group stage to the finish.",
      winner: collapse.username,
      value: `down ${-climb(collapse)} (#${collapse.rankAt[0]} → #${collapse.rank})`,
    });
  }
  const earlyBird = argmin((u) => u.submissionRank);
  awards.push({
    key: "early-bird",
    emoji: "🕰️",
    title: "The Early Bird",
    blurb: "First to lock in their predictions.",
    winner: earlyBird.username,
    value: new Date(earlyBird.submittedAt).toISOString().slice(0, 10),
  });

  // ---- Agreement matrix ----------------------------------------------------
  let mostSimilarPair: PairSimilarity | null = null;
  let mostDifferentPair: PairSimilarity | null = null;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const ua = byUsername.get(usernames[i])!;
      const ub = byUsername.get(usernames[j])!;
      const pair: PairSimilarity = {
        a: usernames[i],
        b: usernames[j],
        identicalScorelines: identical[i][j],
        sameOutcome: 0,
        sameChampion: ua.championPick != null && ua.championPick === ub.championPick,
      };
      if (!mostSimilarPair || pair.identicalScorelines > mostSimilarPair.identicalScorelines)
        mostSimilarPair = pair;
      if (!mostDifferentPair || pair.identicalScorelines < mostDifferentPair.identicalScorelines)
        mostDifferentPair = pair;
    }
  }

  // ---- Team difficulty -----------------------------------------------------
  const teamGames = new Map<string, DbMatch[]>();
  for (const m of playedGroup) {
    (teamGames.get(m.home_team) ?? teamGames.set(m.home_team, []).get(m.home_team)!).push(m);
    (teamGames.get(m.away_team) ?? teamGames.set(m.away_team, []).get(m.away_team)!).push(m);
  }
  const difficulties: TeamDifficulty[] = [];
  for (const [team, games] of teamGames) {
    const actual = actualStandings.get(team);
    if (!actual) continue;
    let errSum = 0;
    let errN = 0;
    for (const m of games) {
      for (const e of entries) {
        const g = gamePicks.get(e.id)?.get(m.match_no);
        if (!g) continue;
        errSum += Math.abs(g.predHome - g.actualHome) + Math.abs(g.predAway - g.actualAway);
        errN++;
      }
    }
    let rankHits = 0;
    for (const e of entries) {
      const pr = predStandingsByEntry.get(e.id)?.get(team);
      if (pr && pr.rank === actual.rank) rankHits++;
    }
    difficulties.push({
      team,
      group: actual.group,
      avgGoalError: errN ? errSum / errN : 0,
      rankExactShare: entries.length ? rankHits / entries.length : 0,
      actualRank: actual.rank,
    });
  }
  const hardestTeams = difficulties
    .slice()
    .sort((x, y) => y.avgGoalError - x.avgGoalError || x.rankExactShare - y.rankExactShare)
    .slice(0, 6);
  const easiestTeams = difficulties
    .slice()
    .sort((x, y) => x.avgGoalError - y.avgGoalError || y.rankExactShare - x.rankExactShare)
    .slice(0, 6);

  // ---- Over/underrated -----------------------------------------------------
  const allTeams = new Set<string>();
  for (const m of playedGroup) {
    allTeams.add(m.home_team);
    allTeams.add(m.away_team);
  }
  const ratings: TeamRating[] = [];
  for (const team of allTeams) {
    let depthSum = 0;
    for (const e of entries) {
      const adv = advPredByEntry.get(e.id)!;
      let d = 0;
      for (const r of ["R32", "R16", "QF", "SF", "FINAL", "CHAMPION"] as AdvRound[]) {
        if (adv.get(r)?.has(team)) d = Math.max(d, DEPTH[r]);
      }
      depthSum += d;
    }
    const predictedDepth = entries.length ? depthSum / entries.length : 0;
    const actual = actualDepth.get(team) ?? 0;
    ratings.push({ team, predictedDepth, actualDepth: actual, gap: actual - predictedDepth });
  }
  const mostOverrated = ratings
    .slice()
    .sort((x, y) => x.gap - y.gap)
    .slice(0, 5);
  const mostUnderrated = ratings
    .slice()
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 5);

  // ---- Group report cards --------------------------------------------------
  const groupAcc = new Map<string, { hits: number; n: number }>();
  for (const [team, actual] of actualStandings) {
    const cur = groupAcc.get(actual.group) ?? { hits: 0, n: 0 };
    for (const e of entries) {
      const pr = predStandingsByEntry.get(e.id)?.get(team);
      cur.n++;
      if (pr && pr.rank === actual.rank) cur.hits++;
    }
    groupAcc.set(actual.group, cur);
  }
  const groupReportCards = [...groupAcc.entries()]
    .map(([group, v]) => ({ group, avgRankAccuracy: v.n ? v.hits / v.n : 0 }))
    .sort((x, y) => x.group.localeCompare(y.group));

  // ---- Collective triumphs / blunders + shocks -----------------------------
  const triumphs: MatchLine[] = [];
  const blunders: MatchLine[] = [];
  let biggestShock: (MatchLine & { collectiveError: number }) | null = null;
  let mostPredictable: (MatchLine & { collectiveError: number }) | null = null;
  for (const m of playedGroup) {
    const line: MatchLine = {
      matchNo: m.match_no,
      home: m.home_team,
      away: m.away_team,
      actualHome: m.home_goals!,
      actualAway: m.away_goals!,
    };
    let allRight = true;
    let allWrong = true;
    let err = 0;
    let n = 0;
    for (const e of entries) {
      const g = gamePicks.get(e.id)?.get(m.match_no);
      if (!g) {
        allRight = false;
        continue;
      }
      if (g.isOutcome) allWrong = false;
      else allRight = false;
      err += Math.abs(g.predHome - g.actualHome) + Math.abs(g.predAway - g.actualAway);
      n++;
    }
    if (n === entries.length) {
      if (allRight) triumphs.push(line);
      if (allWrong) blunders.push(line);
      const shock = { ...line, collectiveError: err };
      if (!biggestShock || err > biggestShock.collectiveError) biggestShock = shock;
      if (!mostPredictable || err < mostPredictable.collectiveError) mostPredictable = shock;
    }
  }

  // ---- Single-game hero ----------------------------------------------------
  let singleGameHero: { username: string; game: UserGamePick } | null = null;
  for (const u of users) {
    if (u.bestGame && (!singleGameHero || u.bestGame.points > singleGameHero.game.points))
      singleGameHero = { username: u.username, game: u.bestGame };
  }

  // ---- Champion picks + goals ----------------------------------------------
  const championPicks = users.map((u) => ({
    username: u.username,
    pick: u.championPick,
    correct: u.championCorrect,
  }));
  const poolPredictedTotal = users.reduce((s, u) => s + u.goalsPerGame * 72, 0);
  const biggestOptimist = argmax((u) => u.goalsPerGame);
  const biggestPragmatist = argmin((u) => u.goalsPerGame);

  // ---- Timeline series -----------------------------------------------------
  const series = users
    .slice()
    .sort((x, y) => x.rank - y.rank)
    .map((u) => ({
      username: u.username,
      entryId: u.entryId,
      cumulative: u.cumulative,
      rankAt: u.rankAt,
    }));
  const leadChanges: { checkpoint: string; leader: string; from: string | null }[] = [];
  let prevLeader: string | null = null;
  for (let c = 0; c < a.checkpoints.length; c++) {
    const leader = users.find((u) => u.rankAt[c] === 1)!;
    if (leader.username !== prevLeader) {
      leadChanges.push({ checkpoint: a.checkpoints[c], leader: leader.username, from: prevLeader });
      prevLeader = leader.username;
    }
  }

  return {
    podium: rankedBoard.slice(0, 3),
    leaderboard: rankedBoard.map((r, i) => ({ ...r, rank: i + 1 })),
    champion,
    awards,
    agreementMatrix: { usernames, identical },
    mostSimilarPair,
    mostDifferentPair,
    hardestTeams,
    easiestTeams,
    mostOverrated,
    mostUnderrated,
    groupReportCards,
    collectiveTriumphs: triumphs,
    collectiveBlunders: blunders,
    biggestShock,
    mostPredictable,
    singleGameHero,
    championPicks,
    goals: {
      actualTotal: a.groupGoals,
      perGame: playedGroup.length ? a.groupGoals / playedGroup.length : 0,
      poolPredictedTotal,
      biggestOptimist: { username: biggestOptimist.username, perGame: biggestOptimist.goalsPerGame },
      biggestPragmatist: {
        username: biggestPragmatist.username,
        perGame: biggestPragmatist.goalsPerGame,
      },
    },
    timeline: { checkpoints: a.checkpoints, series, leadChanges },
  };
}
