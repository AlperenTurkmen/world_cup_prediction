# Results Auto-Sync

Instead of hand-logging all 104 results, the app can pull real World Cup
fixtures and scores from **[football-data.org](https://www.football-data.org/)**
and apply them automatically. This is an *accelerator* — the admin forms remain
the authoritative override, and nothing here changes the scoring model.

> The full reference (name mapping, write rules, fairness interaction,
> troubleshooting) is in
> [`docs/RESULTS_SYNC.md`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/docs/RESULTS_SYNC.md).
> This page is the quick setup.

## How it works in one line

A secret-protected `POST /api/sync` fetches finished matches from
football-data.org and writes them through the **same** code paths the admin forms
use — only ever acting on `FINISHED` matches, and never overwriting a result you
already logged by hand.

## Setup

1. **Get a free API key** from [football-data.org](https://www.football-data.org/)
   and set it as `FOOTBALL_DATA_API_KEY`.
2. **Set a sync secret** — `SYNC_SECRET` (e.g. `openssl rand -hex 32`) — the token
   an external scheduler will present.
3. Add both to your environment (local `.env.local` and Vercel), then redeploy.

## Triggering it

`POST /api/sync` accepts **either**:

- a valid **admin session cookie** — that's the **"Sync now"** button in `/admin`, or
- an **`Authorization: Bearer <SYNC_SECRET>`** header — for an external scheduler.

### Scheduling

Vercel Hobby cron only fires once a day, so use a free external scheduler such as
[cron-job.org](https://cron-job.org) with:

```bash
curl -X POST https://<your-app>.vercel.app/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

**Recommended interval: every 2–3 minutes.** The free API only refreshes finished
results every few minutes, so polling faster just runs no-op syncs — there's no
upside below ~1 minute.

## What it writes

- **Group results** — maps API team names to the canonical 48, finds the seeded
  fixture, and writes the score **only if that match isn't already logged**.
- **Knockout advancers** — the set of teams that reached each round (R32 → Final),
  plus the champion from the finished final. Knockouts are scored by advancement
  only, so it does **not** write knockout scorelines.

Any team name it can't confidently map is **skipped and reported**, never guessed.

## Reading the response

```json
{ "ok": true, "groupsApplied": 1,
  "advancersByRound": { "R32": 0, "R16": 0, "QF": 0, "SF": 0, "FINAL": 0, "CHAMPION": 0 },
  "skipped": [] }
```

- `groupsApplied: 0` is **normal** when nothing new has finished — not an error.
- A non-empty `skipped` means a name didn't resolve — add it to
  `lib/teamNameMap.ts` and re-run `npx tsx scripts/checkTeamMap.ts`.

## Verifying the team-name map

API spellings can drift between tournaments. Before relying on the sync, run:

```bash
FOOTBALL_DATA_API_KEY=... npx tsx scripts/checkTeamMap.ts
```

Exit 0 means all 48 canonical teams resolve cleanly.
