/**
 * deriveBracket validation gate — the manual-entry bracket engine must, from the
 * master workbook's own group scorelines, reproduce the same Round-of-32 field
 * the workbook computes, and assign the eight third-placed teams to the correct
 * R32 slots via the FIFA combination table.
 *
 * One intentional divergence: standings use points → goal difference → goals for
 * → team name, identical to the leaderboard SQL (so derived positions match how
 * dimension B scores them). The workbook breaks exact ties with fair-play points
 * instead (it flags groups D and H in its `Distinctness` sheet). Fair-play points
 * aren't predictable, so we do NOT replicate them: in a tied group the workbook
 * and our engine may swap which team is 2nd vs 3rd. Both teams still reach R32, so
 * the R32 *set* is unchanged — but per-slot identity in a tied group is not a
 * valid oracle, and the assertions below avoid relying on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./parseWorkbook";
import {
  deriveBracket,
  resolveR32Slots,
  computeStandings,
  KNOCKOUT_ROUNDS,
  type GroupFixture,
  type GroupScores,
  type KnockoutScores,
} from "./deriveBracket";
import { THIRD_SLOT_ORDER, THIRD_ASSIGNMENT } from "./bracketData";

type Standing = { team: string; group: string; pts: number; gf: number; ga: number; gd: number };
type StandingsMap = Parameters<typeof resolveR32Slots>[0];

function loadWorkbook() {
  return readFileSync(new URL("../WCup_2026_4.2.7_en.xlsx", import.meta.url));
}

/** team → group letter, from the workbook's Groups sheet (slot B = "A1".., name D). */
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

test("derives the workbook's exact Round-of-32 field from its own scorelines", () => {
  const buf = loadWorkbook();
  const { parsed, fixtures, scores } = buildFixtures(buf);

  const derived = deriveBracket(fixtures, scores, {});
  const sorted = (a: string[]) => [...a].sort();
  assert.equal(derived.advancers.R32.length, 32);
  assert.deepEqual(sorted(derived.advancers.R32), sorted(parsed.advancers.R32));
});

test("assigns third-placed teams to the correct R32 slots (FIFA combination table)", () => {
  // Synthetic standings with no ties, so the assignment wiring is tested
  // independently of any fixture's tie-break quirks. Groups C,D,E,F,H,I,J,K get
  // a qualifying third (3 pts); A,B,G,L get a non-qualifying third (0 pts). The
  // best eight thirds therefore come from groups "CDEFHIJK".
  const groups = "ABCDEFGHIJKL".split("");
  const qualifies = new Set("CDEFHIJK".split(""));
  const standings: StandingsMap = new Map();
  for (const g of groups) {
    const thirdPts = qualifies.has(g) ? 3 : 0;
    const teams: Standing[] = [
      { team: `1${g}`, group: g, pts: 9, gf: 9, ga: 0, gd: 9 },
      { team: `2${g}`, group: g, pts: 6, gf: 6, ga: 3, gd: 3 },
      { team: `T${g}`, group: g, pts: thirdPts, gf: thirdPts, ga: 3, gd: thirdPts - 3 },
      { team: `4${g}`, group: g, pts: 0, gf: 0, ga: 9, gd: -9 },
    ];
    standings.set(g, teams);
  }

  const slots = resolveR32Slots(standings);
  const assignment = THIRD_ASSIGNMENT["CDEFHIJK"];
  assert.ok(assignment, "combination CDEFHIJK must be in the table");
  THIRD_SLOT_ORDER.forEach((slot, i) => {
    // Each third slot must hold the third-placed team (T<group>) of the group the
    // FIFA table assigns to it.
    assert.equal(slots.get(slot), `T${assignment[i]}`, `slot ${slot}`);
  });

  // And the 24 group winner/runner-up slots resolve from positions 1 and 2.
  for (const g of groups) {
    assert.equal(slots.get(`1${g}`), `1${g}`);
    assert.equal(slots.get(`2${g}`), `2${g}`);
  }
});

test("a full set of scored knockouts yields a complete, well-nested bracket", () => {
  const buf = loadWorkbook();
  const { fixtures, scores } = buildFixtures(buf);

  // Deterministic synthetic scores: the alphabetically-first participant wins each
  // tie. Match 73 is forced to a draw resolved on penalties, exercising that path.
  const koScores: KnockoutScores = {};
  for (const round of KNOCKOUT_ROUNDS) {
    const { matchups } = deriveBracket(fixtures, scores, koScores);
    for (const no of round.matches) {
      const m = matchups.get(no)!;
      assert.ok(m.home && m.away, `match ${no} should be resolved`);
      const winner = m.home! < m.away! ? m.home! : m.away!;
      koScores[no] =
        no === 73
          ? { home: 1, away: 1, penaltyWinner: winner }
          : winner === m.home
            ? { home: 1, away: 0 }
            : { home: 0, away: 1 };
    }
  }

  const d = deriveBracket(fixtures, scores, koScores);
  assert.equal(d.complete, true);
  assert.equal(d.knockoutPredictions.length, 31);

  // The penalty-decided match stores its winner as penaltyWinner and advances it.
  const m73 = d.knockoutPredictions.find((k) => k.matchNo === 73)!;
  assert.equal(m73.penaltyWinner, koScores[73].penaltyWinner);
  assert.ok(d.advancers.R16.includes(koScores[73].penaltyWinner!));

  const r32 = new Set(d.advancers.R32);
  const r16 = new Set(d.advancers.R16);
  const qf = new Set(d.advancers.QF);
  const sf = new Set(d.advancers.SF);
  const fin = new Set(d.advancers.FINAL);

  assert.equal(d.advancers.R16.length, 16);
  assert.equal(d.advancers.QF.length, 8);
  assert.equal(d.advancers.SF.length, 4);
  assert.equal(d.advancers.FINAL.length, 2);
  assert.ok(d.advancers.CHAMPION);

  for (const t of r16) assert.ok(r32.has(t), `${t} in R16 must be in R32`);
  for (const t of qf) assert.ok(r16.has(t), `${t} in QF must be in R16`);
  for (const t of sf) assert.ok(qf.has(t), `${t} in SF must be in QF`);
  for (const t of fin) assert.ok(sf.has(t), `${t} in FINAL must be in SF`);
  assert.ok(fin.has(d.advancers.CHAMPION), "champion must be a finalist");
});

test("an unfinished bracket is reported incomplete", () => {
  const buf = loadWorkbook();
  const { fixtures, scores } = buildFixtures(buf);
  const derived = deriveBracket(fixtures, scores, {});
  assert.equal(derived.complete, false);
  assert.equal(derived.advancers.R32.length, 32, "R32 participants derive from standings alone");
  assert.equal(derived.advancers.R16.length, 0, "no winners picked yet");
});
