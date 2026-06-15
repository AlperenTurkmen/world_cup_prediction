# Making Predictions

There are two ways to enter your forecast. Both produce the **same entry** and
both are **immutable once submitted** — you get one entry per username, so make
it count.

## Option A — Upload the Excel workbook

1. Download the master
   [Hermann Baum "World Cup" workbook](https://hermann-baum.de/excel/WorldCup/de).
2. Fill in your predicted group-stage scorelines. The knockout bracket
   **calculates itself** from your group results and the winners you pick.
3. **Open and save the file in Excel or LibreOffice at least once.** This is
   required — the app reads the last computed values of the bracket formulas. A
   file that was edited but never recalculated will have blank knockout cells.
4. Go to `/upload`, enter your username, and upload the file.

> **"Open the file in Excel and save it once" error?** The knockout cells are
> blank because the spreadsheet's formulas were never recalculated. Open it,
> let it recalc, save, and re-upload.

### Why the open-and-save step matters

The workbook computes knockout team names with formulas. The parser reads the
**cached** values those formulas last produced, so the file must have been
recalculated (which happens when you open and save it) for the knockout picks to
come through.

## Option B — Manual entry in the app

Prefer not to wrangle a spreadsheet? Use the in-app stepper at `/upload/manual`:

1. It starts at the next match that hasn't kicked off. Past games are hidden and
   auto-filled 0–0 (they can't be predicted after the fact).
2. Enter each group-stage scoreline with the 0–4 tap rails or your keyboard.
3. The app **auto-derives the 32 Round-of-32 teams** from your predicted group
   standings — you don't re-enter them.
4. Tap the winner of each knockout tie, round by round, up to the champion.
5. Your progress **autosaves** and is resumable on any device you're signed in
   on. Finalizing submits the entry and clears the draft.

## What gets stored

Either way, your entry is:

- **72 group scorelines** — one per group-stage match.
- **Advancement picks** — which teams you think reach each round (R32 → R16 → QF
  → SF → Final → Champion).

Knockout scoring is by **advancement only**, never by the knockout scoreline —
so in manual entry you pick winners, not knockout scores.

## Group standings & tie-breaks

When the app derives your bracket (and when the leaderboard ranks groups), teams
are ordered by **points → goal difference → goals for → team name**. This is a
deliberate, fully deterministic rule and is *not* FIFA's head-to-head/fair-play
tiebreak. In a few groups with exact ties this can differ from the workbook's
own bracket, but the set of teams advancing is the same.

See [Scoring System](Scoring-System) for how each of these earns points.
