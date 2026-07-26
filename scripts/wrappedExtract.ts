/**
 * Phase 0 of the "Wrapped" build (docs/WRAPPED_PLAN.md): a READ-ONLY extract +
 * sanity check of the final, frozen tournament data.
 *
 * It pulls every table the analytics needs plus the live `leaderboard` view,
 * prints a validation report (5 entries? 72 group results? all knockouts logged?
 * champion set? did everyone submit before kickoff?), and freezes a combined
 * snapshot to backups/ (gitignored — contains PII) so the rest of the build can
 * develop and verify against real numbers without re-hitting the DB.
 *
 * SELECT-only: it never writes to Supabase.
 *
 * Usage:
 *   npx tsx scripts/wrappedExtract.ts
 *
 * Server-side script, so it builds its own service-role client rather than
 * importing lib/supabaseAdmin.ts (guarded by `server-only`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

const TABLES = [
  "entries",
  "predictions",
  "matches",
  "knockout_predictions",
  "round_tour_predictions",
  "advancement_predictions",
  "actual_advancers",
  "actual_knockout_matches",
  "team_groups",
  "round_weights",
  "scoring_weights",
  "app_settings",
  "leaderboard", // the live scoring view
] as const;

function h(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const table of TABLES) {
    snapshot[table] = await fetchAll(supabase, table);
    console.log(`  fetched ${table}: ${snapshot[table].length} rows`);
  }

  // ---- Freeze the snapshot (gitignored backups/) ----------------------------
  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const outDir = join(scriptDir, "..", "backups");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "wrapped_snapshot.json");
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
  console.log(`\n  snapshot written to backups/wrapped_snapshot.json`);

  // ---- Sanity report --------------------------------------------------------
  const entries = snapshot.entries;
  const predictions = snapshot.predictions;
  const matches = snapshot.matches;
  const koActual = snapshot.actual_knockout_matches;
  const advancers = snapshot.actual_advancers;
  const board = snapshot.leaderboard;

  h("ENTRIES");
  console.log(`count: ${entries.length}`);
  for (const e of entries) {
    console.log(
      `  #${e.id} ${e.username}  hidden=${e.is_hidden}  created_at=${e.created_at}  google=${e.google_email ?? "-"}`,
    );
  }

  h("GROUP MATCHES (1..72)");
  const played = matches.filter(
    (m) => m.home_goals !== null && m.away_goals !== null,
  );
  console.log(`total matches rows: ${matches.length}  |  with result: ${played.length}`);
  const kickoffs = matches
    .map((m) => m.kickoff_at as string | null)
    .filter((k): k is string => !!k)
    .sort();
  const firstKickoff = kickoffs[0];
  console.log(`earliest group kickoff: ${firstKickoff}`);
  console.log(`latest group kickoff:   ${kickoffs[kickoffs.length - 1]}`);

  h("KNOCKOUT MATCHES (73..104)");
  const koPlayed = koActual.filter(
    (m) => m.home_goals !== null && m.away_goals !== null,
  );
  console.log(`actual_knockout_matches rows: ${koActual.length}  |  with result: ${koPlayed.length}`);
  const koMissing = koActual
    .filter((m) => m.home_goals === null || m.away_goals === null)
    .map((m) => m.match_no)
    .sort((a, b) => (a as number) - (b as number));
  if (koMissing.length) console.log(`  KO match_nos missing a result: ${koMissing.join(", ")}`);

  h("ADVANCERS per round");
  const byRound: Record<string, number> = {};
  for (const a of advancers) byRound[a.round as string] = (byRound[a.round as string] ?? 0) + 1;
  console.log(byRound);
  const champ = advancers.find((a) => a.round === "CHAMPION");
  console.log(`CHAMPION: ${champ ? champ.team : "(not set)"}`);

  h("PREDICTIONS per entry (expect 72 each)");
  const predByEntry: Record<number, number> = {};
  for (const p of predictions) predByEntry[p.entry_id as number] = (predByEntry[p.entry_id as number] ?? 0) + 1;
  for (const e of entries) {
    console.log(`  ${e.username}: ${predByEntry[e.id as number] ?? 0} group predictions`);
  }

  h("FAIRNESS: did everyone submit before the first kickoff?");
  for (const e of entries) {
    const created = new Date(e.created_at as string).getTime();
    const flag = firstKickoff && created < new Date(firstKickoff).getTime() ? "OK (blind)" : "!! AFTER first kickoff";
    console.log(`  ${e.username}: ${e.created_at}  -> ${flag}`);
  }

  h("LEADERBOARD (final)");
  const sorted = [...board].sort((a, b) => (b.total as number) - (a.total as number));
  for (const r of sorted) {
    console.log(
      `  ${r.username}: total=${r.total}  (group=${r.group_points} rank=${r.ranking_points} ko=${r.knockout_points})  exact=${r.exact_count}  champ=${r.champion_pick}${r.champion_correct ? " ✓" : ""}  played=${r.played_count}`,
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
