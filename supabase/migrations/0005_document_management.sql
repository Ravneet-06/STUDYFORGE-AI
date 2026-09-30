alter table public.documents
  add column if not exists content text,
  add column if not exists character_count integer;

-- Postgres has no `add constraint if not exists`, so guard the constraint for idempotency.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_character_count_nonnegative'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_character_count_nonnegative
      check (character_count is null or character_count >= 0);
  end if;
end $$;
