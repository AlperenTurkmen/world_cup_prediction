/**
 * parseWorkbook — extracts a user's predictions from a filled copy of the
 * Hermann Baum "WCup_2026" workbook (v4.2.7).
 *
 * The upload is a *self-calculating Excel bracket*, not a flat table. We read it
 * with an anchor-scan of the `World Cup` sheet (PLAN.md §S2): every match has a
 * static integer label 1–104 (the "anchor"); teams and scores sit at fixed
 * offsets from that anchor.
 *
 * Two gotchas handled here:
 *   1. Column offset changes by round — groups/R32/R16 read teams at c+1/c+2,
 *      while QF and deeper read at c+1/c+3 (one empty column between the teams).
 *      The champion is at c+7 from the match-104 anchor.
 *   2. Knockout team names are Excel formulas. SheetJS reads the last *saved*
 *      computed value, so a file that was never opened/recalced in Excel has
 *      blank knockout cells. We detect that and reject with a clear message.
 *
 * This module is pure (no DB, no `server-only`) so it can run in a route
 * handler, in scripts/seed.ts, and in tests.
 */
import * as XLSX from "xlsx";

export type AdvRound = "R32" | "R16" | "QF" | "SF" | "FINAL" | "CHAMPION";

export interface GroupPrediction {
  matchNo: number; // 1..72
  team1: string;
  team2: string;
  predHome: number;
  predAway: number;
}

export interface Advancers {
  R32: string[]; // 32 teams
  R16: string[]; // 16
  QF: string[]; // 8
  SF: string[]; // 4
  FINAL: string[]; // 2 (the finalists — match 104)
  CHAMPION: string; // 1
}

/**
 * A predicted knockout scoreline. `penaltyWinner` is set only when the
 * regulation score is level (the match went to a shoot-out); it names the team
 * that advanced. Covers matches 73–102 and 104 (the third-place playoff, 103,
 * is excluded — it has no bearing on advancement and is left out so manual and
 * upload entries score symmetrically).
 */
export interface KnockoutPrediction {
  matchNo: number; // 73..102, 104
  homeTeam: string;
  awayTeam: string;
  predHome: number;
  predAway: number;
  penaltyWinner: string | null;
}

export interface ParsedWorkbook {
  groupPredictions: GroupPrediction[];
  advancers: Advancers;
  /** Knockout scorelines (best-effort; missing/blank cells are skipped). */
  knockoutPredictions: KnockoutPrediction[];
  /** The canonical 48-team list, derived from the `Matches` sheet. */
  canonicalTeams: string[];
}

/** Expected advancer counts per round — also asserted by the parser. */
export const ADVANCER_COUNTS: Record<AdvRound, number> = {
  R32: 32,
  R16: 16,
  QF: 8,
  SF: 4,
  FINAL: 2,
  CHAMPION: 1,
};

/** Thrown for any unparseable / invalid workbook, with a user-facing message. */
export class WorkbookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookParseError";
  }
}

const WORLD_CUP_SHEET = "World Cup";
const MATCHES_SHEET = "Matches";

type Round = "GROUP" | "R32" | "R16" | "QF" | "SF" | "THIRD" | "FINAL";

function roundOf(matchNo: number): Round {
  if (matchNo <= 72) return "GROUP";
  if (matchNo <= 88) return "R32";
  if (matchNo <= 96) return "R16";
  if (matchNo <= 100) return "QF";
  if (matchNo <= 102) return "SF";
  if (matchNo === 103) return "THIRD";
  return "FINAL"; // 104
}

/** Teams sit one empty column apart for QF and everything deeper. */
function team2ColOffset(round: Round): number {
  switch (round) {
    case "QF":
    case "SF":
    case "THIRD":
    case "FINAL":
      return 3;
    default:
      return 1 + 1; // c+2 for GROUP, R32, R16
  }
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** A reader that returns the cached cell value at a (row, col) zero-based pair. */
function makeCellReader(ws: XLSX.WorkSheet) {
  return (r: number, c: number): unknown => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell ? cell.v : undefined;
  };
}

/**
 * Canonical 48-team list: the unique teams across group matches 1–72 in the
 * `Matches` sheet (B = match no., I = team 1, J = team 2; rows 4+). Every
 * parsed name is validated against this exact set — no silent coercion.
 */
export function buildCanonicalTeams(wb: XLSX.WorkBook): string[] {
  const ws = wb.Sheets[MATCHES_SHEET];
  if (!ws) {
    throw new WorkbookParseError(
      `This file is missing the "${MATCHES_SHEET}" sheet — it does not look like a WCup_2026 workbook.`,
    );
  }
  const get = makeCellReader(ws);
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const teams = new Set<string>();
  for (let r = range.s.r; r <= range.e.r; r++) {
    // B = col 1, I = col 8, J = col 9
    const matchNo = get(r, 1);
    if (typeof matchNo === "number" && Number.isInteger(matchNo) && matchNo >= 1 && matchNo <= 72) {
      const t1 = get(r, 8);
      const t2 = get(r, 9);
      if (!isBlank(t1)) teams.add(String(t1).trim());
      if (!isBlank(t2)) teams.add(String(t2).trim());
    }
  }
  if (teams.size !== 48) {
    throw new WorkbookParseError(
      `Expected 48 canonical teams in the "${MATCHES_SHEET}" sheet but found ${teams.size}. The workbook may be a different version.`,
    );
  }
  return [...teams];
}

interface Anchor {
  r: number;
  c: number;
}

/** Index every integer cell 1–104 in the `World Cup` sheet by its value. */
function scanAnchors(ws: XLSX.WorkSheet): Map<number, Anchor[]> {
  const get = makeCellReader(ws);
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const byValue = new Map<number, Anchor[]>();
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = get(r, c);
      if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 104) {
        const list = byValue.get(v) ?? [];
        list.push({ r, c });
        byValue.set(v, list);
      }
    }
  }
  return byValue;
}

interface ResolvedMatch {
  matchNo: number;
  round: Round;
  anchor: Anchor;
  team1: string;
  team2: string;
}

/**
 * Resolve a single match number to its real anchor.
 *
 * Most match numbers appear exactly once in the sheet, but a few small values
 * (1–7, 9) collide with venue numbers in the schedule grid. We disambiguate by
 * the only thing that distinguishes a real match from a venue cell: the offset
 * cells hold canonical team names. The static integer labels are present even
 * in a non-recalced file, so a knockout anchor whose team cells are blank is
 * the "open and save in Excel" case — reported via the `blankKnockout` list.
 */
function resolveMatch(
  matchNo: number,
  candidates: Anchor[],
  get: (r: number, c: number) => unknown,
  isCanon: (v: unknown) => boolean,
  blankKnockout: number[],
): ResolvedMatch | null {
  const round = roundOf(matchNo);
  const t2Off = team2ColOffset(round);

  let firstNonCanon: string | null = null;
  for (const a of candidates) {
    const t1 = get(a.r + 2, a.c + 1);
    const t2 = get(a.r + 2, a.c + t2Off);
    if (isCanon(t1) && isCanon(t2)) {
      return {
        matchNo,
        round,
        anchor: a,
        team1: String(t1).trim(),
        team2: String(t2).trim(),
      };
    }
    // Remember a present-but-unknown name to give a precise error later.
    if (firstNonCanon === null) {
      if (!isBlank(t1) && !isCanon(t1)) firstNonCanon = String(t1).trim();
      else if (!isBlank(t2) && !isCanon(t2)) firstNonCanon = String(t2).trim();
    }
  }

  // No candidate resolved cleanly.
  if (round !== "GROUP") {
    // Knockout numbers are unique; if the team cells are blank, the file was
    // never recalced. If a name is present but unknown, surface it.
    if (firstNonCanon !== null) {
      throw new WorkbookParseError(
        `Match ${matchNo}: team name "${firstNonCanon}" is not one of the 48 tournament teams.`,
      );
    }
    blankKnockout.push(matchNo);
    return null;
  }

  // Group matches are static and should always resolve.
  if (firstNonCanon !== null) {
    throw new WorkbookParseError(
      `Group match ${matchNo}: team name "${firstNonCanon}" is not one of the 48 tournament teams.`,
    );
  }
  throw new WorkbookParseError(
    `Could not locate group match ${matchNo} in the "${WORLD_CUP_SHEET}" sheet. The workbook may be a different version.`,
  );
}

function readGroupScore(value: unknown, matchNo: number, side: "home" | "away"): number {
  if (isBlank(value)) {
    throw new WorkbookParseError(
      `Group match ${matchNo} is missing a predicted ${side} score. Fill in all 72 group scores before uploading.`,
    );
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WorkbookParseError(
      `Group match ${matchNo} has an invalid ${side} score (${JSON.stringify(value)}). Scores must be whole numbers of 0 or more.`,
    );
  }
  return value;
}

/** A non-negative integer cell value, or null if blank/invalid (lenient). */
function readIntCell(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return null;
}

/**
 * Read a knockout match's regulation scoreline and, if it was level, the
 * penalty shoot-out winner. Scores sit one row below the team cells (r+3) and
 * penalties two rows below that (r+5), at the same columns as the teams. Returns
 * null when the scoreline is blank or a draw has no resolvable shoot-out — those
 * are skipped rather than rejected, so a file that parsed before still parses.
 */
function readKnockoutScore(
  get: (r: number, c: number) => unknown,
  anchor: Anchor,
  round: Round,
  team1: string,
  team2: string,
): { predHome: number; predAway: number; penaltyWinner: string | null } | null {
  const t2Off = team2ColOffset(round);
  const predHome = readIntCell(get(anchor.r + 3, anchor.c + 1));
  const predAway = readIntCell(get(anchor.r + 3, anchor.c + t2Off));
  if (predHome === null || predAway === null) return null;

  let penaltyWinner: string | null = null;
  if (predHome === predAway) {
    const penHome = readIntCell(get(anchor.r + 5, anchor.c + 1));
    const penAway = readIntCell(get(anchor.r + 5, anchor.c + t2Off));
    if (penHome === null || penAway === null || penHome === penAway) return null;
    penaltyWinner = penHome > penAway ? team1 : team2;
  }
  return { predHome, predAway, penaltyWinner };
}

/**
 * Parse a filled WCup_2026 workbook from an ArrayBuffer.
 * @throws WorkbookParseError with a user-facing message on any invalid input.
 */
export function parseWorkbook(buffer: ArrayBuffer | Uint8Array): ParsedWorkbook {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new WorkbookParseError("Could not read the file as an Excel workbook (.xlsx).");
  }

  const canonicalTeams = buildCanonicalTeams(wb);
  const canonSet = new Set(canonicalTeams);
  const isCanon = (v: unknown): boolean =>
    typeof v === "string" && canonSet.has(v.trim());

  const ws = wb.Sheets[WORLD_CUP_SHEET];
  if (!ws) {
    throw new WorkbookParseError(
      `This file is missing the "${WORLD_CUP_SHEET}" sheet — it does not look like a WCup_2026 workbook.`,
    );
  }
  const get = makeCellReader(ws);
  const anchors = scanAnchors(ws);

  const groupPredictions: GroupPrediction[] = [];
  const advancers: Advancers = { R32: [], R16: [], QF: [], SF: [], FINAL: [], CHAMPION: "" };
  const knockoutPredictions: KnockoutPrediction[] = [];
  const blankKnockout: number[] = [];

  for (let matchNo = 1; matchNo <= 104; matchNo++) {
    const candidates = anchors.get(matchNo) ?? [];
    const resolved = resolveMatch(matchNo, candidates, get, isCanon, blankKnockout);
    if (!resolved) continue; // blank knockout — collected for a single message below

    // Knockout scorelines (matches 73–102 and 104; the third-place game is skipped).
    if (resolved.round !== "GROUP" && resolved.round !== "THIRD") {
      const sc = readKnockoutScore(get, resolved.anchor, resolved.round, resolved.team1, resolved.team2);
      if (sc) {
        knockoutPredictions.push({
          matchNo,
          homeTeam: resolved.team1,
          awayTeam: resolved.team2,
          predHome: sc.predHome,
          predAway: sc.predAway,
          penaltyWinner: sc.penaltyWinner,
        });
      }
    }

    switch (resolved.round) {
      case "GROUP": {
        const predHome = readGroupScore(get(resolved.anchor.r + 3, resolved.anchor.c + 1), matchNo, "home");
        const predAway = readGroupScore(get(resolved.anchor.r + 3, resolved.anchor.c + 2), matchNo, "away");
        groupPredictions.push({ matchNo, team1: resolved.team1, team2: resolved.team2, predHome, predAway });
        break;
      }
      case "R32":
        advancers.R32.push(resolved.team1, resolved.team2);
        break;
      case "R16":
        advancers.R16.push(resolved.team1, resolved.team2);
        break;
      case "QF":
        advancers.QF.push(resolved.team1, resolved.team2);
        break;
      case "SF":
        advancers.SF.push(resolved.team1, resolved.team2);
        break;
      case "THIRD":
        // Third-place playoff: both teams are already counted as semi-finalists.
        break;
      case "FINAL": {
        advancers.FINAL.push(resolved.team1, resolved.team2);
        const champ = get(resolved.anchor.r + 2, resolved.anchor.c + 7);
        if (isBlank(champ)) {
          blankKnockout.push(104);
        } else if (!isCanon(champ)) {
          throw new WorkbookParseError(
            `The champion "${String(champ).trim()}" is not one of the 48 tournament teams.`,
          );
        } else {
          advancers.CHAMPION = String(champ).trim();
        }
        break;
      }
    }
  }

  if (blankKnockout.length > 0) {
    throw new WorkbookParseError(
      "The knockout bracket is blank — Excel hasn't recalculated it. Please open the file in Excel, save it once, then re-upload.",
    );
  }

  // Structural assertions (PLAN §S2 validation gate).
  if (groupPredictions.length !== 72) {
    throw new WorkbookParseError(
      `Expected 72 group predictions but parsed ${groupPredictions.length}.`,
    );
  }
  const roundLists: Array<[AdvRound, string[]]> = [
    ["R32", advancers.R32],
    ["R16", advancers.R16],
    ["QF", advancers.QF],
    ["SF", advancers.SF],
    ["FINAL", advancers.FINAL],
  ];
  for (const [round, list] of roundLists) {
    if (list.length !== ADVANCER_COUNTS[round]) {
      throw new WorkbookParseError(
        `Expected ${ADVANCER_COUNTS[round]} teams in ${round} but parsed ${list.length}.`,
      );
    }
    // Each round's advancers should be distinct teams.
    if (new Set(list).size !== list.length) {
      throw new WorkbookParseError(`Duplicate team found in ${round} advancers.`);
    }
  }
  if (isBlank(advancers.CHAMPION)) {
    throw new WorkbookParseError("Could not read the predicted champion from the workbook.");
  }

  return { groupPredictions, advancers, knockoutPredictions, canonicalTeams };
}
