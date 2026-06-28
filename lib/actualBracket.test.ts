/**
 * deriveActualKnockout validation — reconstruct the real knockout bracket
 * (matchups + scorelines per slot 73..104) from football-data-shaped fixtures.
 *
 * Test 1 (exact, self-consistent): build an actual bracket with deriveBracket and
 * deterministic synthetic results, feed it back in as the "API" feed, and require
 * deriveActualKnockout to reproduce every slot's matchup, oriented scoreline, and
 * penalty winner exactly. This is the strong mechanism gate (slot mapping, score
 * orientation, decisive- and penalty-winner resolution, winner propagation).
 *
 * Test 2 (real fixture smoke): feed the master workbook's own knockout bracket and
 * confirm the R32 field and the bulk of scorelines are recovered. A handful of
 * per-slot mismatches are tolerated because standings use points → GD → GF → name
 * while the workbook breaks exact ties (groups D, H) on fair-play — the same
 * documented divergence deriveBracket.test.ts calls out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./parseWorkbook";
import {
  deriveBracket,
  KNOCKOUT_ROUNDS,
  type GroupFixture,
  type GroupScores,
  type KnockoutScores,
} from "./deriveBracket";
import { deriveActualKnockout } from "./actualBracket";
import type { NormalizedMatch } from "./footballData";
import type { AdvRound } from "./rounds";

function loadWorkbook(): Buffer {
  return readFileSync(new URL("../WCup_2026_4.2.7_en.xlsx", import.meta.url));
}

function readTeamGroups(buf: Buffer): Map<string, string> {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets["Groups"];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const map = new Map<string, string>();
  for (let r = range.s.r; r <= range.e.r; r++) {
    const slot = ws[XLSX.utils.encode_cell({ r, c: 1 })]?.v;
    const name = ws[XLSX.utils.encode_cell({ r, c: 3 })]?.v;
    if (typeof slot === "string" && /^[A-L][1-4]$/.test(slot) && name != null) {
      map.set(String(name).trim(), slot[0]);
    }
  }
  return map;
}

function buildFixtures(buf: Buffer) {
  const parsed = parseWorkbook(buf);
  const teamGroup = readTeamGroups(buf);
  const fixtures: GroupFixture[] = parsed.groupPredictions.map((g) => ({
    matchNo: g.matchNo,
    home: g.team1,
    away: g.team2,
    group: teamGroup.get(g.team1)!,
  }));
  const scores: GroupScores = {};
  for (const g of parsed.groupPredictions) scores[g.matchNo] = { home: g.predHome, away: g.predAway };
  return { parsed, fixtures, scores };
}

const STAGE_OF_ROUND: Record<AdvRound, string> = {
  R32: "LAST_32",
  R16: "LAST_16",
  QF: "QUARTER_FINALS",
  SF: "SEMI_FINALS",
  FINAL: "FINAL",
  CHAMPION: "FINAL",
};
function stageOfSlot(no: number): string {
  if (no <= 88) return "LAST_32";
  if (no <= 96) return "LAST_16";
  if (no <= 100) return "QUARTER_FINALS";
  if (no <= 102) return "SEMI_FINALS";
  return "FINAL"; // 104
}

function koMatch(stage: string, home: string, away: string, hg: number, ag: number): NormalizedMatch {
  return {
    stage,
    status: "FINISHED",
    homeApi: home,
    awayApi: away,
    homeGoals: hg,
    awayGoals: ag,
    winner: hg > ag ? "HOME_TEAM" : ag > hg ? "AWAY_TEAM" : "DRAW",
  };
}

test("exactly reconstructs a self-consistent bracket (matchups, oriented scores, penalties)", () => {
  const buf = loadWorkbook();
  const { parsed, fixtures, scores } = buildFixtures(buf);
  const canonical = new Set(parsed.canonicalTeams);

  // Build a complete actual bracket: alphabetically-first participant wins each
  // tie; match 73 is forced to a draw decided on penalties (exercises that path).
  const koScores: KnockoutScores = {};
  for (const round of KNOCKOUT_ROUNDS) {
    const { matchups } = deriveBracket(fixtures, scores, koScores);
    for (const no of round.matches) {
      const m = matchups.get(no)!;
      const winner = m.home! < m.away! ? m.home! : m.away!;
      koScores[no] =
        no === 73
          ? { home: 1, away: 1, penaltyWinner: winner }
          : winner === m.home
            ? { home: 1, away: 0 }
            : { home: 0, away: 1 };
    }
  }
  const actual = deriveBracket(fixtures, scores, koScores);

  // Feed that bracket back as the football-data knockout feed.
  const apiMatches: NormalizedMatch[] = actual.knockoutPredictions.map((k) =>
    koMatch(stageOfSlot(k.matchNo), k.homeTeam, k.awayTeam, k.predHome, k.predAway),
  );

  const { writes, skipped } = deriveActualKnockout(apiMatches, fixtures, scores, canonical);
  assert.deepEqual(skipped, []);
  assert.equal(writes.length, 31, "every scored knockout slot (73–102, 104) is resolved");

  const byNo = new Map(actual.knockoutPredictions.map((k) => [k.matchNo, k]));
  for (const w of writes) {
    const expected = byNo.get(w.match_no)!;
    assert.equal(w.home_team, expected.homeTeam, `slot ${w.match_no} home`);
    assert.equal(w.away_team, expected.awayTeam, `slot ${w.match_no} away`);
    assert.equal(w.home_goals, expected.predHome, `slot ${w.match_no} home goals`);
    assert.equal(w.away_goals, expected.predAway, `slot ${w.match_no} away goals`);
    assert.equal(w.penalty_winner, expected.penaltyWinner, `slot ${w.match_no} pen`);
  }

  // The drawn match 73 records its penalty winner; decisive games record none.
  const m73 = writes.find((w) => w.match_no === 73)!;
  assert.equal(m73.home_goals, m73.away_goals);
  assert.ok(m73.penalty_winner && [m73.home_team, m73.away_team].includes(m73.penalty_winner));
});

test("recovers the R32 field and the bulk of scorelines from the real workbook bracket", () => {
  const buf = loadWorkbook();
  const { parsed, fixtures, scores } = buildFixtures(buf);
  const canonical = new Set(parsed.canonicalTeams);

  const apiMatches: NormalizedMatch[] = parsed.knockoutPredictions.map((k) =>
    koMatch(stageOfSlot(k.matchNo), k.homeTeam, k.awayTeam, k.predHome, k.predAway),
  );

  const { writes } = deriveActualKnockout(apiMatches, fixtures, scores, canonical);

  // Corroboration guarantee: EVERY write is an exact match for the workbook's slot
  // (matchup, oriented scoreline, penalty winner). We never store a fabricated
  // matchup — only slots whose derived pair the API confirms.
  const wbByNo = new Map(parsed.knockoutPredictions.map((k) => [k.matchNo, k]));
  for (const w of writes) {
    const k = wbByNo.get(w.match_no)!;
    assert.equal(w.home_team, k.homeTeam, `slot ${w.match_no} home`);
    assert.equal(w.away_team, k.awayTeam, `slot ${w.match_no} away`);
    assert.equal(w.home_goals, k.predHome, `slot ${w.match_no} home goals`);
    assert.equal(w.away_goals, k.predAway, `slot ${w.match_no} away goals`);
    assert.equal(w.penalty_winner, k.penaltyWinner, `slot ${w.match_no} pen`);
  }

  // deriveBracket corroborates only 10/16 of this fixture's R32 slot matchups by
  // exact derivation (groups D & H are fair-play-tied, cascading through the thirds
  // assignment); the group-membership recovery pass then fills the other 6 from the
  // leftover API fixtures — so all 16 R32 slots resolve, every one matching the
  // workbook exactly (asserted in the loop above).
  const r32Writes = writes.filter((w) => w.match_no >= 73 && w.match_no <= 88);
  assert.equal(r32Writes.length, 16, "all 16 R32 slots resolve (corroboration + recovery)");
  // Their participants are a subset of the real R32 field.
  const r32Set = new Set(parsed.advancers.R32);
  for (const w of r32Writes) {
    assert.ok(r32Set.has(w.home_team) && r32Set.has(w.away_team));
  }
  // Winner propagation reaches deeper rounds: at least one R16+ slot is corroborated.
  assert.ok(writes.some((w) => w.match_no >= 89), "propagation resolves at least one R16+ slot");
});

test("opens R32 with matchups (no scores) the moment the draw is set, before any game", () => {
  const buf = loadWorkbook();
  const { parsed, fixtures, scores } = buildFixtures(buf);
  const canonical = new Set(parsed.canonicalTeams);

  // The actual R32 field (self-consistent with our standings), as SCHEDULED API
  // fixtures with no score yet — the state right after the group stage ends.
  const r32 = deriveBracket(fixtures, scores, {});
  const apiMatches: NormalizedMatch[] = [];
  for (const no of KNOCKOUT_ROUNDS[0].matches) {
    const m = r32.matchups.get(no)!;
    apiMatches.push({
      stage: "LAST_32",
      status: "SCHEDULED",
      homeApi: m.home,
      awayApi: m.away,
      homeGoals: null,
      awayGoals: null,
      winner: null,
    });
  }

  const { writes } = deriveActualKnockout(apiMatches, fixtures, scores, canonical);
  assert.equal(writes.length, 16, "all 16 R32 matchups are written");
  for (const w of writes) {
    assert.ok(w.match_no >= 73 && w.match_no <= 88, "only R32 slots (no deeper rounds yet)");
    assert.equal(w.home_goals, null, "no score before kickoff");
    assert.equal(w.away_goals, null);
    assert.equal(w.penalty_winner, null);
    assert.ok(w.home_team && w.away_team, "both teams known");
  }
});
