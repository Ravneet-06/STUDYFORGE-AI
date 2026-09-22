create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'documents', 'document_chunks', 'conversations', 'messages',
    'quizzes', 'quiz_questions', 'quiz_attempts', 'study_plans', 'progress',
    'agent_tasks', 'evaluations'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "user owns %1$s" on public.%1$s', table_name);
    execute format(
      'create policy "user owns %1$s" on public.%1$s for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      table_name
    );
  end loop;
end $$;

drop policy if exists "user owns profiles" on public.profiles;
create policy "user owns profiles" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.enforce_chunk_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.documents
    where id = new.document_id and user_id = new.user_id
  ) then
    raise exception 'document ownership mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists document_chunk_owner on public.document_chunks;
create trigger document_chunk_owner
  before insert or update on public.document_chunks
  for each row execute procedure public.enforce_chunk_owner();
