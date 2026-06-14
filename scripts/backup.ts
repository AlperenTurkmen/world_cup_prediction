/**
 * Export every table to JSON files under backups/YYYYMMDD_HHMMSS/.
 *
 * Uses the service-role key from .env.local — no pg connection string needed.
 * Paginates in 1 000-row chunks so large tables don't hit Supabase's default
 * response limit.
 *
 * Usage:
 *   npx tsx scripts/backup.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function fetchAll(
  supabase: SupabaseClient,
  table: string,
): Promise<unknown[]> {
  const PAGE = 1000;
  const rows: unknown[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

const TABLES = [
  // Core prediction data — most important
  "entries",
  "predictions",
  "advancement_predictions",
  "knockout_predictions",
  "entry_drafts",
  // Social
  "follows",
  "leagues",
  "league_members",
  // Admin-logged results
  "matches",
  "actual_advancers",
  "actual_knockout_matches",
  // Static config (re-seedable, but back up anyway)
  "team_groups",
  "scoring_weights",
  "round_weights",
];

async function main(): Promise<void> {
  loadEnvLocal();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check .env.local.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .slice(0, 15);
  const outDir = join(
    new URL("..", import.meta.url).pathname,
    "backups",
    stamp,
  );
  mkdirSync(outDir, { recursive: true });

  const summary: Record<string, number | string> = {};
  for (const table of TABLES) {
    process.stdout.write(`  ${table} … `);
    try {
      const rows = await fetchAll(supabase, table);
      writeFileSync(
        join(outDir, `${table}.json`),
        JSON.stringify(rows, null, 2),
      );
      summary[table] = rows.length;
      console.log(`${rows.length} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary[table] = `SKIPPED: ${msg}`;
      console.log(`skipped (${msg})`);
    }
  }

  writeFileSync(
    join(outDir, "_summary.json"),
    JSON.stringify({ exported_at: now.toISOString(), tables: summary }, null, 2),
  );

  console.log(`\nBackup written to: backups/${stamp}/`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
