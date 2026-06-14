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
  constraint matches_match_no_range check (match_no between 1 and 72),
  constraint matches_goals_nonneg   check (
    (home_goals is null or home_goals >= 0) and
    (away_goals is null or away_goals >= 0)
  )
);


-- -----------------------------------------------------------------------------
-- 2. entries — one row per submitted prediction sheet.
--    Usernames are unique case-insensitively (one upload per username, immutable).
-- -----------------------------------------------------------------------------
create table if not exists entries (
  id         serial primary key,
  username   text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists entries_username_lower_idx
  on entries (lower(username));


-- -----------------------------------------------------------------------------
-- 3. predictions — a user's 72 group scorelines (one row per group match).
-- -----------------------------------------------------------------------------
create table if not exists predictions (
  id        serial primary key,
  entry_id  int not null references entries(id) on delete cascade,
  match_id  int not null references matches(id),
  pred_home int not null,
  pred_away int not null,
  unique (entry_id, match_id),
  constraint predictions_scores_nonneg check (pred_home >= 0 and pred_away >= 0)
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
  primary key (round, team),
  constraint actual_advancers_round_valid
    check (round in ('R32', 'R16', 'QF', 'SF', 'FINAL', 'CHAMPION'))
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


-- =============================================================================
-- leaderboard VIEW — group points + advancement bonus, computed live (§S3/§S5).
-- =============================================================================
-- Per group match WITH a logged actual result (both goals non-null):
--     exact scoreline                  -> 3 pts
--     correct W/D/L result (not exact) -> 1 pt   (compare sign of goal diff)
--     otherwise                        -> 0 pts
-- A draw is the sign(0) = sign(0) case, so it is handled by the same rule.
--
-- Advancement bonus: for each round, award round_weights.weight per team the
-- user correctly predicted to reach that round (the intersection of their
-- advancement_predictions with actual_advancers).
--
-- exact_count is the tiebreak metric (number of exact group scorelines).
-- Ordering: total desc, exact_count desc, created_at asc.
-- LEFT JOINs from `entries` ensure a brand-new entry with no scored data yet
-- still appears with zeros, and an empty `entries` table yields zero rows.
-- -----------------------------------------------------------------------------
create or replace view leaderboard as
with group_scores as (
  select
    e.id as entry_id,
    coalesce(sum(
      case
        when m.home_goals is null or m.away_goals is null then 0
        when p.pred_home = m.home_goals and p.pred_away = m.away_goals then 3
        when sign(p.pred_home - p.pred_away) = sign(m.home_goals - m.away_goals) then 1
        else 0
      end
    ), 0) as group_points,
    coalesce(sum(
      case
        when m.home_goals is not null and m.away_goals is not null
             and p.pred_home = m.home_goals and p.pred_away = m.away_goals then 1
        else 0
      end
    ), 0) as exact_count
  from entries e
  left join predictions p on p.entry_id = e.id
  left join matches m     on m.id = p.match_id
  group by e.id
),
bonus_scores as (
  select
    e.id as entry_id,
    coalesce(sum(
      case when aa.team is not null then rw.weight else 0 end
    ), 0) as bonus_points
  from entries e
  left join advancement_predictions ap on ap.entry_id = e.id
  left join actual_advancers aa
         on aa.round = ap.round and aa.team = ap.team
  left join round_weights rw on rw.round = ap.round
  group by e.id
)
select
  e.id                                        as entry_id,
  e.username                                  as username,
  gs.group_points                             as group_points,
  bs.bonus_points                             as bonus_points,
  gs.group_points + bs.bonus_points           as total,
  gs.exact_count                              as exact_count,
  e.created_at                                as created_at
from entries e
join group_scores gs on gs.entry_id = e.id
join bonus_scores bs on bs.entry_id = e.id
order by total desc, exact_count desc, created_at asc;


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
-- Returns the new entry id.
-- -----------------------------------------------------------------------------
create or replace function create_entry(
  p_username    text,
  p_predictions jsonb,
  p_advancers   jsonb
) returns int
language plpgsql
as $$
declare
  v_entry_id   int;
  v_round      text;
  v_pred_count int;
begin
  insert into entries (username) values (p_username) returning id into v_entry_id;

  -- 72 group predictions, joined to matches by match_no.
  insert into predictions (entry_id, match_id, pred_home, pred_away)
  select v_entry_id,
         m.id,
         (p->>'pred_home')::int,
         (p->>'pred_away')::int
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

  return v_entry_id;
end;
$$;
