/**
 * Parser fixture test (PLAN.md §S2 validation gate).
 *
 * Runs lib/parseWorkbook.ts against the master workbook (WCup_2026_4.2.7_en.xlsx,
 * a fully-simulated example whose champion is Spain) and asserts the parse is
 * structurally correct. Run with: `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseWorkbook, ADVANCER_COUNTS } from "./parseWorkbook";

const fixtureUrl = new URL("../WCup_2026_4.2.7_en.xlsx", import.meta.url);
const buffer = readFileSync(fixtureUrl);

/** Independently read the canonical group pairs from the Matches sheet. */
function matchesSheetPairs(): Map<number, [string, string]> {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets["Matches"];
  const get = (r: number, c: number): unknown => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell ? cell.v : undefined;
  };
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const pairs = new Map<number, [string, string]>();
  for (let r = range.s.r; r <= range.e.r; r++) {
    const n = get(r, 1);
    if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 72) {
      pairs.set(n, [String(get(r, 8)).trim(), String(get(r, 9)).trim()]);
    }
  }
  return pairs;
}

test("parses exactly 72 group predictions", () => {
  const { groupPredictions } = parseWorkbook(buffer);
  assert.equal(groupPredictions.length, 72);
});

test("group match numbers are 1..72 with no gaps or dupes", () => {
  const { groupPredictions } = parseWorkbook(buffer);
  const nos = groupPredictions.map((g) => g.matchNo).sort((a, b) => a - b);
  assert.deepEqual(nos, Array.from({ length: 72 }, (_, i) => i + 1));
});

test("advancer counts are R32=32, R16=16, QF=8, SF=4, FINAL=2", () => {
  const { advancers } = parseWorkbook(buffer);
  assert.equal(advancers.R32.length, ADVANCER_COUNTS.R32);
  assert.equal(advancers.R16.length, ADVANCER_COUNTS.R16);
  assert.equal(advancers.QF.length, ADVANCER_COUNTS.QF);
  assert.equal(advancers.SF.length, ADVANCER_COUNTS.SF);
  assert.equal(advancers.FINAL.length, ADVANCER_COUNTS.FINAL);
});

test("champion is Spain", () => {
  const { advancers } = parseWorkbook(buffer);
  assert.equal(advancers.CHAMPION, "Spain");
});

test("group team names exactly equal the Matches sheet pairs", () => {
  const { groupPredictions } = parseWorkbook(buffer);
  const pairs = matchesSheetPairs();
  for (const g of groupPredictions) {
    const expected = pairs.get(g.matchNo);
    assert.ok(expected, `no Matches pair for match ${g.matchNo}`);
    assert.deepEqual([g.team1, g.team2], expected, `teams differ for match ${g.matchNo}`);
  }
});

test("every parsed name is one of the 48 canonical teams", () => {
  const { groupPredictions, advancers, canonicalTeams } = parseWorkbook(buffer);
  assert.equal(canonicalTeams.length, 48);
  const canon = new Set(canonicalTeams);
  const all = [
    ...groupPredictions.flatMap((g) => [g.team1, g.team2]),
    ...advancers.R32,
    ...advancers.R16,
    ...advancers.QF,
    ...advancers.SF,
    ...advancers.FINAL,
    advancers.CHAMPION,
  ];
  for (const name of all) assert.ok(canon.has(name), `non-canonical team: ${name}`);
});

test("predicted group scores are non-negative integers", () => {
  const { groupPredictions } = parseWorkbook(buffer);
  for (const g of groupPredictions) {
    assert.ok(Number.isInteger(g.predHome) && g.predHome >= 0, `bad home score in match ${g.matchNo}`);
    assert.ok(Number.isInteger(g.predAway) && g.predAway >= 0, `bad away score in match ${g.matchNo}`);
  }
});
