-- Rollout rehearsal: what a Supabase project brings along and the migrations rely on.
--
-- Runs only inside the throwaway container of scripts/db/rehearse-rollout-local.mjs,
-- as the superuser of that container. Never run it anywhere else. Idempotent.

create extension if not exists pgcrypto;
create extension if not exists vector with schema public;

-- API roles of a Supabase project and the role of the application connection
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login;
  end if;
end
$$;

-- auth schema of GoTrue (the image brings the tables, plain Postgres does not)
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant execute on function auth.uid(), auth.role(), auth.jwt()
  to anon, authenticated, service_role, postgres;

-- storage schema of the storage service (enough for policies and checks)
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text)
  returns text[] language plpgsql as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1:array_length(parts, 1) - 1];
end
$$;
grant usage on schema storage to anon, authenticated, service_role, postgres;
grant all on storage.objects, storage.buckets
  to anon, authenticated, service_role, postgres;

-- the migration ledger of the Supabase CLI
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
grant all on schema supabase_migrations to postgres;
grant all on supabase_migrations.schema_migrations to postgres;

-- the application connects as postgres and needs to create in public
grant all on schema public to postgres;
