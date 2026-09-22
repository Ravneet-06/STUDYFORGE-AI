create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_user_id uuid,
  match_document_id uuid default null,
  match_count integer default 5
)
returns table (
  id uuid,
  document_id uuid,
  user_id uuid,
  chunk_index integer,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    c.user_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = (select auth.uid())
    and c.user_id = match_user_id
    and d.user_id = (select auth.uid())
    and d.status <> 'deleted'
    and (match_document_id is null or c.document_id = match_document_id)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;
