/**
 * deriveBracket — turn a user's predicted group scorelines (plus their picked
 * knockout winners) into the same advancement structure that parseWorkbook
 * produces from a filled Excel bracket.
 *
 * This is the engine behind manual prediction entry. The flow mirrors the
 * workbook:
 *   1. Predicted group standings → group winners (1X), runners-up (2X), thirds.
 *   2. The eight best third-placed teams are assigned to their R32 slots via
 *      FIFA's combination table (bracketData.THIRD_ASSIGNMENT).
 *   3. That fixes the 32 R32 participants. From there the user taps the winner
 *      of each tie; each pick feeds the next round (W74 → match 89, etc.).
 *
 * Standings use the SAME tie-break as the leaderboard SQL (points, then goal
 * difference, then goals for, then team name ascending) so a manual entry's
 * derived positions match how dimension B scores them. Third-placed ranking is
 * points → GD → GF → group letter (fair-play points aren't predictable, so the
 * group letter is the deterministic final tie-break).
 *
 * Pure module — no DB, no `server-only` — so it runs in the browser (live KO
 * picker), in the submit route, and in tests.
 */
import { KO_SLOT_DEFS, THIRD_SLOT_ORDER, THIRD_ASSIGNMENT } from "./bracketData";
import type { AdvRound } from "./rounds";

/** A single group fixture: which two teams play and which group they're in. */
export interface GroupFixture {
  matchNo: number; // 1..72
  home: string;
  away: string;
  group: string; // "A".."L"
}

export interface Scoreline {
  home: number;
  away: number;
}

/** Predicted group scores, keyed by match number (1..72). */
export type GroupScores = Record<number, Scoreline>;

/**
 * A predicted knockout scoreline. `penaltyWinner` is consulted only when the
 * regulation score is level (home === away): it names which of the two teams
 * goes through on penalties.
 */
export interface KnockoutScore {
  home: number;
  away: number;
  penaltyWinner?: string | null;
}

/** Predicted knockout scorelines, keyed by match number (73..104). */
export type KnockoutScores = Record<number, KnockoutScore>;

/** A resolved, storable knockout prediction: matchup + scoreline + advancer. */
export interface DerivedKnockoutPrediction {
  matchNo: number;
  homeTeam: string;
  awayTeam: string;
  predHome: number;
  predAway: number;
  penaltyWinner: string | null; // set only on a level score
}

export interface Advancers {
  R32: string[];
  R16: string[];
  QF: string[];
  SF: string[];
  FINAL: string[];
  CHAMPION: string;
}

/** The two participants of a knockout match, once resolvable. */
export interface KnockoutMatchup {
  matchNo: number;
  home: string | null; // null until the feeding result/standing is known
  away: string | null;
}

interface TeamStanding {
  team: string;
  group: string;
  pts: number;
  gf: number;
  ga: number;
  gd: number;
}

/** Knockout match groupings used by the picker UI and by advancer derivation. */
export const KNOCKOUT_ROUNDS: Array<{ round: AdvRound; label: string; matches: number[] }> = [
  { round: "R32", label: "Round of 32", matches: [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88] },
  { round: "R16", label: "Round of 16", matches: [89, 90, 91, 92, 93, 94, 95, 96] },
  { round: "QF", label: "Quarter-finals", matches: [97, 98, 99, 100] },
  { round: "SF", label: "Semi-finals", matches: [101, 102] },
  { round: "FINAL", label: "Final", matches: [104] },
];

/** All knockout match numbers a user must pick a winner for (excludes the 3rd-place playoff). */
export const PICKABLE_KO_MATCHES: number[] = KNOCKOUT_ROUNDS.flatMap((r) => r.matches);

function emptyStanding(team: string, group: string): TeamStanding {
  return { team, group, pts: 0, gf: 0, ga: 0, gd: 0 };
}

/**
 * Compute final standings for every group from the predicted scorelines.
 * Returns each group's teams ordered 1st→4th. A missing score counts as 0–0.
 */
export function computeStandings(
  fixtures: GroupFixture[],
  scores: GroupScores,
): Map<string, TeamStanding[]> {
  const byGroup = new Map<string, Map<string, TeamStanding>>();
  const ensure = (group: string, team: string): TeamStanding => {
    let g = byGroup.get(group);
    if (!g) {
      g = new Map();
      byGroup.set(group, g);
    }
    let s = g.get(team);
    if (!s) {
      s = emptyStanding(team, group);
      g.set(team, s);
    }
    return s;
  };

  for (const f of fixtures) {
    const home = ensure(f.group, f.home);
    const away = ensure(f.group, f.away);
    const sc = scores[f.matchNo] ?? { home: 0, away: 0 };
    home.gf += sc.home;
    home.ga += sc.away;
    away.gf += sc.away;
    away.ga += sc.home;
    if (sc.home > sc.away) home.pts += 3;
    else if (sc.home < sc.away) away.pts += 3;
    else {
      home.pts += 1;
      away.pts += 1;
    }
  }

  const result = new Map<string, TeamStanding[]>();
  for (const [group, teams] of byGroup) {
    const arr = [...teams.values()];
    arr.forEach((t) => (t.gd = t.gf - t.ga));
    arr.sort(standingCompare);
    result.set(group, arr);
  }
  return result;
}

/** Group/standings tie-break: points, goal difference, goals for, name ascending. */
function standingCompare(a: TeamStanding, b: TeamStanding): number {
  if (b.pts !== a.pts) return b.pts - a.pts;
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return a.team < b.team ? -1 : a.team > b.team ? 1 : 0;
}

/**
 * Resolve all 32 R32 slot specs (1X / 2X / 3-XXXXX) to concrete teams from the
 * standings. Throws if standings are incomplete (not all 12 groups present).
 */
export function resolveR32Slots(standings: Map<string, TeamStanding[]>): Map<string, string> {
  const slotTeam = new Map<string, string>();

  for (const [group, teams] of standings) {
    if (teams[0]) slotTeam.set(`1${group}`, teams[0].team);
    if (teams[1]) slotTeam.set(`2${group}`, teams[1].team);
  }

  // Rank the twelve third-placed teams; the best eight qualify.
  const thirds: TeamStanding[] = [];
  for (const teams of standings.values()) {
    if (teams[2]) thirds.push(teams[2]);
  }
  thirds.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.group < b.group ? -1 : 1; // deterministic final tie-break
  });
  const qualified = thirds.slice(0, 8);

  // The combination key is the eight qualifying groups, sorted A→L.
  const combo = qualified
    .map((t) => t.group)
    .sort()
    .join("");
  const assignment = THIRD_ASSIGNMENT[combo];
  if (assignment) {
    // assignment[i] is the group whose third fills THIRD_SLOT_ORDER[i].
    const thirdByGroup = new Map(qualified.map((t) => [t.group, t.team]));
    THIRD_SLOT_ORDER.forEach((slot, i) => {
      const group = assignment[i];
      const team = thirdByGroup.get(group);
      if (team) slotTeam.set(slot, team);
    });
  }

  return slotTeam;
}

/**
 * Resolve a single slot spec to a team, given the R32 slot map and the winners
 * derived so far. Returns null when the feeding result isn't known yet.
 */
function resolveSlot(
  spec: string,
  r32Slots: Map<string, string>,
  winners: Map<number, string>,
  matchups: Map<number, KnockoutMatchup>,
): string | null {
  if (spec.startsWith("W")) {
    return winners.get(Number(spec.slice(1))) ?? null;
  }
  if (spec.startsWith("RU")) {
    // Loser of the referenced match = the participant that isn't the winner.
    const ref = Number(spec.slice(2));
    const m = matchups.get(ref);
    const win = winners.get(ref);
    if (!m || !win || !m.home || !m.away) return null;
    return m.home === win ? m.away : m.home;
  }
  return r32Slots.get(spec) ?? null;
}

/** Decide who advances from a knockout scoreline (penalty winner breaks a tie). */
function decideWinner(home: string, away: string, score: KnockoutScore): string | null {
  if (score.home > score.away) return home;
  if (score.away > score.home) return away;
  const pw = score.penaltyWinner;
  return pw === home || pw === away ? pw : null; // level score needs a valid penalty pick
}

/**
 * Resolve every knockout matchup (73..104) and the team that advances from each,
 * from the standings-derived R32 slots and the predicted scorelines. Ascending
 * order guarantees feeders (lower match numbers) resolve before their dependents.
 */
export function resolveKnockout(
  r32Slots: Map<string, string>,
  koScores: KnockoutScores,
): { matchups: Map<number, KnockoutMatchup>; winners: Map<number, string> } {
  const matchups = new Map<number, KnockoutMatchup>();
  const winners = new Map<number, string>();
  for (let no = 73; no <= 104; no++) {
    const def = KO_SLOT_DEFS[no];
    if (!def) continue;
    const home = resolveSlot(def.home, r32Slots, winners, matchups);
    const away = resolveSlot(def.away, r32Slots, winners, matchups);
    matchups.set(no, { matchNo: no, home, away });
    const score = koScores[no];
    if (home && away && score) {
      const w = decideWinner(home, away, score);
      if (w) winners.set(no, w);
    }
  }
  return { matchups, winners };
}

export interface DerivedBracket {
  /** All knockout matchups, resolved as far as the current scores allow. */
  matchups: Map<number, KnockoutMatchup>;
  /** R32 slot → team, from standings (constant across KO scores). */
  r32Slots: Map<string, string>;
  /** Advancers as far as derivable; rounds past the entered scores are partial. */
  advancers: Advancers;
  /** Storable per-match scorelines (only fully-resolved matches with a score). */
  knockoutPredictions: DerivedKnockoutPrediction[];
  /** True once every pickable knockout match has a valid, decisive scoreline. */
  complete: boolean;
}

/**
 * Full derivation: standings → R32 → resolve matchups + winners from the entered
 * scorelines → advancement structure + storable knockout predictions. `complete`
 * is true only when all 31 knockout matches have a valid result (a decisive
 * score, or a level score with a penalty winner that is one of the two teams).
 */
export function deriveBracket(
  fixtures: GroupFixture[],
  scores: GroupScores,
  koScores: KnockoutScores,
): DerivedBracket {
  const standings = computeStandings(fixtures, scores);
  const r32Slots = resolveR32Slots(standings);
  const { matchups, winners } = resolveKnockout(r32Slots, koScores);

  // R32 advancers = the 32 teams in matches 73..88 (the round's participants).
  const r32Teams: string[] = [];
  for (const no of KNOCKOUT_ROUNDS[0].matches) {
    const m = matchups.get(no);
    if (m?.home) r32Teams.push(m.home);
    if (m?.away) r32Teams.push(m.away);
  }

  // For deeper rounds, the advancers are the winners of the previous round's
  // matches — i.e. the participants of this round's matches.
  const winnersOf = (matchNos: number[]): string[] =>
    matchNos.map((no) => winners.get(no)).filter((w): w is string => !!w);

  const advancers: Advancers = {
    R32: r32Teams,
    R16: winnersOf(KNOCKOUT_ROUNDS[0].matches),
    QF: winnersOf(KNOCKOUT_ROUNDS[1].matches),
    SF: winnersOf(KNOCKOUT_ROUNDS[2].matches),
    FINAL: winnersOf(KNOCKOUT_ROUNDS[3].matches),
    CHAMPION: winners.get(104) ?? "",
  };

  // Storable scorelines for the pickable matches whose matchup + score are known.
  const knockoutPredictions: DerivedKnockoutPrediction[] = [];
  for (const no of PICKABLE_KO_MATCHES) {
    const m = matchups.get(no);
    const sc = koScores[no];
    if (!m?.home || !m?.away || !sc) continue;
    knockoutPredictions.push({
      matchNo: no,
      homeTeam: m.home,
      awayTeam: m.away,
      predHome: sc.home,
      predAway: sc.away,
      penaltyWinner: sc.home === sc.away ? winners.get(no) ?? null : null,
    });
  }

  const complete = PICKABLE_KO_MATCHES.every((no) => winners.has(no));

  return { matchups, r32Slots, advancers, knockoutPredictions, complete };
}
