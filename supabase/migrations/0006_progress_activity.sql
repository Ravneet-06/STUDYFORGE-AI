-- Server-derived cumulative progress and activity tracking.
-- All counters are maintained by the API; clients never supply points directly.
alter table public.progress
  add column if not exists points numeric not null default 0 check (points >= 0),
  add column if not exists active_days integer not null default 0 check (active_days >= 0),
  add column if not exists last_active_date date,
  add column if not exists last_activity_at timestamptz,
  add column if not exists quiz_attempts integer not null default 0 check (quiz_attempts >= 0),
  add column if not exists quiz_score_total numeric not null default 0 check (quiz_score_total >= 0),
  add column if not exists viva_attempts integer not null default 0 check (viva_attempts >= 0),
  add column if not exists viva_score_total numeric not null default 0 check (viva_score_total >= 0),
  add column if not exists study_plans integer not null default 0 check (study_plans >= 0),
  add column if not exists generations integer not null default 0 check (generations >= 0),
  add column if not exists recent_activity jsonb not null default '[]'::jsonb;

create index if not exists progress_last_active_idx on public.progress(last_active_date);

-- Recover historical MCQ statistics from the durable attempt rows created before this migration.
-- This is idempotent: rerunning it keeps newer counters and never deletes user data.
with quiz_stats as (
  select
    user_id,
    count(*)::integer as quiz_attempts,
    coalesce(sum(coalesce(score, 0)), 0)::numeric as quiz_score_total,
    count(distinct created_at::date)::integer as active_days,
    max(created_at::date) as last_active_date,
    max(created_at) as last_activity_at
  from public.quiz_attempts
  group by user_id
),
quiz_recent as (
  select user_id,
    jsonb_agg(
      jsonb_build_object(
        'type', 'quiz_attempt',
        'summary', 'Completed an MCQ practice set',
        'score', score,
        'at', created_at
      ) order by created_at desc
    ) as recent_activity
  from (
    select user_id, score, created_at,
      row_number() over (partition by user_id order by created_at desc) as position
    from public.quiz_attempts
  ) attempts
  where position <= 20
  group by user_id
)
insert into public.progress (
  user_id, quiz_attempts, quiz_score_total, active_days,
  last_active_date, last_activity_at, recent_activity
)
select stats.user_id, stats.quiz_attempts, stats.quiz_score_total, stats.active_days,
  stats.last_active_date, stats.last_activity_at, recent.recent_activity
from quiz_stats stats
join quiz_recent recent using (user_id)
on conflict (user_id) do update set
  quiz_score_total = case
    when progress.quiz_attempts < excluded.quiz_attempts then excluded.quiz_score_total
    else progress.quiz_score_total
  end,
  quiz_attempts = greatest(progress.quiz_attempts, excluded.quiz_attempts),
  active_days = greatest(progress.active_days, excluded.active_days),
  last_active_date = greatest(progress.last_active_date, excluded.last_active_date),
  last_activity_at = greatest(progress.last_activity_at, excluded.last_activity_at),
  recent_activity = case
    when progress.recent_activity = '[]'::jsonb then excluded.recent_activity
    else progress.recent_activity
  end;
