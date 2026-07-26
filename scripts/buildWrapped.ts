/**
 * Build the cached Wrapped dataset (docs/WRAPPED_PLAN.md, Phase 1).
 *
 * Reads the frozen snapshot (backups/wrapped_snapshot.json, produced by
 * scripts/wrappedExtract.ts), runs the pure lib/wrapped.buildWrapped(), and
 * writes the result to lib/wrappedData.json — committed and imported by the
 * /wrapped pages. The tournament data is final, so this is a one-off build
 * (re-run only if the snapshot is refreshed).
 *
 * With --fetch it pulls a fresh snapshot from Supabase first (same tables as
 * wrappedExtract). Otherwise it uses the existing snapshot on disk.
 *
 * It FAILS if the KO-by-round reconciliation against the SQL leaderboard finds
 * any mismatch — that guards the timeline's per-round knockout attribution.
 *
 * Usage:
 *   npx tsx scripts/buildWrapped.ts            # from the frozen snapshot
 *   npx tsx scripts/buildWrapped.ts --fetch    # refresh snapshot from DB first
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWrapped, type WrappedInput } from "../lib/wrapped";

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
  "leaderboard",
] as const;

async function fetchAll(supabase: SupabaseClient, table: string): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`[${table}] ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function refreshSnapshot(snapshotPath: string): Promise<void> {
  loadEnvLocal();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const snap: Record<string, unknown[]> = {};
  for (const t of TABLES) snap[t] = await fetchAll(supabase, t);
  writeFileSync(snapshotPath, JSON.stringify(snap, null, 2));
  console.log("  refreshed snapshot from DB");
}

async function main(): Promise<void> {
  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const snapshotPath = join(scriptDir, "..", "backups", "wrapped_snapshot.json");
  const outPath = join(scriptDir, "..", "lib", "wrappedData.json");

  if (process.argv.includes("--fetch") || !existsSync(snapshotPath)) {
    await refreshSnapshot(snapshotPath);
  }
  if (!existsSync(snapshotPath)) {
    throw new Error(`No snapshot at ${snapshotPath}. Run scripts/wrappedExtract.ts or pass --fetch.`);
  }

  const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown[]>;
  const input: WrappedInput = {
    entries: snap.entries as WrappedInput["entries"],
    predictions: snap.predictions as WrappedInput["predictions"],
    matches: snap.matches as WrappedInput["matches"],
    knockoutPredictions: snap.knockout_predictions as WrappedInput["knockoutPredictions"],
    tourPredictions: snap.round_tour_predictions as WrappedInput["tourPredictions"],
    advancementPredictions: snap.advancement_predictions as WrappedInput["advancementPredictions"],
    actualAdvancers: snap.actual_advancers as WrappedInput["actualAdvancers"],
    actualKnockout: snap.actual_knockout_matches as WrappedInput["actualKnockout"],
    teamGroups: snap.team_groups as WrappedInput["teamGroups"],
    roundWeights: snap.round_weights as WrappedInput["roundWeights"],
    scoringWeights: snap.scoring_weights as WrappedInput["scoringWeights"],
    leaderboard: snap.leaderboard as WrappedInput["leaderboard"],
  };

  const data = buildWrapped(input);

  if (data.meta.warnings.length) {
    console.error("\n!! KO reconciliation FAILED — the timeline's per-round attribution disagrees with the SQL leaderboard:");
    for (const w of data.meta.warnings) console.error("   " + w);
    console.error("\nRefusing to write a cache with inconsistent knockout points. Fix lib/wrapped.ts koByRound().");
    process.exit(1);
  }

  writeFileSync(outPath, JSON.stringify(data));
  const sizeKb = (readFileSync(outPath).length / 1024).toFixed(1);
  console.log(`\n  ✓ reconciliation OK (derived KO == SQL knockout_points for all ${data.users.length})`);
  console.log(`  wrote lib/wrappedData.json (${sizeKb} KB)`);
  console.log("\n=== Final ranking ===");
  for (const u of data.users) {
    console.log(
      `  #${u.rank} ${u.username}: ${u.total}  [${u.persona.emoji} ${u.persona.name}]  exacts(raw)=${u.exactCountRaw} champ=${u.championPick}${u.championCorrect ? " ✓" : ""}`,
    );
  }
  console.log("\n=== Awards ===");
  for (const aw of data.global.awards) console.log(`  ${aw.emoji} ${aw.title}: ${aw.winner} (${aw.value})`);
  console.log("\n=== Timeline lead changes ===");
  for (const lc of data.global.timeline.leadChanges)
    console.log(`  ${lc.checkpoint}: ${lc.leader}${lc.from ? ` (from ${lc.from})` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
