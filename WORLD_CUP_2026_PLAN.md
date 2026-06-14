# World Cup Predictions Leaderboard — Build Spec & Claude Code Prompts

Save this file as `PLAN.md` in the repo root and **attach it to your Claude Code session**. Each phase prompt at the bottom references the spec sections here, so paste them one at a time in order.

---

## Spec

### S1. Stack & environment
- **Next.js (App Router) + TypeScript + Tailwind**, deployed on **Vercel (Hobby)**.
- **Supabase (Postgres)**, accessed **only from server code** with the service-role key. The client never talks to Supabase directly, so no RLS work is needed.
- Excel parsing with **SheetJS (`xlsx`)** in a server route.
- Env vars (Vercel + `.env.local`):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`  *(server only — never imported into a Client Component)*
  - `ADMIN_PASSWORD`
  - `AUTH_SECRET`  *(random string, used to sign the admin cookie)*

### S2. The template (critical — read before the parser phase)
Users upload a filled copy of the **Hermann Baum "WCup_2026" workbook (v4.2.7)** — a self-calculating bracket, *not* a flat table. Two sheets matter:

- **`Matches`** — canonical fixture list. Row 4 onward: `B`=Match No. (1–104), `I`=Team 1, `J`=Team 2. Group matches are No. **1–72** (fixed teams, identical for everyone).
- **`World Cup`** — where the user types scores and where the bracket auto-computes knockout teams.

**Anchor-scan parsing (verified against the sample file):** scan the `World Cup` sheet for any cell whose value is an integer **1–104** — that's a match anchor at `(r, c)`. Then:

| Match no. | Round | Team 1 cell | Team 2 cell | Score cells (home / away) |
|---|---|---|---|---|
| 1–72 | Group | `(r+2, c+1)` | `(r+2, c+2)` | `(r+3, c+1)` / `(r+3, c+2)` |
| 73–88 | Round of 32 | `(r+2, c+1)` | `(r+2, c+2)` | — (not scored) |
| 89–96 | Round of 16 | `(r+2, c+1)` | `(r+2, c+2)` | — |
| 97–100 | Quarter-final | `(r+2, c+1)` | `(r+2, **c+3**)` | — |
| 101–102 | Semi-final | `(r+2, c+1)` | `(r+2, **c+3**)` | — |
| 103 | Third place | `(r+2, c+1)` | `(r+2, **c+3**)` | — |
| 104 | Final | `(r+2, c+1)` | `(r+2, **c+3**)` | — |
| Champion | — | team at `(r+2, **c+7**)` of match-104 anchor | | |

Note the **+1/+3 column offset** for QF and deeper (one empty column between the two teams), versus **+1/+2** for groups, R32, R16.

**Validation the parser must pass on the sample file:**
- 72 group matches parsed; their team names exactly equal the `Matches` sheet canonical pairs.
- Predicted advancers per round count **R32=32, R16=16, QF=8, SF=4, Final=2, Champion=1**.
- Sample file's champion parses as **"Spain"** (it's a fully-simulated example — ideal as a fixture).

**Two parsing cautions:**
1. **Cached values:** SheetJS reads the last-saved computed values. Knockout team names are Excel formulas, so a file that was never opened/recalced in Excel/LibreOffice may have blanks. If knockout cells are empty, reject the upload with: *"Please open the file in Excel and save it once, then re-upload."*
2. **Team-name normalization:** names must match exactly across prediction parse, `Matches` sheet, and admin actuals (e.g. `Bosnia/Herzeg.`, `Rep. of Korea`, `IR Iran`, `Curaçao`). Build a **canonical 48-team list** from the `Matches` sheet (unique teams across matches 1–72) and validate every parsed/entered name against it.

### S3. Scoring model
**Group stage (matches 1–72), per match with a logged actual result:**
- Exact score → **3 pts**
- Correct result (W/D/L) but not exact → **1 pt**
- Otherwise → **0**

**Knockout advancement bonus** — for each round, award points per team the user correctly predicted to reach that round (intersection of their predicted advancers with the actual advancers). Default weights (single config constant, tune freely):

| Round | Pts per correct team |
|---|---|
| Reached Round of 32 | 1 |
| Reached Round of 16 | 2 |
| Reached Quarter-final | 4 |
| Reached Semi-final | 6 |
| Reached Final | 8 |
| Champion (correct) | 12 |

**Total = group points + advancement bonus.** Tiebreakers: total → number of exact group scorelines → earliest submission.

### S4. Data model (Postgres)
```sql
create table matches (              -- 72 group fixtures (seeded) + actual results
  id         serial primary key,
  match_no   int unique not null,   -- 1..72
  home_team  text not null,
  away_team  text not null,
  kickoff_at timestamptz,
  home_goals int,                   -- null until admin logs it
  away_goals int
);

create table entries (
  id         serial primary key,
  username   text not null,
  created_at timestamptz default now()
);
create unique index entries_username_lower_idx on entries (lower(username));

create table predictions (          -- a user's 72 group scorelines
  id        serial primary key,
  entry_id  int references entries(id) on delete cascade,
  match_id  int references matches(id),
  pred_home int not null,
  pred_away int not null,
  unique (entry_id, match_id)
);

create table advancement_predictions (   -- teams a user predicted to reach each round
  entry_id int references entries(id) on delete cascade,
  round    text not null,                -- 'R32','R16','QF','SF','FINAL','CHAMPION'
  team     text not null,
  primary key (entry_id, round, team)
);

create table actual_advancers (          -- admin-entered ground truth
  round text not null,
  team  text not null,
  primary key (round, team)
);
```

### S5. Leaderboard SQL (group points + bonus, computed live)
Store the round weights in one place (a SQL `values` CTE or a tiny `round_weights` table). The leaderboard view:
- group points: sum over `predictions ⋈ matches` (with results) of the 3/1/0 rule using `sign(pred_home-pred_away) = sign(home_goals-away_goals)` for the result case;
- bonus: sum over `advancement_predictions ⋈ actual_advancers` of `weight(round)`;
- `exact_count` for the tiebreak;
- order by `total desc, exact_count desc, created_at asc`.

---

## Phase prompts (paste into Claude Code, in order)

> Tip: keep each phase a separate Claude Code turn; commit after each. Repeat back to Claude Code at the start of any session: *"Read PLAN.md. Supabase is server-only; never import the service-role client into a Client Component."*

### Phase 0 — Scaffold (~0.5h)
```
Read PLAN.md §S1. Scaffold a Next.js (App Router) + TypeScript + Tailwind app for a
World Cup predictions leaderboard. Add the `xlsx` (SheetJS) and `@supabase/supabase-js`
packages. Create a server-only Supabase client at lib/supabaseAdmin.ts that reads
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (throw if missing). Add a .env.example listing
all four env vars from §S1. Create empty routes: / , /upload , /admin. Confirm `npm run dev`
builds with no type errors. Do NOT add any client-side Supabase usage.
```
**Done when:** app boots, three routes render placeholders, `lib/supabaseAdmin.ts` is server-only.

### Phase 1 — Database (~1h)
```
Read PLAN.md §S4 and §S5. Produce a single SQL migration file (db/schema.sql) creating all
five tables exactly as in §S4, plus a `leaderboard` VIEW implementing §S3 + §S5:
- group points: 3 for exact, 1 for correct result (use sign() of goal difference; draws score 1),
  0 otherwise, only for matches where home_goals and away_goals are not null;
- advancement bonus: per round weights R32=1, R16=2, QF=4, SF=6, FINAL=8, CHAMPION=12,
  summed over the intersection of advancement_predictions and actual_advancers;
- columns: entry_id, username, group_points, bonus_points, total, exact_count, created_at;
- ORDER BY total desc, exact_count desc, created_at asc.
Give me the SQL to run in the Supabase SQL editor, and a short note on how to verify the view
returns zero rows cleanly before any data exists.
```
**Done when:** schema + view run in Supabase with no errors; view selectable.

### Phase 2 — Parser + seed (~2h) ⟵ the core
```
Read PLAN.md §S2 carefully. Implement lib/parseWorkbook.ts using SheetJS that takes an xlsx
ArrayBuffer and returns:
{ groupPredictions: {matchNo, team1, team2, predHome, predAway}[],   // 72 rows
  advancers: { R32:string[], R16:string[], QF:string[], SF:string[], FINAL:string[], CHAMPION:string } }

Use the anchor-scan algorithm and the exact cell offsets in the §S2 table (note +1/+3 for QF and
deeper, +1/+2 for groups/R32/R16, and champion at +7 from the match-104 anchor). Read cached cell
values. Normalize/validate every team name against a canonical 48-team list built from the
`Matches` sheet (matches 1–72, cols I/J). Throw descriptive errors when: knockout cells are blank
(tell the user to open+save the file in Excel), a score is non-integer/negative, a team name isn't
canonical, or round counts aren't 32/16/8/4/2/1.

Then write scripts/seed.ts that reads the master workbook and inserts the 72 group fixtures into
`matches` (match_no, home_team, away_team, kickoff_at from the Matches sheet).

Write a test that runs the parser against the provided sample file and asserts: 72 group rows,
round counts 32/16/8/4/2, champion === "Spain", and that group team names match the Matches sheet.
The sample file is at <path you place it>.
```
**Done when:** parser test passes on the sample; `seed.ts` populates 72 `matches` rows.

### Phase 3 — Upload flow (~2h)
```
Read PLAN.md §S2–S4. Build the /upload page (Client Component): a username text input, an
.xlsx file input, and a submit button (no <form> element — use onClick). It POSTs multipart
to /api/upload.

Implement POST /api/upload (server): validate the username is non-empty and not already taken
(case-insensitive), parse the file with lib/parseWorkbook.ts, then in one logical transaction
insert: one `entries` row, 72 `predictions` rows, and the `advancement_predictions` rows
(R32/R16/QF/SF/FINAL each team, plus one CHAMPION row). One upload per username — reject
duplicates with a clear message. Return a JSON summary (predictions saved, champion picked).
Surface all parser/validation errors to the user as readable messages. No Supabase calls from
the client.
```
**Done when:** uploading the sample as a username inserts 1 entry + 72 predictions + advancers; duplicate username and malformed files are rejected with clear messages.

### Phase 4 — Leaderboard page (~1.5h)
```
Read PLAN.md §S5. Build / as a Server Component that selects from the `leaderboard` view and
renders a clean, mobile-friendly table: rank, username, total, group points, bonus, exact-score
count. Show a friendly empty state when there are no entries, and a "results logged: X / 72 group
games" line plus a last-updated timestamp. Keep styling minimal and readable on a phone.
```
**Done when:** leaderboard renders ranked rows from real data; empty state works.

### Phase 5 — Admin results (~2h)
```
Read PLAN.md §S2–S4. Build admin auth + results entry.

Auth: /admin shows a password form if no valid cookie. POST /api/admin/login compares the
submitted password to ADMIN_PASSWORD (constant-time) and, on success, sets a signed httpOnly
cookie (HMAC with AUTH_SECRET, SameSite=Lax, Secure in prod). /admin and all admin APIs verify
this cookie server-side.

Results entry (two sections on /admin):
1. Group results — a table of all 72 matches with home/away number inputs and a Save per row;
   POST /api/admin/result updates matches.home_goals/away_goals by match_no.
2. Advancement actuals — for each round (R32,R16,QF,SF,FINAL,CHAMPION) let the admin record which
   teams actually reached it (multi-select / checklist from the canonical 48-team list), writing
   to actual_advancers; POST /api/admin/advancers replaces the set for a round.

Also add an OPTIONAL accelerator: an "upload master results workbook" button that runs the same
lib/parseWorkbook.ts on the admin's filled master copy and auto-populates BOTH the 72 group actual
scores AND actual_advancers for every round — so the admin can avoid manual entry. The manual
forms remain as the fallback. All admin routes are cookie-protected.
```
**Done when:** admin can log in, enter group scores and advancers (or upload a master file), and the leaderboard reflects changes on refresh.

### Phase 6 — Polish (~1h)
```
Tighten error and empty states across /upload, /, and /admin. Make all three pages look clean on
mobile. Add basic input guards (block negative/huge scores). Add a simple site header with links
to Leaderboard and Upload. No new features.
```
**Done when:** flows feel finished on a phone; errors are human-readable.

### Phase 7 — Deploy (~1h)
```
Deploy to Vercel. Set the four env vars from §S1 in the Vercel project. Run the schema migration
and seed (72 matches) against the production Supabase. Do a full smoke test: upload the sample as
"test_user", log a couple of group results and a few advancers in /admin, confirm the leaderboard
math (one exact group score = 3, one correct-result = 1, one correct finalist = 8). Give me the
final URL and a 5-line "how the admin uses it" note.
```
**Done when:** live URL works end-to-end and the scoring math checks out.

---

## Total: ~10h of focused work — comfortably inside 24h.

### Things already decided (so Claude Code doesn't re-ask)
- One upload per username, immutable; usernames unique case-insensitive.
- Knockouts scored by **advancement only** (per §S3 weights), never by knockout scoreline.
- Tiebreak: total → exact group scorelines → earliest submission.
- Admin enters group scores + advancers via form, with optional master-file upload as a shortcut.
- Free tier: Supabase free + Vercel Hobby are sufficient for a friends-sized pool.
