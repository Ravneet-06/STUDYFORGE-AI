-- Persist the selected plan and that plan's current-week session counter.
-- Existing unassociated activity is intentionally not attributed to a plan: its ownership cannot be
-- inferred safely from the legacy account-wide activity stream.
alter table public.study_plans
  add constraint study_plans_id_user_id_key unique (id, user_id);

alter table public.quizzes
  add column if not exists plan_id uuid;

alter table public.quizzes
  add constraint quizzes_plan_owner_fkey
  foreign key (plan_id, user_id)
  references public.study_plans (id, user_id)
  on delete set null (plan_id);

alter table public.progress
  add column if not exists current_plan_id uuid,
  add column if not exists plan_weekly_progress jsonb not null default '{}'::jsonb;

-- The composite reference prevents a user from selecting another user's plan even through direct
-- authenticated PostgREST access. Deleting a plan clears only the pointer and preserves progress.
alter table public.progress
  add constraint progress_current_plan_owner_fkey
  foreign key (current_plan_id, user_id)
  references public.study_plans (id, user_id)
  on delete set null (current_plan_id);
