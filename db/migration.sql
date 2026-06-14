-- =============================================================================
-- Migration: Add Password Auth, Followers, Google Auth, and create_entry Stored Procedure
-- Run this in your Supabase SQL Editor.
-- =============================================================================

-- 1. Add password_hash column to entries table
alter table entries add column if not exists password_hash text;
alter table entries add column if not exists google_sub text;
alter table entries add column if not exists google_email text;
alter table entries add column if not exists google_linked_at timestamptz;
create unique index if not exists entries_google_sub_idx
  on entries (google_sub)
  where google_sub is not null;

-- 2. Create follows table for the social graph
create table if not exists follows (
  follower_id int not null references entries(id) on delete cascade,
  followed_id int not null references entries(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint no_self_follow check (follower_id <> followed_id)
);

-- 3. Drop existing signatures of create_entry
drop function if exists create_entry(text, jsonb, jsonb);
drop function if exists create_entry(text, text, jsonb, jsonb);
drop function if exists create_entry(text, text, jsonb, jsonb, text, text);

-- 4. Recreate create_entry function with password + Google account support
create or replace function create_entry(
  p_username      text,
  p_password_hash text,
  p_predictions   jsonb,
  p_advancers     jsonb,
  p_google_sub    text default null,
  p_google_email  text default null
) returns jsonb
language plpgsql
as $$
declare
  v_entry_id    int;
  v_uploaded_at  timestamptz;
  v_round       text;
  v_pred_count  int;
  v_late_count  int;
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

  -- 72 group predictions, joined to matches by match_no
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

  -- Verify exact 72 group predictions were inserted
  select count(*) into v_pred_count from predictions where entry_id = v_entry_id;
  if v_pred_count <> 72 then
    raise exception 'expected 72 predictions but inserted %', v_pred_count;
  end if;

  -- Multi-team rounds (R32, R16, QF, SF, FINAL)
  foreach v_round in array array['R32','R16','QF','SF','FINAL'] loop
    insert into advancement_predictions (entry_id, round, team)
    select v_entry_id, v_round, t.team
    from jsonb_array_elements_text(p_advancers->v_round) as t(team);
  end loop;

  -- Champion (single team)
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
