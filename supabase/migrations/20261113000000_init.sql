-- Recruitment AI Assistant — initial schema
-- Tables, relational integrity, indexes, row-level security, storage bucket,
-- hybrid (semantic + keyword) CV search, and DB-backed rate limiting.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.hr_role as enum ('admin', 'recruiter');
create type public.job_status as enum ('open', 'closed');
create type public.processing_status as enum ('pending', 'processing', 'ready', 'failed');
create type public.review_status as enum ('new', 'reviewed', 'shortlisted', 'rejected');
create type public.chat_role as enum ('user', 'assistant');

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- HR users (access list). Accounts are created by an administrator only.
-- ---------------------------------------------------------------------------
create table public.hr_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  full_name  text,
  role       public.hr_role not null default 'recruiter',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger hr_users_updated_at before update on public.hr_users
  for each row execute function public.set_updated_at();

-- Helper predicates used by RLS policies. SECURITY DEFINER so they can read
-- hr_users regardless of the caller's own policies; they only ever inspect
-- the caller's own row (auth.uid()).
create or replace function public.is_active_hr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_users
    where user_id = auth.uid() and is_active
  );
$$;

create or replace function public.is_hr_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_users
    where user_id = auth.uid() and is_active and role = 'admin'
  );
$$;

revoke all on function public.is_active_hr() from public;
revoke all on function public.is_hr_admin() from public;
grant execute on function public.is_active_hr() to authenticated, service_role;
grant execute on function public.is_hr_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (char_length(title) between 3 and 120),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  summary             text not null default '' check (char_length(summary) <= 300),
  description         text not null check (char_length(description) between 20 and 10000),
  required_skills     text[] not null default '{}',
  preferred_skills    text[] not null default '{}',
  other_requirements  text not null default '' check (char_length(other_requirements) <= 3000),
  location            text not null default '' check (char_length(location) <= 120),
  status              public.job_status not null default 'open',
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index jobs_status_idx on public.jobs (status, created_at desc);
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
create table public.applications (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.jobs (id) on delete restrict,
  candidate_name        text not null check (char_length(candidate_name) between 2 and 120),
  email                 text not null check (char_length(email) <= 254),
  phone                 text not null check (char_length(phone) <= 40),
  cv_storage_path       text not null unique,
  cv_original_filename  text not null check (char_length(cv_original_filename) <= 255),
  cv_mime_type          text not null,
  cv_size_bytes         integer not null check (cv_size_bytes > 0),
  cv_text               text,
  candidate_profile     jsonb,
  processing_status     public.processing_status not null default 'pending',
  processing_error      text,
  processed_at          timestamptz,
  review_status         public.review_status not null default 'new',
  consent_given_at      timestamptz not null,
  consent_version       text not null,
  submitter_ip_hash     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Allows cv_chunks to reference (id, job_id) so a chunk can never point at
  -- a different job than its application.
  unique (id, job_id)
);
create index applications_job_idx on public.applications (job_id, created_at desc);
create index applications_created_idx on public.applications (created_at desc);
create index applications_name_idx on public.applications (job_id, lower(candidate_name));
create trigger applications_updated_at before update on public.applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- CV chunks (retrieval index)
-- ---------------------------------------------------------------------------
create table public.cv_chunks (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null,
  job_id          uuid not null,
  chunk_index     integer not null check (chunk_index >= 0),
  content         text not null,
  embedding       extensions.vector(1536),
  content_tsv     tsvector generated always as (to_tsvector('english', content)) stored,
  created_at      timestamptz not null default now(),
  foreign key (application_id, job_id)
    references public.applications (id, job_id) on delete cascade,
  unique (application_id, chunk_index)
);
create index cv_chunks_job_idx on public.cv_chunks (job_id);
create index cv_chunks_tsv_idx on public.cv_chunks using gin (content_tsv);
create index cv_chunks_embedding_idx on public.cv_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Chat sessions & messages
-- ---------------------------------------------------------------------------
create table public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  hr_user_id  uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'New conversation' check (char_length(title) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index chat_sessions_owner_idx on public.chat_sessions (hr_user_id, job_id, updated_at desc);
create trigger chat_sessions_updated_at before update on public.chat_sessions
  for each row execute function public.set_updated_at();

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.chat_sessions (id) on delete cascade,
  role        public.chat_role not null,
  content     text not null check (char_length(content) <= 60000),
  evidence    jsonb not null default '[]'::jsonb,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);
create index chat_messages_evidence_idx on public.chat_messages using gin (evidence jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Rate limiting (service role only)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Hybrid CV search (job-scoped). SECURITY INVOKER: RLS on cv_chunks applies,
-- so only active HR users (or the service role) get rows back.
-- Reciprocal-rank fusion of pgvector cosine similarity and full-text rank.
-- ---------------------------------------------------------------------------
create or replace function public.search_cv_chunks(
  p_job_id uuid,
  p_query_embedding extensions.vector(1536),
  p_query_text text,
  p_match_count integer default 12,
  p_application_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  application_id uuid,
  chunk_index integer,
  content text,
  semantic_rank integer,
  keyword_rank integer,
  score double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with semantic as (
    select c.id, row_number() over (order by c.embedding <=> p_query_embedding) as rnk
    from public.cv_chunks c
    where p_query_embedding is not null
      and c.job_id = p_job_id
      and c.embedding is not null
      and (p_application_ids is null or c.application_id = any (p_application_ids))
    order by c.embedding <=> p_query_embedding
    limit greatest(p_match_count, 1) * 4
  ),
  keyword as (
    select c.id, row_number() over (order by ts_rank_cd(c.content_tsv, q) desc) as rnk
    from public.cv_chunks c,
         websearch_to_tsquery('english', coalesce(p_query_text, '')) q
    where c.job_id = p_job_id
      and c.content_tsv @@ q
      and (p_application_ids is null or c.application_id = any (p_application_ids))
    order by ts_rank_cd(c.content_tsv, q) desc
    limit greatest(p_match_count, 1) * 4
  )
  select c.id,
         c.application_id,
         c.chunk_index,
         c.content,
         s.rnk::integer,
         k.rnk::integer,
         coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as score
  from semantic s
  full outer join keyword k on s.id = k.id
  join public.cv_chunks c on c.id = coalesce(s.id, k.id)
  where c.job_id = p_job_id
  order by score desc
  limit greatest(p_match_count, 1);
$$;
grant execute on function public.search_cv_chunks(uuid, extensions.vector, text, integer, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Column-level privileges: HR clients may only change review_status on
-- applications. Everything else is written by the server (service role).
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.applications from anon, authenticated;
grant select on public.applications to authenticated;
grant update (review_status) on public.applications to authenticated;
grant delete on public.applications to authenticated; -- further restricted by RLS (admins only)

revoke insert, update, delete on public.cv_chunks from anon, authenticated;
grant select on public.cv_chunks to authenticated;

revoke all on public.hr_users from anon;
revoke insert, update, delete on public.hr_users from authenticated;
grant select on public.hr_users to authenticated;

revoke all on public.applications from anon;
revoke all on public.cv_chunks from anon;
revoke all on public.chat_sessions from anon;
revoke all on public.chat_messages from anon;
revoke all on public.rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.hr_users enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.cv_chunks enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.rate_limits enable row level security;

-- hr_users: a user can see their own row; admins can see everyone.
create policy hr_users_select on public.hr_users
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_hr_admin()));

-- jobs: anyone may read OPEN jobs (public job board); HR reads/creates/edits all.
create policy jobs_public_read on public.jobs
  for select to anon, authenticated
  using (status = 'open');
create policy jobs_hr_read on public.jobs
  for select to authenticated
  using ((select public.is_active_hr()));
create policy jobs_hr_insert on public.jobs
  for insert to authenticated
  with check ((select public.is_active_hr()) and created_by = (select auth.uid()));
create policy jobs_hr_update on public.jobs
  for update to authenticated
  using ((select public.is_active_hr()))
  with check ((select public.is_active_hr()));

-- applications: never readable by anon. HR can read and update review status;
-- only HR admins can delete.
create policy applications_hr_read on public.applications
  for select to authenticated
  using ((select public.is_active_hr()));
create policy applications_hr_update on public.applications
  for update to authenticated
  using ((select public.is_active_hr()))
  with check ((select public.is_active_hr()));
create policy applications_admin_delete on public.applications
  for delete to authenticated
  using ((select public.is_hr_admin()));

-- cv_chunks: HR read only.
create policy cv_chunks_hr_read on public.cv_chunks
  for select to authenticated
  using ((select public.is_active_hr()));

-- chat: each HR user only sees their own sessions/messages.
create policy chat_sessions_owner on public.chat_sessions
  for all to authenticated
  using (hr_user_id = (select auth.uid()) and (select public.is_active_hr()))
  with check (hr_user_id = (select auth.uid()) and (select public.is_active_hr()));

create policy chat_messages_owner on public.chat_messages
  for all to authenticated
  using (
    (select public.is_active_hr()) and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.hr_user_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_active_hr()) and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.hr_user_id = (select auth.uid())
    )
  );

-- rate_limits: no policies => only the service role (bypasses RLS) can use it.

-- ---------------------------------------------------------------------------
-- Private storage bucket for original CVs. No storage.objects policies are
-- created, so anon/authenticated clients cannot list, read or write CVs.
-- The server issues short-lived signed URLs after checking HR authorization.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cvs',
  'cvs',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
