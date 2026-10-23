-- Add an occupation-specific training catalog foundation.
--
-- Existing courses and training components are assigned to the FIAE catalog
-- through a constant column default. PostgreSQL stores that default in the
-- catalog (no table rewrite, no UPDATE of existing rows), so every existing
-- row reads as FIAE immediately after this file ran.
--
-- This file is part of the KfBM catalog migration series
-- (20261020000100 ... 20261020001500, 20261024000000). It has never been applied to any
-- database. It must run exactly once; a second run stops in the precheck.
--
-- Pipeline notes: no explicit BEGIN/COMMIT (the pipeline wraps each file),
-- objects are schema-qualified with public., no roles, no extensions.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  -- ALTER TABLE ... ON DELETE SET NULL (column list) and security_invoker
  -- views, both used later in this series, need PostgreSQL 15 or newer.
  if current_setting('server_version_num')::integer < 150000 then
    raise exception
      'PostgreSQL 15 or newer is required for the training catalog migration series (found %).',
      current_setting('server_version');
  end if;

  if to_regclass('public.courses') is null
     or to_regclass('public.training_components') is null
     or to_regclass('public.enablers') is null
     or to_regclass('public.use_cases') is null then
    raise exception
      'Required curriculum tables are missing; stop and verify the target schema before applying this migration.';
  end if;

  if to_regprocedure('public.is_platform_owner()') is null then
    raise exception
      'Required RLS helper public.is_platform_owner() is missing.';
  end if;

  -- Guard against an accidental second run (or a partially applied state).
  if to_regclass('public.training_catalogs') is not null then
    raise exception
      'public.training_catalogs already exists; this migration was already applied. Stop and verify the target schema.';
  end if;
end $$;

create table public.training_catalogs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  duration_years integer not null default 3
    check (duration_years > 0),
  is_active boolean not null default false,
  created_at timestamp not null default now(),
  updated_at timestamp default now()
);

insert into public.training_catalogs (id, code, title, is_active)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'FIAE',
    'Fachinformatiker/in Anwendungsentwicklung',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'KFBM',
    'Kaufmann/-frau für Büromanagement',
    false
  );

-- courses: constant default, no backfill UPDATE needed.
alter table public.courses
  add column training_catalog_id uuid not null
    default '00000000-0000-4000-8000-000000000001',
  add constraint courses_training_catalog_id_training_catalogs_id_fk
    foreign key (training_catalog_id)
    references public.training_catalogs (id)
    on delete restrict;

create index courses_training_catalog_id_idx
  on public.courses (training_catalog_id);

-- training_components: constant default, no backfill UPDATE needed.
alter table public.training_components
  add column training_catalog_id uuid not null
    default '00000000-0000-4000-8000-000000000001',
  add constraint training_components_training_catalog_id_training_catalogs_id_fk
    foreign key (training_catalog_id)
    references public.training_catalogs (id)
    on delete restrict;

-- Replace the global unique(code) by unique(training_catalog_id, code). The
-- old constraint is looked up by definition so a differently named one on the
-- target database is dropped as well.
do $$
declare
  old_constraint record;
begin
  for old_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.training_components'::regclass
      and c.contype = 'u'
      and c.conkey = array[(
        select a.attnum
        from pg_attribute a
        where a.attrelid = 'public.training_components'::regclass
          and a.attname = 'code'
      )]
  loop
    execute format(
      'alter table public.training_components drop constraint %I',
      old_constraint.conname
    );
  end loop;
end $$;

alter table public.training_components
  add constraint training_components_catalog_code_unique
    unique (training_catalog_id, code);

create index training_components_training_catalog_id_idx
  on public.training_components (training_catalog_id);

create table public.training_catalog_learning_fields (
  id uuid primary key default gen_random_uuid(),
  training_catalog_id uuid not null
    references public.training_catalogs (id) on delete cascade,
  code text not null,
  title text not null,
  description text,
  training_year integer not null
    check (training_year between 1 and 3),
  hours_budget integer
    check (hours_budget is null or hours_budget >= 0),
  order_index integer not null,
  created_at timestamp not null default now(),
  updated_at timestamp default now(),
  constraint training_catalog_learning_fields_catalog_code_unique
    unique (training_catalog_id, code),
  constraint training_catalog_learning_fields_catalog_order_unique
    unique (training_catalog_id, order_index)
);

-- Constraint names stay below the 63 character identifier limit; a longer
-- name would be truncated silently and no longer match the Drizzle schema.
create table public.training_catalog_content_mappings (
  id uuid primary key default gen_random_uuid(),
  learning_field_id uuid not null
    references public.training_catalog_learning_fields (id) on delete cascade,
  enabler_id uuid
    references public.enablers (id) on delete cascade,
  use_case_id uuid
    references public.use_cases (id) on delete cascade,
  created_at timestamp not null default now(),
  constraint training_catalog_content_mappings_exactly_one_content_check
    check ((enabler_id is not null) <> (use_case_id is not null)),
  constraint training_catalog_content_mappings_lf_enabler_unique
    unique (learning_field_id, enabler_id),
  constraint training_catalog_content_mappings_lf_use_case_unique
    unique (learning_field_id, use_case_id)
);

create index training_catalog_content_mappings_enabler_id_idx
  on public.training_catalog_content_mappings (enabler_id);

create index training_catalog_content_mappings_use_case_id_idx
  on public.training_catalog_content_mappings (use_case_id);

-- Row level security. Decision: catalog content is NOT public. Existing
-- policies of other content tables allow anonymous reads (known issue, fixed
-- separately); the new tables do not repeat it. Reads need a logged in user
-- (role authenticated), writes only the platform owner. The server connects
-- as a BYPASSRLS role, and service_role bypasses RLS as well, so the
-- app is not affected. No code reads these tables with the anon key.
alter table public.training_catalogs enable row level security;
create policy training_catalogs_select_authenticated
  on public.training_catalogs for select to authenticated using (true);
create policy training_catalogs_manage_platform_owner
  on public.training_catalogs for all to authenticated
  using (public.is_platform_owner());

alter table public.training_catalog_learning_fields enable row level security;
create policy training_catalog_learning_fields_select_authenticated
  on public.training_catalog_learning_fields
  for select to authenticated using (true);
create policy training_catalog_learning_fields_manage_platform_owner
  on public.training_catalog_learning_fields
  for all to authenticated using (public.is_platform_owner());

alter table public.training_catalog_content_mappings enable row level security;
create policy training_catalog_content_mappings_select_authenticated
  on public.training_catalog_content_mappings
  for select to authenticated using (true);
create policy training_catalog_content_mappings_manage_platform_owner
  on public.training_catalog_content_mappings
  for all to authenticated using (public.is_platform_owner());

-- Defense in depth: no table privileges for the anonymous API role (only if
-- the Supabase role exists, so the file also runs on plain PostgreSQL).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.training_catalogs from anon;
    revoke all on public.training_catalog_learning_fields from anon;
    revoke all on public.training_catalog_content_mappings from anon;
  end if;
end $$;

comment on table public.training_catalogs is
  'Occupation-specific training catalog; existing FIAE courses and training components remain assigned to FIAE.';
comment on table public.training_catalog_learning_fields is
  'Learning fields owned by a training catalog, independent of other occupations using the same codes.';
comment on table public.training_catalog_content_mappings is
  'Links one catalog learning field to one enabler or use case.';
