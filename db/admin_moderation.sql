-- =============================================================================
-- Migration: Admin moderation for users and leagues
-- Run this in the Supabase SQL Editor after the main schema already exists.
-- =============================================================================

alter table entries
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz;

alter table leagues
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz;

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
  left join (
    select * from matches mm
    where p_cutoff_kickoff is null
       or (coalesce(mm.kickoff_at, 'infinity'::timestamptz), mm.match_no)
          >= (p_cutoff_kickoff, p_cutoff_match_no)
  ) m on m.id = p.match_id
  group by e.id
),
complete_groups as (
  select tg.group_letter
  from matches m
  join team_groups tg on tg.team = m.home_team
  where m.home_goals is not null and m.away_goals is not null
    and (p_cutoff_kickoff is null
         or (coalesce(m.kickoff_at, 'infinity'::timestamptz), m.match_no)
            >= (p_cutoff_kickoff, p_cutoff_match_no))
  group by tg.group_letter
  having count(*) = 6
),
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
  join team_groups tg     on tg.team = s.team
  join complete_groups cg on cg.group_letter = tg.group_letter
  group by s.team, tg.group_letter
),
actual_ranks as (
  select team,
         row_number() over (partition by group_letter
                            order by pts desc, (gf - ga) desc, gf desc, team asc) as rank
  from actual_team_stats
),
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
  left join pred_ranks pr           on pr.entry_id = e.id
  left join entry_group_eligible eg on eg.entry_id = pr.entry_id and eg.group_letter = pr.group_letter
  left join actual_ranks ar         on ar.team = pr.team
  group by e.id
),
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
    e.id                                       as entry_id,
    e.username                                 as username,
    champ.champion_pick                        as champion_pick,
    gr.n_outcome * w.w_outcome
      + gr.n_goaldiff * w.w_goaldiff
      + gr.n_teamgoals * w.w_teamgoals
      + gr.n_exact * w.w_exact                 as group_points,
    rr.n_rank_exact * w.w_rank_exact
      + rr.n_rank_adjacent * w.w_rank_adjacent as ranking_points,
    kr.knockout_points                         as knockout_points,
    gr.n_exact                                 as exact_count,
    champ.champion_correct                     as champion_correct,
    e.created_at                               as created_at
  from visible_entries e
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
  group_points + ranking_points + knockout_points as total,
  exact_count,
  champion_correct,
  created_at
from scored;
$$;

create or replace view leaderboard as
  select * from compute_leaderboard(null, null)
  order by total desc, exact_count desc, champion_correct desc, created_at asc;

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
