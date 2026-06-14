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
  created_at    timestamptz not null default now()
);
create unique index if not exists entries_username_lower_idx
  on entries (lower(username));

alter table entries
  add column if not exists password_hash text;


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
create or replace view leaderboard as
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
  from entries e
  left join predictions p on p.entry_id = e.id
  left join matches m     on m.id = p.match_id
  group by e.id
),

-- ── Dimension B: group standings, computed for actuals and per entry ─────────
-- A group is "complete" once all 6 of its matches have a logged result.
complete_groups as (
  select tg.group_letter
  from matches m
  join team_groups tg on tg.team = m.home_team
  where m.home_goals is not null and m.away_goals is not null
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
  from entries e
  left join pred_ranks pr            on pr.entry_id = e.id
  left join entry_group_eligible eg  on eg.entry_id = pr.entry_id and eg.group_letter = pr.group_letter
  left join actual_ranks ar          on ar.team = pr.team
  group by e.id
),

-- ── Dimensions C + D: knockout advancement (incl. CHAMPION, weight 12) ───────
knockout_raw as (
  select e.id as entry_id,
    coalesce(sum(case when aa.team is not null then rw.weight else 0 end), 0) as knockout_points
  from entries e
  left join advancement_predictions ap on ap.entry_id = e.id
  left join actual_advancers aa
         on aa.round = ap.round and aa.team = ap.team
        and e.created_at < aa.logged_at
  left join round_weights rw on rw.round = ap.round
  group by e.id
),
-- Champion pick (for display) and whether it was correct (a tiebreak metric),
-- under the same "logged after submission" fairness gate as the bonus.
champ as (
  select e.id as entry_id,
    cp.team as champion_pick,
    coalesce(max(case when ca.team is not null then 1 else 0 end), 0) as champion_correct
  from entries e
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
    kr.knockout_points                                    as knockout_points,
    gr.n_exact                                            as exact_count,
    champ.champion_correct                                as champion_correct,
    e.created_at                                          as created_at
  from entries e
  cross join w
  join group_raw    gr on gr.entry_id = e.id
  join ranking_raw  rr on rr.entry_id = e.id
  join knockout_raw kr on kr.entry_id = e.id
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
from scored
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

create or replace function create_entry(
  p_username      text,
  p_password_hash text,
  p_predictions   jsonb,
  p_advancers     jsonb
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
  insert into entries (username, password_hash)
  values (p_username, p_password_hash)
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
-- workbook (POST /api/admin/upload-results). Updates all provided group scores
-- and replaces every round's actual_advancers, atomically.
--   p_results    jsonb  [{ "match_no": int, "home_goals": int, "away_goals": int }, ...]
--   p_advancers  jsonb  { "R32":[...], ..., "FINAL":[...], "CHAMPION": "<team>" }
create or replace function apply_master_results(
  p_results   jsonb,
  p_advancers jsonb
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
end;
$$;
