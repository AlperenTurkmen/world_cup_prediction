/**
 * Verify lib/teamNameMap.ts against live data BEFORE relying on the auto-sync.
 *
 * Reads the canonical 48 team names from the master workbook's `Matches` sheet
 * (the same source scripts/seed.ts uses to populate the `matches` table), fetches
 * the World Cup team names as football-data.org spells them, and reports:
 *   - API names that don't resolve to any canonical team (need a map entry)
 *   - canonical teams that no API name maps to (likely a missing/typo'd entry)
 *
 * Usage:
 *   FOOTBALL_DATA_API_KEY=... npx tsx scripts/checkTeamMap.ts
 * or put the key in .env.local and run the same command.
 */
import { readFileSync, existsSync } from "node:fs";
import * as XLSX from "xlsx";
import { fetchWorldCupTeamNames } from "../lib/footballData";
import { resolveCanonical } from "../lib/teamNameMap";

function loadEnvLocal(): void {
  const url = new URL("../.env.local", import.meta.url);
  if (!existsSync(url)) return;
  for (const rawLine of readFileSync(url, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function canonicalFromWorkbook(): Set<string> {
  const url = new URL("../WCup_2026_4.2.7_en.xlsx", import.meta.url);
  const wb = XLSX.read(readFileSync(url), { type: "array" });
  const ws = wb.Sheets["Matches"];
  if (!ws) throw new Error('Master workbook is missing the "Matches" sheet.');
  const get = (r: number, c: number): unknown => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell ? cell.v : undefined;
  };
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const teams = new Set<string>();
  for (let r = range.s.r; r <= range.e.r; r++) {
    const matchNo = get(r, 1); // B
    if (typeof matchNo !== "number" || matchNo < 1 || matchNo > 72) continue;
    const home = get(r, 8); // I
    const away = get(r, 9); // J
    if (home != null) teams.add(String(home).trim());
    if (away != null) teams.add(String(away).trim());
  }
  return teams;
}

async function main() {
  loadEnvLocal();
  const canonical = canonicalFromWorkbook();
  console.log(`Canonical teams in workbook: ${canonical.size}`);

  const apiNames = await fetchWorldCupTeamNames();
  console.log(`Team names from football-data.org: ${apiNames.length}\n`);

  const unmapped: string[] = [];
  const covered = new Set<string>();
  for (const name of apiNames) {
    const c = resolveCanonical(name, canonical);
    if (c) covered.add(c);
    else unmapped.push(name);
  }

  if (unmapped.length === 0) {
    console.log("✓ Every API name resolves to a canonical team.");
  } else {
    console.log("✗ API names with NO canonical match (add to TEAM_NAME_MAP):");
    for (const n of unmapped) console.log(`    "${n}"`);
  }

  const missing = [...canonical].filter((c) => !covered.has(c)).sort();
  if (missing.length === 0) {
    console.log("✓ Every canonical team is covered by an API name.");
  } else {
    console.log("\n✗ Canonical teams not produced by any API name:");
    for (const m of missing) console.log(`    ${m}`);
  }

  process.exit(unmapped.length === 0 && missing.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
