# FAQ

### Can I change my prediction after submitting?

No. Each entry is **immutable** and there's **one entry per username**
(case-insensitive). Decide before you submit.

### Why does upload say "open the file in Excel and save it once"?

The workbook computes knockout team names with formulas, and the parser reads the
last *cached* values of those formulas. If you edited the file but never let it
recalculate, the knockout cells are blank. Open it in Excel/LibreOffice, let it
recalc, save, and re-upload. See [Making Predictions](Making-Predictions).

### Do I have to use the Excel file?

No — there's a guided in-app stepper at `/upload/manual` that builds the bracket
for you. See [Making Predictions](Making-Predictions#option-b--manual-entry-in-the-app).

### How are knockout rounds scored — by the score or who wins?

By **advancement only**, never by the knockout scoreline. You earn a round's
weight for each team you correctly predicted to reach it, cumulatively as they
progress. See [Scoring System](Scoring-System#c--d--knockout--champion-advancement-only).

### Can someone who joins late cheat by predicting games already played?

No. **Fairness gating** means a prediction only scores a result that was logged
*after* the entry was submitted, and predictions for matches that had already
kicked off are marked ineligible at entry time. See
[Scoring System](Scoring-System#fairness-gating-anti-cheat).

### What's the group standings tie-break?

**Points → goal difference → goals for → team name.** It's fully deterministic
and deliberately *not* FIFA's head-to-head/fair-play rule, so the app and the
leaderboard always agree. In a few exactly-tied groups this can order teams
differently from the workbook, but the same teams advance.

### Can I run more than one competition / pool?

Yes — create **leagues** (public or private with an invite code), each with its
own leaderboard and an optional "ignore games before match N" start cutoff. See
[Leagues & Social](Leagues-and-Social).

### Do I need the football-data.org sync?

No. It's optional — without it, an admin logs results by hand (or via the
master-results upload) at `/admin`. With it, results update automatically. See
[Results Auto-Sync](Results-Auto-Sync).

### Why is `groupsApplied: 0` coming back from the sync?

That's normal when nothing new has finished since the last run — it is **not** an
error.

### Is my data safe? How are secrets handled?

All database access is **server-only** through a service-role key that never
reaches the browser. Sessions are signed, httpOnly cookies. Secrets live in
environment variables (`.env.local` locally, never committed). See
[Architecture Overview](Architecture-Overview#the-one-rule-supabase-is-server-only).

### What's the license? Can I reuse the code?

The source code is **MIT-licensed** — reuse freely with attribution. The bundled
`WCup_2026_4.2.7_en.xlsx` workbook is a **third-party work by Hermann Baum** and
is **not** covered by the MIT license; see
[`NOTICE.md`](https://github.com/AlperenTurkmen/world_cup_prediction/blob/main/NOTICE.md).
