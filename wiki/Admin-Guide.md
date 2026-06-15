# Admin Guide

If you run the pool, the `/admin` console is where you log results. The
leaderboard reflects everything you save **live**, on the next page load — there
is no recompute or redeploy step.

## Signing in

`/admin` is gated by the `ADMIN_PASSWORD` you set in the environment. A
successful login sets a signed, httpOnly session cookie (HMAC keyed by
`AUTH_SECRET`, 7-day expiry); every admin API verifies it server-side.

## Logging group results

**Group results** lists all 72 group games. Enter each game's score and Save —
results save per row. Clearing a score un-scores that match. As soon as both
goals of a match are set, dimension-A (group match) points apply on the next
read; once all six matches in a group are logged, dimension-B (group ranking)
kicks in.

## Logging advancers

**Advancement actuals** lets you tick the teams that reached each round (R32 →
R16 → QF → SF → Final → Champion). Each Save **replaces that round's set**, so to
correct a mistake just re-tick and Save. These drive the knockout/champion
scoring.

## Quick import (the accelerator)

Instead of entering everything by hand, **Quick import** lets you upload a filled
master *results* workbook. It runs the **same parser** used for player uploads
and sets all 72 group scores plus every round's advancers in one transaction.
Great for catching up after several matchdays at once.

## Other admin tools

| Tool | What it does |
|------|--------------|
| **Results auto-sync** | Trigger or configure the football-data.org sync — see [Results Auto-Sync](Results-Auto-Sync). |
| **Global start floor** | Set a global "ignore games before match N" cutoff, e.g. if the pool starts mid-tournament. |
| **Prediction validity** | Override the eligibility of an individual prediction (the fairness gate) when you need to. |
| **Create entry** | Create a player entry with a username/password directly (for participants who can't use Google sign-in). |
| **Moderation** | Moderate entries/usernames. |

## Fairness, briefly

The scoring engine only credits a prediction for a result that was logged
**after** the entry was submitted. That means you can safely add results as they
happen without advantaging people who joined late. See
[Scoring System](Scoring-System#fairness-gating-anti-cheat).

## A typical tournament

1. Before kickoff, participants submit entries at `/upload` or `/upload/manual`.
2. As games finish, open **Group results** and save scores (or let auto-sync do
   it). Tick **Advancement actuals** as teams progress.
3. Check the public leaderboard at `/` — it updates on every load.
