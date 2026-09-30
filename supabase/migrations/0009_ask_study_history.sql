-- Persist user-owned Ask StudyForge responses without changing the assistant or progress flows.
create table if not exists public.ask_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  study_plan_id uuid,
  question text not null check (length(trim(question)) between 1 and 1200),
  answer text not null,
  created_at timestamptz not null default now(),
  grounded boolean not null default false,
  provider text not null check (length(provider) between 1 and 80),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  request_id text not null check (length(request_id) between 1 and 80),
  constraint ask_history_user_request_key unique (user_id, request_id),
  constraint ask_history_plan_owner_fkey
    foreign key (study_plan_id, user_id)
    references public.study_plans (id, user_id)
    on delete set null (study_plan_id)
);

create index if not exists ask_history_user_created_idx
  on public.ask_history (user_id, created_at desc, id desc);
create index if not exists ask_history_plan_created_idx
  on public.ask_history (study_plan_id, created_at desc);

alter table public.ask_history enable row level security;

drop policy if exists "ask history select own" on public.ask_history;
create policy "ask history select own" on public.ask_history
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "ask history insert own" on public.ask_history;
create policy "ask history insert own" on public.ask_history
  for insert to authenticated
  with check (user_id = (select auth.uid()));
