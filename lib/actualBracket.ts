/**
 * deriveActualKnockout — reconstruct the REAL knockout bracket (matches 73..104)
 * from the finished group stage plus football-data.org's knockout fixtures, so we
 * can store each slot's actual matchup + scoreline in `actual_knockout_matches`.
 *
 * Why this exists: the API gives us the real knockout fixtures (team pairs, scores,
 * winners) but NOT the official FIFA slot number (73..104) each one occupies. We
 * recover the slot numbers structurally, exactly the way a user's predicted bracket
 * is built:
 *   1. Real group standings → the 32 Round-of-32 participants in their fixed slots
 *      (reuses resolveR32Slots: 1X/2X from positions, thirds via the FIFA table).
 *   2. Walk slots 73→104 in order. Each slot's two teams come from the slot spec
 *      (R32: 1X/2X/3-XXXXX; later rounds: W<feeder>). For a resolved matchup, find
 *      the API fixture with that team pair and read its scoreline (oriented to our
 *      slot's home/away). The winner — used to resolve the next round's slots —
 *      is taken from a decisive scoreline, or, for a draw decided on penalties,
 *      from advancement (the team that appears in the next round's fixtures), so we
 *      never need to parse shoot-out detail the free API may omit.
 *
 * Pure module (no DB, no network — mirrors lib/syncResults.ts and
 * lib/deriveBracket.ts), so the sync route feeds it live data and it stays
 * unit-testable against the master workbook fixture.
 *
 * Known limitation (same as deriveBracket / dimension B): standings use
 * points → GD → GF → name, not FIFA head-to-head / fair-play. In a group with an
 * exact tie this can assign a team to a different R32 slot than reality; that
 * slot's API fixture then won't match by team pair and its scoreline is left
 * unwritten (never wrong, just missing) until the admin overrides via the
 * master-results upload. The R32 *set* is always correct.
 */
import {
  computeStandings,
  resolveR32Slots,
  type GroupFixture,
  type GroupScores,
} from "./deriveBracket";
import { KO_SLOT_DEFS } from "./bracketData";
import { ADV_ROUNDS, type AdvRound } from "./rounds";
import type { NormalizedMatch } from "./footballData";
import { resolveCanonical } from "./teamNameMap";

/** football-data.org knockout stage → our advancement round. */
const STAGE_TO_ROUND: Record<string, AdvRound> = {
  LAST_32: "R32",
  LAST_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  FINAL: "FINAL",
};

/** Each scored knockout slot's round (third-place playoff 103 is excluded). */
function roundOfSlot(no: number): AdvRound | null {
  if (no >= 73 && no <= 88) return "R32";
  if (no >= 89 && no <= 96) return "R16";
  if (no >= 97 && no <= 100) return "QF";
  if (no === 101 || no === 102) return "SF";
  if (no === 104) return "FINAL";
  return null;
}

/** The round whose participants are the winners of `round` (FINAL → CHAMPION). */
const NEXT_ROUND: Record<AdvRound, AdvRound> = {
  R32: "R16",
  R16: "QF",
  QF: "SF",
  SF: "FINAL",
  FINAL: "CHAMPION",
  CHAMPION: "CHAMPION",
};

/** One resolved actual knockout slot, ready to upsert into actual_knockout_matches. */
export interface ActualKnockoutWrite {
  match_no: number;
  home_team: string;
  away_team: string;
  /** null until the game has finished (matchup known, score not yet logged). */
  home_goals: number | null;
  away_goals: number | null;
  /** The team that went through on penalties — only set on a level score. */
  penalty_winner: string | null;
  /** Real scheduled kickoff (ISO) from the API, or null if the feed omits it. */
  kickoff: string | null;
}

export interface ActualBracketDiff {
  /** Resolved slots (matchup always set; goals set once the game is finished). */
  writes: ActualKnockoutWrite[];
  /** Human-readable notes for what couldn't be derived (incomplete groups, etc.). */
  skipped: string[];
}

/**
 * Derive the actual knockout bracket. `apiMatches` is the full football-data feed
 * (group + knockout, any status); only knockout stages are read here. `fixtures`
 * and `actualGroupScores` are the seeded 72 group fixtures and their logged
 * results. Returns one write per slot whose matchup is resolvable, with the
 * scoreline filled in for finished games.
 */
export function deriveActualKnockout(
  apiMatches: NormalizedMatch[],
  fixtures: GroupFixture[],
  actualGroupScores: GroupScores,
  canonical: Set<string>,
): ActualBracketDiff {
  // The R32 field is only fixed once every group game is logged.
  if (Object.keys(actualGroupScores).length < 72) {
    return { writes: [], skipped: ["Group stage incomplete — knockout bracket not derivable yet."] };
  }

  let r32Slots: Map<string, string>;
  try {
    r32Slots = resolveR32Slots(computeStandings(fixtures, actualGroupScores));
  } catch {
    return { writes: [], skipped: ["Could not resolve the Round-of-32 from group results."] };
  }

  // Index the API knockout fixtures by round, and collect the teams that reached
  // each round (a team appearing in a round's fixtures advanced into it).
  interface ApiFix {
    home: string | null;
    away: string | null;
    homeGoals: number | null;
    awayGoals: number | null;
    kickoff: string | null;
  }
  const byRound = new Map<AdvRound, ApiFix[]>();
  const reached = new Map<AdvRound, Set<string>>();
  for (const r of ADV_ROUNDS) reached.set(r, new Set<string>());

  for (const m of apiMatches) {
    const round = STAGE_TO_ROUND[m.stage];
    if (!round) continue; // group stage + THIRD_PLACE/unknown ignored
    const home = resolveCanonical(m.homeApi, canonical);
    const away = resolveCanonical(m.awayApi, canonical);
    if (home) reached.get(round)!.add(home);
    if (away) reached.get(round)!.add(away);
    if (round === "FINAL" && m.status === "FINISHED") {
      const champ = m.winner === "HOME_TEAM" ? home : m.winner === "AWAY_TEAM" ? away : null;
      if (champ) reached.get("CHAMPION")!.add(champ);
    }
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push({ home, away, homeGoals: m.homeGoals, awayGoals: m.awayGoals, kickoff: m.kickoff });
  }

  const winners = new Map<number, string>(); // slot match_no → advancing team
  const writes: ActualKnockoutWrite[] = [];
  const written = new Set<number>();

  const resolveSpec = (spec: string): string | null => {
    if (spec.startsWith("W")) return winners.get(Number(spec.slice(1))) ?? null;
    if (spec.startsWith("RU")) return null; // only the 3rd-place playoff (103) uses RU; skipped
    return r32Slots.get(spec) ?? null;
  };

  // team → group letter, for the R32 recovery pass below.
  const groupOf = new Map<string, string>();
  for (const f of fixtures) {
    groupOf.set(f.home, f.group);
    groupOf.set(f.away, f.group);
  }
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");

  /** Find the API fixture for a matchup (team pair, either orientation). */
  const findFix = (round: AdvRound, home: string, away: string) =>
    (byRound.get(round) ?? []).find(
      (f) => (f.home === home && f.away === away) || (f.home === away && f.away === home),
    );

  /** Record a resolved slot: orient the API scoreline + decide the advancing team. */
  const emit = (no: number, round: AdvRound, home: string, away: string, fix: ApiFix) => {
    let homeGoals: number | null = null;
    let awayGoals: number | null = null;
    if (fix.homeGoals !== null && fix.awayGoals !== null) {
      [homeGoals, awayGoals] =
        fix.home === home ? [fix.homeGoals, fix.awayGoals] : [fix.awayGoals, fix.homeGoals];
    }
    // Winner: decisive scoreline, else the team that advanced (handles penalties).
    let winner: string | null = null;
    if (homeGoals !== null && awayGoals !== null && homeGoals !== awayGoals) {
      winner = homeGoals > awayGoals ? home : away;
    } else {
      const next = reached.get(NEXT_ROUND[round])!;
      winner = next.has(home) ? home : next.has(away) ? away : null;
    }
    if (winner) winners.set(no, winner);
    const penaltyWinner =
      homeGoals !== null && awayGoals !== null && homeGoals === awayGoals ? winner : null;
    writes.push({ match_no: no, home_team: home, away_team: away, home_goals: homeGoals, away_goals: awayGoals, penalty_winner: penaltyWinner, kickoff: fix.kickoff });
    written.add(no);
  };

  // ── Phase 1: Round of 32 by corroboration. We only ever write a slot the API
  //    CONFIRMS: if the derived pair isn't in the feed (a fair-play tie-break put
  //    a different team in this slot, or the draw isn't published yet) we skip it
  //    here and try the group-membership recovery in phase 2.
  for (let no = 73; no <= 88; no++) {
    const def = KO_SLOT_DEFS[no];
    const home = resolveSpec(def.home);
    const away = resolveSpec(def.away);
    if (!home || !away) continue;
    const fix = findFix("R32", home, away);
    if (fix) emit(no, "R32", home, away, fix);
  }

  // ── Phase 2: R32 recovery. The slot specs (1X / 2X / 3-XYZ) map to GROUP
  //    membership, which is tie-break-independent. So for any R32 slot phase 1
  //    couldn't corroborate, find the leftover API fixture whose two teams' groups
  //    fit the slot's home/away specs. Iterate, assigning only slots with exactly
  //    one candidate, so the most-constrained slots resolve first and disambiguate
  //    the rest (e.g. a 2D-vs-2G slot fixes which group-G team is the runner-up).
  const specGroups = (spec: string): string[] => {
    if (spec.startsWith("3-")) return spec.slice(2).split("");
    if (/^[12][A-L]$/.test(spec)) return [spec[1]];
    return [];
  };
  const usedPairs = new Set(
    writes.filter((w) => w.match_no <= 88).map((w) => pairKey(w.home_team, w.away_team)),
  );
  const leftoverFix = (byRound.get("R32") ?? []).filter(
    (f): f is ApiFix & { home: string; away: string } =>
      !!f.home && !!f.away && !usedPairs.has(pairKey(f.home, f.away)),
  );
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let no = 73; no <= 88; no++) {
      if (written.has(no)) continue;
      const hg = specGroups(KO_SLOT_DEFS[no].home);
      const ag = specGroups(KO_SLOT_DEFS[no].away);
      const fits = leftoverFix.filter((f) => {
        const a = groupOf.get(f.home);
        const b = groupOf.get(f.away);
        return !!a && !!b && ((hg.includes(a) && ag.includes(b)) || (hg.includes(b) && ag.includes(a)));
      });
      if (fits.length !== 1) continue; // ambiguous or none — defer / leave for admin
      const f = fits[0];
      const home = hg.includes(groupOf.get(f.home)!) ? f.home : f.away; // orient to the home spec
      const away = home === f.home ? f.away : f.home;
      emit(no, "R32", home, away, f);
      leftoverFix.splice(leftoverFix.indexOf(f), 1);
      progressed = true;
    }
  }

  // ── Phase 3: R16 → Final, in order. Each slot's feeders (W<match>) are now
  //    resolved (phases 1–2 set the R32 winners), and deeper matchups don't
  //    diverge — they're determined purely by who won, which the API states
  //    unambiguously. Ascending order guarantees feeders resolve before dependents.
  for (let no = 89; no <= 104; no++) {
    if (no === 103) continue;
    const round = roundOfSlot(no)!;
    const def = KO_SLOT_DEFS[no];
    const home = resolveSpec(def.home);
    const away = resolveSpec(def.away);
    if (!home || !away) continue;
    const fix = findFix(round, home, away);
    if (fix) emit(no, round, home, away, fix);
  }

  return { writes, skipped: [] };
}
