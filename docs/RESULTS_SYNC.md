# Auto-sync of match results (football-data.org)

How the app pulls real World Cup results from a free API and applies them
automatically, so the admin doesn't have to hand-log all 104 matches. This is an
*accelerator* — the manual admin forms (`/admin`) remain the authoritative
override and nothing here changes the scoring model.

> TL;DR: a secret-protected `POST /api/sync` fetches finished matches from
> football-data.org and writes them through the **same** paths the admin forms
> use. Trigger it with the **"Sync now"** button in `/admin` or an external cron.

---

## 1. Data source

**[football-data.org](https://www.football-data.org/)** — free tier.

| Property | Value |
|----------|-------|
| Competition | FIFA World Cup, code **`WC`** |
| Auth | header **`X-Auth-Token: <FOOTBALL_DATA_API_KEY>`** (free signup) |
| Rate limit | **10 requests/minute** (no documented daily cap) |
| Endpoints used | `GET /v4/competitions/WC/matches`, `GET /v4/competitions/WC/teams` |

**Important caveat:** the free tier is **not a true live feed**. Finished results
appear a few minutes after the final whistle, not ball-by-ball. We only ever act
on `status === "FINISHED"` matches, so this is fine — but it means polling faster
than the API updates buys nothing (see §6).

---

## 2. How it works

```
football-data.org ──fetch──▶ normalize ──▶ syncResults (pure diff) ──▶ apply
   /WC/matches          NormalizedMatch[]      SyncDiff             matches table
                                                                    + replace_actual_advancers
```

| File | Role |
|------|------|
| [`lib/footballData.ts`](../lib/footballData.ts) | API client. `fetchWorldCupMatches()` is the only network call; `normalizeMatches()` is a pure shaper (testable). |
| [`lib/teamNameMap.ts`](../lib/teamNameMap.ts) | API team name → canonical name. Exceptions only; `resolveCanonical()` falls back to identity. |
| [`lib/syncResults.ts`](../lib/syncResults.ts) | **Pure** diff engine (no network/DB, like `deriveBracket`). Fully unit-tested. |
| [`app/api/sync/route.ts`](../app/api/sync/route.ts) | The endpoint: auth → fetch → diff → write. |
| [`app/admin/SyncResults.tsx`](../app/admin/SyncResults.tsx) | The "Sync now" admin button. |
| [`scripts/checkTeamMap.ts`](../scripts/checkTeamMap.ts) | Dev tool to verify the name map (see §3). |

### What gets written

- **Group matches** (`GROUP_STAGE`, `FINISHED`): map both team names to canonical,
  find the seeded fixture by the (home, away) pair (trying both orders, swapping
  goals if reversed), and write `home_goals`/`away_goals` + `result_logged_at =
  now()` to the `matches` row — **only if that row's `home_goals` is still NULL.**
  Already-logged rows are never touched (this is what protects manual results).
- **Knockout advancers** (`LAST_32`→R32, `LAST_16`→R16, `QUARTER_FINALS`→QF,
  `SEMI_FINALS`→SF, `FINAL`→FINAL): a team that *appears* in a stage's fixtures
  "reached" that round. The full set per round is written via
  `replace_actual_advancers` (idempotent). `CHAMPION` = the winner of the
  `FINISHED` final. `THIRD_PLACE` is intentionally ignored.

Knockouts are scored by **advancement only** (see
[`SCORING_DESIGN.md`](./SCORING_DESIGN.md)), so the sync deliberately does **not**
write knockout scorelines — only the advancer sets.

### What does NOT change

No DB schema change, no scoring change, no new npm dependency (uses built-in
`fetch`). The sync reuses `getMatches()`/`getCanonicalTeams()`
([`lib/adminData.ts`](../lib/adminData.ts)) and the same `matches` update +
`replace_actual_advancers` RPC the admin forms use.

---

## 3. Team-name mapping

Every result/advancer must match one of the canonical 48 names **exactly** (the
quirky strings in the seeded `matches` table: `Bosnia/Herzeg.`, `Rep. of Korea`,
`IR Iran`, `Curaçao`, `Czech Rep.`, `DR Congo`, `USA`, …). The API uses plain
English names, so `lib/teamNameMap.ts` lists the **exceptions** where they differ
(e.g. `Bosnia-Herzegovina → Bosnia/Herzeg.`, `South Korea → Rep. of Korea`,
`Iran → IR Iran`). Names that already match need no entry.

An unmappable name is **never coerced** — it's reported in the response's
`skipped` array and that match is left unwritten.

**Verify the map before relying on it** (the API's spelling can drift by season):

```bash
FOOTBALL_DATA_API_KEY=... npx tsx scripts/checkTeamMap.ts
```

It reads the canonical 48 from the master workbook and the team names from the
API, then reports any API name with no canonical match and any canonical team no
API name maps to. Exit 0 = clean (currently **48/48**).

---

## 4. Triggering & auth

`POST /api/sync` accepts **either**:

- a valid **admin session cookie** — used by the "Sync now" button in `/admin`, or
- **`Authorization: Bearer <SYNC_SECRET>`** — used by an external scheduler.

Both checks are constant-time. No body required. Response:

```json
{ "ok": true, "groupsApplied": 1,
  "advancersByRound": { "R32": 0, "R16": 0, "QF": 0, "SF": 0, "FINAL": 0, "CHAMPION": 0 },
  "skipped": [] }
```

| Field | Meaning |
|-------|---------|
| `groupsApplied` | count of **newly** written group results (0 = nothing new since last run) |
| `advancersByRound` | size of each round's advancer set after the sync |
| `skipped` | human-readable notes for matches that couldn't be applied (unknown team, no fixture) — should be empty |

Errors: `401` (bad/missing auth), `502` (football-data.org unreachable — harmless,
the next run retries), `500` (a DB write failed).

### Setting up the external scheduler

Use a free scheduler such as **[cron-job.org](https://cron-job.org)** (Vercel
Hobby cron only fires once/day, so it's not used as the primary trigger). Its
"Import from cURL" accepts:

```bash
curl -X POST https://<your-app>.vercel.app/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Recommended interval: **every 2–3 minutes**. See §6 for why faster isn't better.

---

## 5. Interaction with scoring & fairness (important)

The sync sets `result_logged_at = now()` on the rows it writes. This feeds the
**second** fairness gate in the `leaderboard` view:
`result_logged_at IS NULL OR entry.created_at < result_logged_at`.

The **first** gate, `predictions.is_score_eligible`, is frozen *per prediction at
entry-creation time* ([`db/migration.sql`](../db/migration.sql)): a prediction is
eligible only if, when the entry was uploaded, the match hadn't kicked off **and**
no result/goals existed. This is the real lock — once a match has goals, any
**new** entry gets `is_score_eligible = false` for it and can't farm played games,
regardless of `result_logged_at`.

**Consequence — manually-entered results with a NULL `result_logged_at` are
harmless.** Because an eligible prediction is by definition uploaded before
kickoff, `created_at < kickoff_at` is already guaranteed, so the leaderboard
scores identically whether `result_logged_at` is `null` or set. Backfilling it is
purely cosmetic. (If you ever want uniformity:
`update matches set result_logged_at = coalesce(kickoff_at, now()) where home_goals
is not null and result_logged_at is null;`)

Results written **by the sync** always carry a real `result_logged_at`, so they're
consistent by construction.

---

## 6. Polling frequency

Each `/api/sync` run makes **exactly one** football-data.org call (one request
returns all matches). So even every-minute polling is 1 call/min — well under the
10/min limit.

But faster ≠ fresher: the free tier only updates finished results every few
minutes, so polling faster than that just runs no-op syncs (and burns Vercel
invocations + Supabase reads). **Every 2–3 minutes is the sweet spot.** Don't go
below 1 minute — there's no upside.

---

## 7. Configuration (env vars)

Set in `.env.local` (local) **and** Vercel → Project → Settings → Environment
Variables (production), then redeploy:

| Var | Purpose |
|-----|---------|
| `FOOTBALL_DATA_API_KEY` | football-data.org auth (free signup) |
| `SYNC_SECRET` | bearer token the external scheduler presents to `/api/sync` |

Missing `FOOTBALL_DATA_API_KEY` → `/api/sync` returns a clear `502`. Missing
`SYNC_SECRET` → only the admin-cookie path works (the bearer path always 401s).

---

## 8. Verification & troubleshooting

- **Unit tests:** `npm test` runs `lib/syncResults.test.ts` (newly-finished vs
  already-logged group rows, reversed-orientation goal swap, unknown-team →
  skipped, knockout bucketing, final → champion) and `lib/teamNameMap.test.ts`.
- **Live auth check:** `curl -X POST .../api/sync` → `401`; with a wrong bearer →
  `401`. A valid call → `200` with the JSON above.
- **`groupsApplied: 0` is normal** when nothing new has finished — it does **not**
  mean failure. Cross-check against the API if unsure (one-off diagnostic: load
  `.env.local`, call `fetchWorldCupMatches()`, count `FINISHED` `GROUP_STAGE`
  matches, compare to `matches` rows where `home_goals is not null`).
- **Non-empty `skipped`** means a name didn't resolve or a fixture pair wasn't
  found → add the missing entry to `lib/teamNameMap.ts` and re-run
  `scripts/checkTeamMap.ts`.
- **Recurring `502` in the scheduler history** = football-data.org was briefly
  down; ignore, the next run catches up.

Always run `npm test` after touching `lib/syncResults.ts`, `lib/footballData.ts`,
or `lib/teamNameMap.ts`.
