-- Package 2.1: stable text codes for courses, enablers and use cases.
--
-- The code is a stable, human readable identifier that survives re-imports
-- (for example KfBM "K6.1" / "K6.2"). The existing chapter / order_index
-- columns stay the sort keys. All columns are nullable, so existing FIAE rows
-- are untouched and keep code = NULL.
--
-- Uniqueness (partial, only where a code is set):
--   courses:   (training_catalog_id, code)
--   enablers:  (course_id, code)
--   use_cases: (course_id, code)
--
-- Format: 1 to 64 characters, letters, digits, '.', '_' and '-', starting with
-- a letter or digit (no spaces).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.training_catalogs') is null
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = to_regclass('public.courses')
         and a.attname = 'training_catalog_id'
         and not a.attisdropped
     ) then
    raise exception
      'Run 20261024000100_training_catalog_curriculum.sql first (training catalog columns are missing).';
  end if;
end $$;

alter table public.courses add column if not exists code text;
alter table public.enablers add column if not exists code text;
alter table public.use_cases add column if not exists code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'courses_code_format_check'
      and conrelid = 'public.courses'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.courses
      add constraint courses_code_format_check
      check (code is null or code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'enablers_code_format_check'
      and conrelid = 'public.enablers'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.enablers
      add constraint enablers_code_format_check
      check (code is null or code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'use_cases_code_format_check'
      and conrelid = 'public.use_cases'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.use_cases
      add constraint use_cases_code_format_check
      check (code is null or code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');
  end if;
end $$;

create unique index if not exists courses_catalog_code_unique
  on public.courses (training_catalog_id, code)
  where code is not null;

create unique index if not exists enablers_course_code_unique
  on public.enablers (course_id, code)
  where code is not null;

create unique index if not exists use_cases_course_code_unique
  on public.use_cases (course_id, code)
  where code is not null;

comment on column public.courses.code is
  'Stable text code (for example K6.1), unique per training catalog. NULL for legacy rows.';
comment on column public.enablers.code is
  'Stable text code, unique per course. NULL for legacy rows.';
comment on column public.use_cases.code is
  'Stable text code, unique per course. NULL for legacy rows.';
