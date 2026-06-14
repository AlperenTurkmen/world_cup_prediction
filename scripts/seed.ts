/**
 * Seed the `matches` table with the 72 group fixtures from the master workbook.
 *
 * Reads team names and kickoff times straight from the `Matches` sheet (the
 * canonical fixture list, identical for everyone) and upserts them by match_no.
 * Idempotent: re-running updates the same 72 rows. Knockout matches are NOT
 * seeded — knockouts are scored by advancement only.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed.ts
 * or put those in .env.local (this script loads it automatically) and run:
 *   npm run seed
 *
 * This is a server-side script, so it builds its own service-role client rather
 * than importing lib/supabaseAdmin.ts (which is guarded by `server-only` and
 * only loads inside the Next.js server runtime).
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// --- Minimal .env.local loader (no dependency) -------------------------------
function loadEnvLocal(): void {
  const url = new URL("../.env.local", import.meta.url);
  if (!existsSync(url)) return;
  const text = readFileSync(url, "utf8");
  for (const rawLine of text.split("\n")) {
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

interface Fixture {
  match_no: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
}

/** Convert an Excel date serial (column E, local host time) to an ISO string. */
function serialToIso(serial: unknown): string | null {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return null;
  // Treat the sheet's wall-clock components as UTC for a deterministic value.
  // kickoff_at is informational only (never used in scoring).
  const iso = new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, Math.round(d.S))).toISOString();
  return iso;
}

function readGroupFixtures(): Fixture[] {
  const url = new URL("../WCup_2026_4.2.7_en.xlsx", import.meta.url);
  const wb = XLSX.read(readFileSync(url), { type: "array" });
  const ws = wb.Sheets["Matches"];
  if (!ws) throw new Error('Master workbook is missing the "Matches" sheet.');

  const get = (r: number, c: number): unknown => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell ? cell.v : undefined;
  };
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

  const fixtures: Fixture[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const matchNo = get(r, 1); // B
    if (typeof matchNo !== "number" || !Number.isInteger(matchNo) || matchNo < 1 || matchNo > 72) {
      continue;
    }
    const home = get(r, 8); // I
    const away = get(r, 9); // J
    if (home == null || away == null) continue;
    fixtures.push({
      match_no: matchNo,
      home_team: String(home).trim(),
      away_team: String(away).trim(),
      kickoff_at: serialToIso(get(r, 4)), // E = local host time
    });
  }
  fixtures.sort((a, b) => a.match_no - b.match_no);
  return fixtures;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in the environment or .env.local.",
    );
  }

  const fixtures = readGroupFixtures();
  if (fixtures.length !== 72) {
    throw new Error(`Expected 72 group fixtures, found ${fixtures.length}. Aborting.`);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.from("matches").upsert(fixtures, { onConflict: "match_no" });
  if (error) {
    throw new Error(`Upsert failed: ${error.message}`);
  }

  console.log(`Seeded ${fixtures.length} group fixtures into "matches".`);
  console.log(`  e.g. match 1: ${fixtures[0].home_team} vs ${fixtures[0].away_team}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
