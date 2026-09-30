-- Persist weekly learning sessions independently from the limited recent-activity display list.
-- A session is a meaningful learning event separated from the previous one by at least 60 minutes.
alter table public.progress
  add column if not exists weekly_sessions integer not null default 0 check (weekly_sessions >= 0),
  add column if not exists weekly_session_week_start date,
  add column if not exists last_study_activity_at timestamptz;

-- Seed the current UTC week from recent server-recorded activity so existing dashboards do not
-- reset to zero during the migration. Historical data beyond recent_activity's retained window
-- cannot be reconstructed, but subsequent sessions are persisted incrementally.
with bounds as (
  select date_trunc('week', timezone('UTC', now())) as week_start
), events as (
  select
    progress.user_id,
    (item->>'at')::timestamptz as activity_at,
    bounds.week_start
  from public.progress progress
  cross join bounds
  cross join lateral jsonb_array_elements(progress.recent_activity) item
  where item->>'type' in ('quiz_attempt', 'viva_attempt', 'study_generation')
    and (item->>'at')::timestamptz >= bounds.week_start at time zone 'UTC'
    and (item->>'at')::timestamptz < (bounds.week_start + interval '1 week') at time zone 'UTC'
), ordered as (
  select
    user_id,
    activity_at,
    week_start,
    lag(activity_at) over (partition by user_id order by activity_at) as previous_at
  from events
), counted as (
  select
    user_id,
    activity_at,
    week_start,
    sum(case
      when previous_at is null or activity_at - previous_at >= interval '60 minutes' then 1
      else 0
    end) over (partition by user_id order by activity_at) as session_number
  from ordered
), totals as (
  select user_id, week_start, max(session_number)::integer as weekly_sessions,
    max(activity_at) as last_study_activity_at
  from counted
  group by user_id, week_start
)
update public.progress progress
set weekly_sessions = totals.weekly_sessions,
    weekly_session_week_start = totals.week_start::date,
    last_study_activity_at = totals.last_study_activity_at
from totals
where progress.user_id = totals.user_id;
