-- =============================================================================
-- World Cup 2026 Predictions — Database schema & live leaderboard
-- =============================================================================
-- Single migration. Paste this whole file into the Supabase SQL editor and run.
-- Implements PLAN.md §S4 (data model) and §S3/§S5 (scoring, computed live).
--
-- Design notes:
--   * All access is server-only via the service-role key (PLAN §S1), so there
--     is no RLS here — the anon/public role never reaches these tables.
--   * No scores are precomputed or stored. The `leaderboard` VIEW recomputes
--     every total on read, so logging a result or an advancer is immediately
--     reflected with no backfill step.
--   * Re-runnable: every object is created with `if not exists` / `create or
--     replace`, so running this file twice is safe.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. matches — the 72 group fixtures (seeded once) plus their actual results.
--    home_goals / away_goals stay NULL until the admin logs the real result;
--    a match with either goal NULL contributes 0 points (scored as "not played
--    yet"). Knockout matches are NOT stored here — knockouts are scored by
--    advancement only (see actual_advancers).
-- -----------------------------------------------------------------------------
create table if not exists matches (
  id         serial primary key,
  match_no   int unique not null,            -- 1..72 (group stage only)
  home_team  text not null,
  away_team  text not null,
  kickoff_at timestamptz,
  home_goals int,                            -- NULL until admin logs the result
  away_goals int,
  result_logged_at timestamptz,               -- when the admin saved this result
  constraint matches_match_no_range check (match_no between 1 and 72),
  constraint matches_goals_nonneg   check (
    (home_goals is null or home_goals >= 0) and
    (away_goals is null or away_goals >= 0)
  )
);

alter table matches
  add column if not exists result_logged_at timestamptz;


-- -----------------------------------------------------------------------------
-- 2. entries — one row per submitted prediction sheet.
--    Usernames are unique case-insensitively (one upload per username, immutable).
-- -----------------------------------------------------------------------------
create table if not exists entries (
  id            serial primary key,
  username      text not null,
  password_hash text,
  google_sub    text,
  google_email  text,
  google_linked_at timestamptz,
  is_hidden     boolean not null default false,
  hidden_at     timestamptz,
  -- Players may rename themselves up to 3 times; this counts the renames used.
  -- A case-only re-spelling of the current name does not consume a change.
  username_changes_used int not null default 0,
  created_at    timestamptz not null default now()
);
create unique index if not exists entries_username_lower_idx
  on entries (lower(username));

alter table entries
  add column if not exists password_hash text;
alter table entries
  add column if not exists google_sub text,
  add column if not exists google_email text,
  add column if not exists google_linked_at timestamptz;
alter table entries
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz;
alter table entries
  add column if not exists username_changes_used int not null default 0;
create unique index if not exists entries_google_sub_idx
  on entries (google_sub)
  where google_sub is not null;


-- -----------------------------------------------------------------------------
-- 2b. follows — user-to-user followers/following graph.
-- -----------------------------------------------------------------------------
create table if not exists follows (
  follower_id int not null references entries(id) on delete cascade,
  followed_id int not null references entries(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint no_self_follow check (follower_id <> followed_id)
);


-- -----------------------------------------------------------------------------
-- 2c. entry_drafts — work-in-progress manual predictions, before they become an
--     immutable entry. Keyed by the Google account (google_sub) so a user can
--     save progress and resume on any device by signing in with Google again.
--     A draft holds partial group scorelines and knockout winner picks as JSON;
--     it is deleted the moment the entry is finalized (see the manual submit
--     route). Never scored — purely a resumable scratchpad.
--       group_scores  { "<match_no 1..72>": { "h": int, "a": int }, ... }
--       ko_winners    { "<match_no 73..104>": "<team name>", ... }
-- -----------------------------------------------------------------------------
create table if not exists entry_drafts (
  google_sub   text primary key,
  google_email text,
  username     text,
  group_scores jsonb not null default '{}'::jsonb,
  ko_winners   jsonb not null default '{}'::jsonb,  -- legacy (winner-only drafts)
  ko_scores    jsonb not null default '{}'::jsonb,  -- { "<match_no>": { "h": int, "a": int, "pen": "<team>" } }
  updated_at   timestamptz not null default now()
);

alter table entry_drafts
  add column if not exists ko_scores jsonb not null default '{}'::jsonb;


-- -----------------------------------------------------------------------------
-- 3. predictions — a user's 72 group scorelines (one row per group match).
-- -----------------------------------------------------------------------------
create table if not exists predictions (
  id        serial primary key,
  entry_id  int not null references entries(id) on delete cascade,
  match_id  int not null references matches(id),
  pred_home int not null,
  pred_away int not null,
  is_score_eligible boolean not null default true,
  unique (entry_id, match_id),
  constraint predictions_scores_nonneg check (pred_home >= 0 and pred_away >= 0)
);

alter table predictions
  add column if not exists is_score_eligible boolean not null default true;


-- -----------------------------------------------------------------------------
-- 3b. knockout_predictions — a user's predicted scoreline for each knockout
--     match (73–102 and 104; the third-place playoff 103 is not scored). Unlike
--     group fixtures the two teams differ per entry (they come from each entry's
--     own bracket), so the teams are stored alongside the score. penalty_winner
--     is set only when the regulation score is level. is_score_eligible mirrors
--     the group rule (false if the match had already kicked off / been logged at
--     submit time). Scored like a group match, but only when the predicted
--     matchup equals the actual one (see the leaderboard's KO-scoreline axis).
-- -----------------------------------------------------------------------------
create table if not exists knockout_predictions (
  entry_id   int  not null references entries(id) on delete cascade,
  match_no   int  not null,
  home_team  text not null,
  away_team  text not null,
  pred_home  int  not null,
  pred_away  int  not null,
  penalty_winner text,
  is_score_eligible boolean not null default true,
  primary key (entry_id, match_no),
  constraint knockout_predictions_match_range check (match_no between 73 and 104),
  constraint knockout_predictions_scores_nonneg check (pred_home >= 0 and pred_away >= 0)
);


-- -----------------------------------------------------------------------------
-- 4. advancement_predictions — teams a user predicted to reach each round.
--    `round` is one of R32, R16, QF, SF, FINAL, CHAMPION. There is exactly one
--    CHAMPION row per entry; the other rounds hold many teams.
-- -----------------------------------------------------------------------------
create table if not exists advancement_predictions (
  entry_id int  not null references entries(id) on delete cascade,
  round    text not null,
  team     text not null,
  primary key (entry_id, round, team),
  constraint advancement_predictions_round_valid
    check (round in ('R32', 'R16', 'QF', 'SF', 'FINAL', 'CHAMPION'))
);


-- -----------------------------------------------------------------------------
-- 5. actual_advancers — admin-entered ground truth: which teams actually
--    reached each round. Scored against advancement_predictions.
-- -----------------------------------------------------------------------------
create table if not exists actual_advancers (
  round text not null,
  team  text not null,
  logged_at timestamptz not null default now(),
  primary key (round, team),
  constraint actual_advancers_round_valid
    check (round in ('R32', 'R16', 'QF', 'SF', 'FINAL', 'CHAMPION'))
);

alter table actual_advancers
  add column if not exists logged_at timestamptz not null default now();


-- -----------------------------------------------------------------------------
-- 5b. actual_knockout_matches — admin-entered ground truth for knockout
--     scorelines (73–102, 104). Teams are nullable until the matchup is known;
--     kickoff_at is seeded from the workbook for prediction eligibility. A
--     knockout_predictions row scores its scoreline only when its (home_team,
--     away_team) equals this row's actual teams. penalty_winner records the
--     shoot-out result on a level score.
-- -----------------------------------------------------------------------------
create table if not exists actual_knockout_matches (
  match_no   int primary key,
  home_team  text,
  away_team  text,
  home_goals int,
  away_goals int,
  penalty_winner text,
  kickoff_at timestamptz,
  result_logged_at timestamptz,
  constraint actual_knockout_matches_range check (match_no between 73 and 104),
  constraint actual_knockout_matches_goals_nonneg check (
    (home_goals is null or home_goals >= 0) and (away_goals is null or away_goals >= 0)
  )
);


-- -----------------------------------------------------------------------------
-- round_weights — the single source of truth for knockout point weights
--    (PLAN §S3). Tune freely here; the leaderboard view reads from this table,
--    so weights live in exactly one place.
-- -----------------------------------------------------------------------------
create table if not exists round_weights (
  round  text primary key,
  weight int  not null,
  constraint round_weights_round_valid
    check (round in ('R32', 'R16', 'QF', 'SF', 'FINAL', 'CHAMPION'))
);

insert into round_weights (round, weight) values
  ('R32',       1),
  ('R16',       2),
  ('QF',        4),
  ('SF',        6),
  ('FINAL',     8),
  ('CHAMPION', 12)
on conflict (round) do update set weight = excluded.weight;


-- -----------------------------------------------------------------------------
-- team_groups — static mapping of each of the 48 teams to its group A..L.
--    Seeded by scripts/seed.ts from the workbook's `Groups` sheet (alongside the
--    72 `matches`). Used only by the group-ranking dimension: standings are
--    computed per group, so the view must know each team's group. Team names are
--    canonical (identical to those in `matches`). If this table is empty the
--    ranking dimension simply contributes 0 — the view stays valid.
-- -----------------------------------------------------------------------------
create table if not exists team_groups (
  team         text primary key,
  group_letter text not null,
  constraint team_groups_letter_valid
    check (group_letter in ('A','B','C','D','E','F','G','H','I','J','K','L'))
);


-- -----------------------------------------------------------------------------
-- scoring_weights — tunable weights for the group-match (dimension A) and
--    group-ranking (dimension B) scoring. Knockout weights stay in
--    round_weights. One row per constant; the leaderboard view reads them, so
--    all weights live in SQL. See docs/SCORING_DESIGN.md for the full model.
--      W_OUTCOME        correct W/D/L result            (per match)
--      W_GOALDIFF       correct goal difference          (per match, on top)
--      W_TEAMGOALS      each team's exact goal count      (per team, ×0..2)
--      W_EXACT          perfect-scoreline bonus           (per match, on top)
--      W_RANK_EXACT     team finishes in its exact group position
--      W_RANK_ADJACENT  team finishes one position off
-- -----------------------------------------------------------------------------
create table if not exists scoring_weights (
  key   text primary key,
  value int  not null
);

insert into scoring_weights (key, value) values
  ('W_OUTCOME',       2),
  ('W_GOALDIFF',      1),
  ('W_TEAMGOALS',     1),
  ('W_EXACT',         3),
  ('W_RANK_EXACT',    3),
  ('W_RANK_ADJACENT', 1)
on conflict (key) do update set value = excluded.value;


-- =============================================================================
-- leaderboard VIEW — the four-dimension scoring model, computed live.
-- =============================================================================
-- Full model + rationale: docs/SCORING_DESIGN.md. Summary of the four buckets:
--
--   A. Group match (per match WITH a logged result, both goals non-null) — the
--      axes STACK, they are not mutually exclusive:
--        + W_OUTCOME    if correct W/D/L            (sign of goal diff)
--        + W_GOALDIFF   if correct margin
--        + W_TEAMGOALS  per team whose goals are exact (0, 1, or 2 of them)
--        + W_EXACT      if the whole scoreline is exact
--      Max per match with default weights = 2+1+2+3 = 8.
--
--   B. Group ranking (per team, only once a group's 6 matches are all logged):
--        + W_RANK_EXACT     if the team's predicted group position is exact
--        + W_RANK_ADJACENT  if it is one position off
--      Predicted positions are DERIVED from the entry's own 72 scorelines and
--      actual positions from the logged scores, using the SAME standings
--      tie-break (points, goal difference, goals for, team name). No extra
--      prediction input — this mirrors what the source workbook computes.
--
--   C. Knockout advancement (progressive) + D. Champion:
--        per round, award round_weights.weight per team correctly predicted to
--        reach that round (intersection of advancement_predictions and
--        actual_advancers). CHAMPION (weight 12) is the deepest such round.
--
-- Fairness gating (carried over from the original model, applied to every
-- dimension): a group match scores only if the prediction was eligible at
-- upload time (is_score_eligible) and the entry predates the result being
-- logged. A group's ranking scores for an entry only if ALL six of that group's
-- predictions were eligible (i.e. predicted blind). An advancer scores only if
-- it was logged after the entry was submitted.
--
-- exact_count (number of exact group scorelines) and champion_correct are
-- tiebreak metrics. Ordering: total desc, exact_count desc, champion_correct
-- desc, created_at asc.
-- LEFT JOINs from `entries` keep brand-new entries on the board with zeros; an
-- empty `entries` table yields zero rows.
-- -----------------------------------------------------------------------------
-- Scoring is parameterized by an optional group-match cutoff so the global
-- board and per-league boards share ONE implementation. compute_leaderboard()
-- holds the model; the `leaderboard` view calls it with no cutoff (every entry,
-- whole tournament) and league_leaderboard() calls it with a league's start
-- game. When p_cutoff_kickoff is non-null, dimension-A group-match points only
-- count matches whose chronological key (kickoff_at, match_no) is at/after the
-- cutoff, and a group's standings (dimension B) only score if ALL 6 of its
-- matches are at/after the cutoff. Knockout + champion (C/D) are never gated —
-- they always follow the group stage.
drop view if exists leaderboard;
drop function if exists league_leaderboard(int);
drop function if exists compute_leaderboard(timestamptz, int);
create or replace function compute_leaderboard(
  p_cutoff_kickoff  timestamptz default null,
  p_cutoff_match_no int         default null
)
returns table (
  entry_id         int,
  username         text,
  champion_pick    text,
  group_points     int,
  ranking_points   int,
  knockout_points  int,
  total            int,
  exact_count      int,
  champion_correct int,
  created_at       timestamptz
)
language sql
stable
as $$
with
-- Single-row pivot of the tunable group/ranking weights (defaults if a row is
-- somehow missing). Cross-joined into the final select, so weights apply in one
-- place and the per-axis CTEs only count occurrences.
w as (
  select
    coalesce(max(value) filter (where key = 'W_OUTCOME'),       2) as w_outcome,
    coalesce(max(value) filter (where key = 'W_GOALDIFF'),      1) as w_goaldiff,
    coalesce(max(value) filter (where key = 'W_TEAMGOALS'),     1) as w_teamgoals,
    coalesce(max(value) filter (where key = 'W_EXACT'),         3) as w_exact,
    coalesce(max(value) filter (where key = 'W_RANK_EXACT'),    3) as w_rank_exact,
    coalesce(max(value) filter (where key = 'W_RANK_ADJACENT'), 1) as w_rank_adjacent
  from scoring_weights
),
visible_entries as (
  select *
  from entries
  where coalesce(is_hidden, false) = false
),

-- ── Dimension A: count how many matches matched on each axis, per entry ──────
-- The fairness guard (result logged, eligible, entry predates logging) is the
-- same on every axis; weights are applied later in the final select.
group_raw as (
  select
    e.id as entry_id,
    coalesce(sum(case when m.home_goals is not null and m.away_goals is not null
                       and p.is_score_eligible is true
                       and (m.result_logged_at is null or e.created_at < m.result_logged_at)
                       and sign(p.pred_home - p.pred_away) = sign(m.home_goals - m.away_goals)
                      then 1 else 0 end), 0) as n_outcome,
    coalesce(sum(case when m.home_goals is not null and m.away_goals is not null
                       and p.is_score_eligible is true
                       and (m.result_logged_at is null or e.created_at < m.result_logged_at)
                       and (p.pred_home - p.pred_away) = (m.home_goals - m.away_goals)
                      then 1 else 0 end), 0) as n_goaldiff,
    coalesce(sum(case when m.home_goals is not null and m.away_goals is not null
                       and p.is_score_eligible is true
                       and (m.result_logged_at is null or e.created_at < m.result_logged_at)
                       and p.pred_home = m.home_goals
                      then 1 else 0 end)
           + sum(case when m.home_goals is not null and m.away_goals is not null
                       and p.is_score_eligible is true
                       and (m.result_logged_at is null or e.created_at < m.result_logged_at)
                       and p.pred_away = m.away_goals
                      then 1 else 0 end), 0) as n_teamgoals,
    coalesce(sum(case when m.home_goals is not null and m.away_goals is not null
                       and p.is_score_eligible is true
                       and (m.result_logged_at is null or e.created_at < m.result_logged_at)
                       and p.pred_home = m.home_goals and p.pred_away = m.away_goals
                      then 1 else 0 end), 0) as n_exact
  from visible_entries e
  left join predictions p on p.entry_id = e.id
  -- Apply the group-match cutoff here: matches before the league's start game
  -- are filtered out, so they left-join to NULL and the `home_goals is not null`
  -- guards above score them as 0. With no cutoff every match passes through.
  left join (
    select * from matches mm
    where p_cutoff_kickoff is null
       or (coalesce(mm.kickoff_at, 'infinity'::timestamptz), mm.match_no)
          >= (p_cutoff_kickoff, p_cutoff_match_no)
  ) m on m.id = p.match_id
  group by e.id
),

-- ── Dimension B: group standings, computed for actuals and per entry ─────────
-- A group is "complete" once all 6 of its matches have a logged result.
complete_groups as (
  select tg.group_letter
  from matches m
  join team_groups tg on tg.team = m.home_team
  where m.home_goals is not null and m.away_goals is not null
    -- Under a cutoff, a group only counts if ALL 6 of its games are at/after it
    -- (a group has exactly 6 matches, so requiring count(*) = 6 over the
    -- cutoff-filtered set enforces "the whole group started after the cutoff").
    and (p_cutoff_kickoff is null
         or (coalesce(m.kickoff_at, 'infinity'::timestamptz), m.match_no)
            >= (p_cutoff_kickoff, p_cutoff_match_no))
  group by tg.group_letter
  having count(*) = 6
),
-- Actual per-team points/GF/GA, restricted to completed groups. Each team gets
-- one row per result it appears in (home or away), then aggregated.
actual_team_stats as (
  select s.team, tg.group_letter,
         sum(s.pts) as pts, sum(s.gf) as gf, sum(s.ga) as ga
  from (
    select home_team as team,
           case when home_goals > away_goals then 3 when home_goals = away_goals then 1 else 0 end as pts,
           home_goals as gf, away_goals as ga
    from matches where home_goals is not null and away_goals is not null
    union all
    select away_team,
           case when away_goals > home_goals then 3 when away_goals = home_goals then 1 else 0 end,
           away_goals, home_goals
    from matches where home_goals is not null and away_goals is not null
  ) s
  join team_groups tg    on tg.team = s.team
  join complete_groups cg on cg.group_letter = tg.group_letter
  group by s.team, tg.group_letter
),
actual_ranks as (
  select team,
         row_number() over (partition by group_letter
                            order by pts desc, (gf - ga) desc, gf desc, team asc) as rank
  from actual_team_stats
),
-- Predicted per-team points/GF/GA, from each entry's own 72 scorelines.
pred_team_stats as (
  select s.entry_id, s.team, tg.group_letter,
         sum(s.pts) as pts, sum(s.gf) as gf, sum(s.ga) as ga
  from (
    select p.entry_id, m.home_team as team,
           case when p.pred_home > p.pred_away then 3 when p.pred_home = p.pred_away then 1 else 0 end as pts,
           p.pred_home as gf, p.pred_away as ga
    from predictions p join matches m on m.id = p.match_id
    union all
    select p.entry_id, m.away_team,
           case when p.pred_away > p.pred_home then 3 when p.pred_away = p.pred_home then 1 else 0 end,
           p.pred_away, p.pred_home
    from predictions p join matches m on m.id = p.match_id
  ) s
  join team_groups tg on tg.team = s.team
  group by s.entry_id, s.team, tg.group_letter
),
pred_ranks as (
  select entry_id, team, group_letter,
         row_number() over (partition by entry_id, group_letter
                            order by pts desc, (gf - ga) desc, gf desc, team asc) as rank
  from pred_team_stats
),
-- Fairness: an entry may only score a group's ranking if all six of its
-- predictions in that group were eligible (predicted before kickoff / logging).
entry_group_eligible as (
  select p.entry_id, tg.group_letter, bool_and(p.is_score_eligible) as all_eligible
  from predictions p
  join matches m      on m.id = p.match_id
  join team_groups tg on tg.team = m.home_team
  group by p.entry_id, tg.group_letter
),
ranking_raw as (
  select e.id as entry_id,
    coalesce(sum(case when eg.all_eligible and ar.rank is not null and pr.rank = ar.rank
                      then 1 else 0 end), 0) as n_rank_exact,
    coalesce(sum(case when eg.all_eligible and ar.rank is not null and abs(pr.rank - ar.rank) = 1
                      then 1 else 0 end), 0) as n_rank_adjacent
  from visible_entries e
  left join pred_ranks pr            on pr.entry_id = e.id
  left join entry_group_eligible eg  on eg.entry_id = pr.entry_id and eg.group_letter = pr.group_letter
  left join actual_ranks ar          on ar.team = pr.team
  group by e.id
),

-- ── Dimensions C + D: knockout advancement (incl. CHAMPION, weight 12) ───────
knockout_raw as (
  select e.id as entry_id,
    coalesce(sum(case when aa.team is not null then rw.weight else 0 end), 0) as knockout_points
  from visible_entries e
  left join advancement_predictions ap on ap.entry_id = e.id
  left join actual_advancers aa
         on aa.round = ap.round and aa.team = ap.team
        and e.created_at < aa.logged_at
  left join round_weights rw on rw.round = ap.round
  group by e.id
),
-- ── Dimension E: knockout scorelines (scored exactly like a group match) ─────
-- Same stacking axes/weights as dimension A, but a knockout scoreline only
-- scores when the predicted matchup (home_team, away_team) equals the actual
-- one — comparing scores across different matchups would be meaningless. Never
-- gated by the league cutoff (knockouts always follow the group stage). The
-- third-place game (103) is not stored, so it never scores.
ko_score_raw as (
  select e.id as entry_id,
    coalesce(sum(case when akm.home_goals is not null and akm.away_goals is not null
                       and kp.is_score_eligible is true
                       and (akm.result_logged_at is null or e.created_at < akm.result_logged_at)
                       and kp.home_team = akm.home_team and kp.away_team = akm.away_team
                       and sign(kp.pred_home - kp.pred_away) = sign(akm.home_goals - akm.away_goals)
                      then 1 else 0 end), 0) as n_ko_outcome,
    coalesce(sum(case when akm.home_goals is not null and akm.away_goals is not null
                       and kp.is_score_eligible is true
                       and (akm.result_logged_at is null or e.created_at < akm.result_logged_at)
                       and kp.home_team = akm.home_team and kp.away_team = akm.away_team
                       and (kp.pred_home - kp.pred_away) = (akm.home_goals - akm.away_goals)
                      then 1 else 0 end), 0) as n_ko_goaldiff,
    coalesce(sum(case when akm.home_goals is not null and akm.away_goals is not null
                       and kp.is_score_eligible is true
                       and (akm.result_logged_at is null or e.created_at < akm.result_logged_at)
                       and kp.home_team = akm.home_team and kp.away_team = akm.away_team
                       and kp.pred_home = akm.home_goals
                      then 1 else 0 end)
           + sum(case when akm.home_goals is not null and akm.away_goals is not null
                       and kp.is_score_eligible is true
                       and (akm.result_logged_at is null or e.created_at < akm.result_logged_at)
                       and kp.home_team = akm.home_team and kp.away_team = akm.away_team
                       and kp.pred_away = akm.away_goals
                      then 1 else 0 end), 0) as n_ko_teamgoals,
    coalesce(sum(case when akm.home_goals is not null and akm.away_goals is not null
                       and kp.is_score_eligible is true
                       and (akm.result_logged_at is null or e.created_at < akm.result_logged_at)
                       and kp.home_team = akm.home_team and kp.away_team = akm.away_team
                       and kp.pred_home = akm.home_goals and kp.pred_away = akm.away_goals
                      then 1 else 0 end), 0) as n_ko_exact
  from visible_entries e
  left join knockout_predictions kp on kp.entry_id = e.id
  left join actual_knockout_matches akm on akm.match_no = kp.match_no
  group by e.id
),
-- Champion pick (for display) and whether it was correct (a tiebreak metric),
-- under the same "logged after submission" fairness gate as the bonus.
champ as (
  select e.id as entry_id,
    cp.team as champion_pick,
    coalesce(max(case when ca.team is not null then 1 else 0 end), 0) as champion_correct
  from visible_entries e
  left join advancement_predictions cp on cp.entry_id = e.id and cp.round = 'CHAMPION'
  left join actual_advancers ca
         on ca.round = 'CHAMPION' and ca.team = cp.team and e.created_at < ca.logged_at
  group by e.id, cp.team
),

scored as (
  select
    e.id                                                  as entry_id,
    e.username                                            as username,
    champ.champion_pick                                   as champion_pick,
    gr.n_outcome  * w.w_outcome
      + gr.n_goaldiff  * w.w_goaldiff
      + gr.n_teamgoals * w.w_teamgoals
      + gr.n_exact     * w.w_exact                        as group_points,
    rr.n_rank_exact * w.w_rank_exact
      + rr.n_rank_adjacent * w.w_rank_adjacent            as ranking_points,
    kr.knockout_points
      + ko.n_ko_outcome   * w.w_outcome
      + ko.n_ko_goaldiff  * w.w_goaldiff
      + ko.n_ko_teamgoals * w.w_teamgoals
      + ko.n_ko_exact     * w.w_exact                     as knockout_points,
    gr.n_exact                                            as exact_count,
    champ.champion_correct                                as champion_correct,
    e.created_at                                          as created_at
  from visible_entries e
  cross join w
  join group_raw    gr on gr.entry_id = e.id
  join ranking_raw  rr on rr.entry_id = e.id
  join knockout_raw kr on kr.entry_id = e.id
  join ko_score_raw ko on ko.entry_id = e.id
  join champ           on champ.entry_id = e.id
)
select
  entry_id,
  username,
  champion_pick,
  group_points,
  ranking_points,
  knockout_points,
  group_points + ranking_points + knockout_points        as total,
  exact_count,
  champion_correct,
  created_at
from scored;
$$;


-- The global leaderboard: the same scoring with no cutoff, every entry. Kept as
-- a view so existing `.from("leaderboard")` queries are unchanged.
create or replace view leaderboard as
  select * from compute_leaderboard(null, null)
  order by total desc, exact_count desc, champion_correct desc, created_at asc;


-- =============================================================================
-- create_entry() — atomic upload insert (used by POST /api/upload).
-- =============================================================================
-- Inserts one entry, its 72 group predictions, and all advancement_predictions
-- in a single transaction. Either the whole submission lands or none of it does
-- (no half-written entry on error). One upload per username is enforced by the
-- case-insensitive unique index on entries.username — a duplicate raises a
-- unique_violation (SQLSTATE 23505) that the route maps to a friendly message.
--
-- Parameters:
--   p_username     text
--   p_predictions  jsonb  [{ "match_no": int, "pred_home": int, "pred_away": int }, ...]
--   p_advancers    jsonb  { "R32":[...], "R16":[...], "QF":[...], "SF":[...],
--                           "FINAL":[...], "CHAMPION": "<team>" }
-- Returns a JSON summary with the new entry id and the number of group
-- predictions ineligible because their match had already kicked off or had
-- already been logged when the upload arrived.
-- -----------------------------------------------------------------------------
drop function if exists create_entry(text, jsonb, jsonb);
drop function if exists create_entry(text, text, jsonb, jsonb);
drop function if exists create_entry(text, text, jsonb, jsonb, text, text);
drop function if exists create_entry(text, text, jsonb, jsonb, text, text, jsonb);

create or replace function create_entry(
  p_username      text,
  p_password_hash text,
  p_predictions   jsonb,
  p_advancers     jsonb,
  p_google_sub    text default null,
  p_google_email  text default null,
  p_knockout      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_entry_id   int;
  v_uploaded_at timestamptz;
  v_round      text;
  v_pred_count int;
  v_late_count int;
begin
  insert into entries (username, password_hash, google_sub, google_email, google_linked_at)
  values (
    p_username,
    p_password_hash,
    nullif(p_google_sub, ''),
    nullif(p_google_email, ''),
    case when nullif(p_google_sub, '') is not null then now() else null end
  )
  returning id, created_at into v_entry_id, v_uploaded_at;

  -- 72 group predictions, joined to matches by match_no.
  insert into predictions (entry_id, match_id, pred_home, pred_away, is_score_eligible)
  select v_entry_id,
         m.id,
         (p->>'pred_home')::int,
         (p->>'pred_away')::int,
         not (
           (m.kickoff_at is not null and m.kickoff_at <= v_uploaded_at)
           or (m.result_logged_at is not null)
           or (m.home_goals is not null and m.away_goals is not null)
         )
  from jsonb_array_elements(p_predictions) as p
  join matches m on m.match_no = (p->>'match_no')::int;

  -- Guard: every prediction must have matched a seeded fixture.
  select count(*) into v_pred_count from predictions where entry_id = v_entry_id;
  if v_pred_count <> 72 then
    raise exception 'expected 72 predictions but inserted % — is the matches table seeded?', v_pred_count;
  end if;

  -- Multi-team rounds.
  foreach v_round in array array['R32','R16','QF','SF','FINAL'] loop
    insert into advancement_predictions (entry_id, round, team)
    select v_entry_id, v_round, t.team
    from jsonb_array_elements_text(p_advancers->v_round) as t(team);
  end loop;

  -- Champion (single team).
  insert into advancement_predictions (entry_id, round, team)
  values (v_entry_id, 'CHAMPION', p_advancers->>'CHAMPION');

  -- Knockout scorelines (matches 73–102, 104). Eligibility mirrors the group
  -- rule, judged against actual_knockout_matches kickoff/result if seeded.
  insert into knockout_predictions
    (entry_id, match_no, home_team, away_team, pred_home, pred_away, penalty_winner, is_score_eligible)
  select v_entry_id,
         (k->>'match_no')::int,
         k->>'home_team',
         k->>'away_team',
         (k->>'pred_home')::int,
         (k->>'pred_away')::int,
         nullif(k->>'penalty_winner', ''),
         not coalesce(
           (akm.kickoff_at is not null and akm.kickoff_at <= v_uploaded_at)
           or (akm.result_logged_at is not null)
           or (akm.home_goals is not null and akm.away_goals is not null),
           false)
  from jsonb_array_elements(p_knockout) as k
  left join actual_knockout_matches akm on akm.match_no = (k->>'match_no')::int;

  select count(*) into v_late_count
  from predictions
  where entry_id = v_entry_id and is_score_eligible is not true;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'late_prediction_count', v_late_count
  );
end;
$$;


-- =============================================================================
-- Admin write helpers (used by the cookie-protected /api/admin routes).
-- =============================================================================

-- replace_actual_advancers() — atomically replace the set of teams that
-- actually reached a round (POST /api/admin/advancers). Deletes the round's
-- current rows and inserts the new set in one transaction.
create or replace function replace_actual_advancers(
  p_round text,
  p_teams text[]
) returns void
language plpgsql
as $$
begin
  if p_round not in ('R32','R16','QF','SF','FINAL','CHAMPION') then
    raise exception 'invalid round: %', p_round;
  end if;
  delete from actual_advancers where round = p_round;
  insert into actual_advancers (round, team, logged_at)
  select p_round, t.team, now() from unnest(p_teams) as t(team);
end;
$$;

-- apply_master_results() — one-shot import from the admin's filled master
-- workbook (POST /api/admin/upload-results). Updates all provided group scores,
-- replaces every round's actual_advancers, and upserts actual knockout
-- scorelines, atomically.
--   p_results    jsonb  [{ "match_no": int, "home_goals": int, "away_goals": int }, ...]
--   p_advancers  jsonb  { "R32":[...], ..., "FINAL":[...], "CHAMPION": "<team>" }
--   p_knockout   jsonb  [{ "match_no": int, "home_team": text, "away_team": text,
--                          "pred_home": int, "pred_away": int, "penalty_winner": text|null }, ...]
--                       (parseWorkbook's knockoutPredictions shape; here pred_* are the actuals)
drop function if exists apply_master_results(jsonb, jsonb);
drop function if exists apply_master_results(jsonb, jsonb, jsonb);
create or replace function apply_master_results(
  p_results   jsonb,
  p_advancers jsonb,
  p_knockout  jsonb default '[]'::jsonb
) returns void
language plpgsql
as $$
declare
  v_round text;
begin
  -- Group actual scores.
  update matches m
     set home_goals = (r->>'home_goals')::int,
         away_goals = (r->>'away_goals')::int,
         result_logged_at = now()
  from jsonb_array_elements(p_results) as r
  where m.match_no = (r->>'match_no')::int;

  -- Replace every round's advancers.
  delete from actual_advancers;
  foreach v_round in array array['R32','R16','QF','SF','FINAL'] loop
    insert into actual_advancers (round, team, logged_at)
    select v_round, t.team, now()
    from jsonb_array_elements_text(p_advancers->v_round) as t(team);
  end loop;
  insert into actual_advancers (round, team, logged_at)
  values ('CHAMPION', p_advancers->>'CHAMPION', now());

  -- Actual knockout scorelines (matches 73–102, 104).
  insert into actual_knockout_matches
    (match_no, home_team, away_team, home_goals, away_goals, penalty_winner, result_logged_at)
  select (k->>'match_no')::int,
         k->>'home_team',
         k->>'away_team',
         (k->>'pred_home')::int,
         (k->>'pred_away')::int,
         nullif(k->>'penalty_winner', ''),
         now()
  from jsonb_array_elements(p_knockout) as k
  on conflict (match_no) do update set
    home_team = excluded.home_team,
    away_team = excluded.away_team,
    home_goals = excluded.home_goals,
    away_goals = excluded.away_goals,
    penalty_winner = excluded.penalty_winner,
    result_logged_at = now();
end;
$$;


-- =============================================================================
-- Leagues — private/public mini-competitions over a subset of entries.
-- =============================================================================
-- A league is just a named group of entries. Its leaderboard is the shared
-- scoring (compute_leaderboard) restricted to active members and the league's
-- optional start game — weights stay global. Access is server-only (no RLS),
-- same as every other table here.
--
--   visibility  'public'  → listed in the directory and self-joinable
--               'private' → not listed; reachable only via its join_code link
--   join_policy 'open'    → joining (directory or code) makes you active at once
--               'approval'→ joining creates a 'pending' request the owner OKs
--   start_match_id NULL   → score the whole tournament (like the global board)
--                  set     → group-match points only count from that game onward
--                            (chronologically); knockouts always count. Chosen
--                            once at creation, immutable.
-- Public leagues are forced to join_policy='open' by the create route, so the
-- directory always means one-click join.
-- -----------------------------------------------------------------------------
create table if not exists leagues (
  id          serial primary key,
  name        text not null,
  slug        text unique not null,            -- URL key: slug(name) + random suffix
  visibility  text not null default 'private'
              check (visibility in ('public', 'private')),
  join_policy text not null default 'approval'
              check (join_policy in ('open', 'approval')),
  join_code   text unique not null,            -- shareable link token (public & private)
  owner_id    int  not null references entries(id) on delete cascade,
  start_match_id int references matches(id),    -- NULL = whole tournament
  is_hidden   boolean not null default false,
  hidden_at   timestamptz,
  created_at  timestamptz not null default now(),
  constraint leagues_name_len check (char_length(name) between 1 and 60)
);

alter table leagues
  add column if not exists start_match_id int references matches(id);
alter table leagues
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz;


-- -----------------------------------------------------------------------------
-- league_members — membership of an entry in a league.
--   role   'owner' | 'member'   (the creator is the sole owner)
--   status 'active' | 'pending' (pending = awaiting owner approval)
-- The owner is also stored here as an active 'owner' row so member/board
-- queries are uniform; leagues.owner_id remains the authoritative owner.
-- -----------------------------------------------------------------------------
create table if not exists league_members (
  league_id int  not null references leagues(id)  on delete cascade,
  entry_id  int  not null references entries(id)  on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  status    text not null default 'active'  check (status in ('active', 'pending')),
  joined_at timestamptz not null default now(),
  primary key (league_id, entry_id)
);
create index if not exists league_members_entry_idx on league_members (entry_id);


-- -----------------------------------------------------------------------------
-- league_leaderboard() — a league's board: the shared scoring restricted to the
-- league's active members and computed from the league's start game onward.
-- When start_match_id is NULL the left join yields NULLs, so compute_leaderboard
-- runs with no cutoff (whole tournament). Called via RPC from the league page.
-- -----------------------------------------------------------------------------
drop function if exists league_leaderboard(int);
create or replace function league_leaderboard(p_league_id int)
returns table (
  entry_id         int,
  username         text,
  champion_pick    text,
  group_points     int,
  ranking_points   int,
  knockout_points  int,
  total            int,
  exact_count      int,
  champion_correct int,
  created_at       timestamptz
)
language sql
stable
as $$
  select cl.*
  from leagues l
  left join matches sm on sm.id = l.start_match_id
  cross join lateral compute_leaderboard(sm.kickoff_at, sm.match_no) cl
  join league_members lm
    on lm.entry_id = cl.entry_id
   and lm.league_id = l.id
   and lm.status = 'active'
  where l.id = p_league_id
    and coalesce(l.is_hidden, false) = false
  order by cl.total desc, cl.exact_count desc, cl.champion_correct desc,
           cl.created_at asc;
$$;
