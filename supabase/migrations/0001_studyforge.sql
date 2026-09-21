create extension if not exists vector;

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text, created_at timestamptz not null default now());
create table if not exists public.documents (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, title text not null, mime_type text, status text not null default 'processing', created_at timestamptz not null default now());
create table if not exists public.document_chunks (id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, chunk_index int not null, content text not null, embedding vector(1536), created_at timestamptz not null default now());
create table if not exists public.study_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, title text, created_at timestamptz not null default now());
create table if not exists public.questions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, document_id uuid references public.documents(id) on delete set null, kind text not null, prompt text not null, answer text, created_at timestamptz not null default now());
create table if not exists public.progress (user_id uuid primary key references auth.users(id) on delete cascade, completed int not null default 0 check (completed between 0 and 100), streak int not null default 0, hours numeric not null default 0, updated_at timestamptz not null default now());

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.study_sessions enable row level security;
alter table public.questions enable row level security;
alter table public.progress enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own documents" on public.documents for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own chunks" on public.document_chunks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sessions" on public.study_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own questions" on public.questions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own progress" on public.progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());
