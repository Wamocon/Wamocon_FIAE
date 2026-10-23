-- Down script for the KfBM training catalog migration series
-- (supabase/migrations/20261020000100 ... 20261020001500 and 20261024000000).
--
-- Only meaningful until the FIAE-only state is left: the script refuses to run
-- as soon as the first non-FIAE (KfBM) record exists, because dropping the
-- catalog structure would silently delete or orphan that data. After KfBM data
-- was imported, roll forward instead.
--
-- Take a backup first (see docs/production-schema-migration.md). Run this
-- script manually (psql or the Supabase SQL editor, one transaction); it is not
-- part of supabase/migrations and the migration history table is NOT updated.
-- Mark the migration versions as reverted afterwards:
--   supabase migration repair --status reverted <version> ...
--
-- What it restores:
--   * public.lernfelder / public.lernfeld_mappings become the original tables
--     again. Rows created, changed or deleted through the compatibility views
--     since the migration are copied back first. Labels are taken from
--     training_catalog_learning_fields.code, so a label that the migration
--     suffixed (' #2') or generated (blank label) keeps that value.
--   * training_components.code is globally unique again.
--   * All columns, tables, triggers, functions and views of the series are
--     dropped. Data in them is lost: text codes, use_cases.enabler_id links,
--     component phase and kind, organization catalogs, trainee enrollments,
--     catalog settings.
-- What it cannot undo: PostgreSQL cannot remove an enum value, so
-- user_role keeps the value SUPER_ADMIN (unused afterwards). Profiles with the
-- role SUPER_ADMIN are set back to ADMIN.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 0. Precondition: FIAE only ------------------------------------------------
do $$
declare
  fiae constant uuid := '00000000-0000-4000-8000-000000000001';
  blocked text[] := '{}';
begin
  if to_regclass('public.training_catalogs') is null then
    raise exception 'public.training_catalogs does not exist; nothing to roll back.';
  end if;

  if exists (select 1 from public.courses where training_catalog_id <> fiae) then
    blocked := blocked || 'courses';
  end if;
  if exists (select 1 from public.training_components where training_catalog_id <> fiae) then
    blocked := blocked || 'training_components';
  end if;
  if exists (select 1 from public.quizzes where training_catalog_id <> fiae) then
    blocked := blocked || 'quizzes';
  end if;
  if exists (select 1 from public.training_catalog_learning_fields where training_catalog_id <> fiae) then
    blocked := blocked || 'training_catalog_learning_fields';
  end if;
  if exists (select 1 from public.training_catalog_content_mappings where training_catalog_id <> fiae) then
    blocked := blocked || 'training_catalog_content_mappings';
  end if;
  if to_regclass('public.trainee_enrollments') is not null
     and exists (select 1 from public.trainee_enrollments where training_catalog_id <> fiae) then
    blocked := blocked || 'trainee_enrollments';
  end if;
  if to_regclass('public.trainee_elective_choices') is not null
     and exists (select 1 from public.trainee_elective_choices) then
    blocked := blocked || 'trainee_elective_choices';
  end if;
  if to_regclass('public.organization_catalogs') is not null
     and exists (
       select 1 from public.organization_catalogs
       where training_catalog_id <> fiae and is_enabled
     ) then
    blocked := blocked || 'organization_catalogs';
  end if;

  if array_length(blocked, 1) is not null then
    raise exception
      'Rollback refused: non-FIAE data exists in %. Roll forward instead.',
      array_to_string(blocked, ', ');
  end if;
end $$;

-- 1. SUPER_ADMIN back to ADMIN (20261024000000) ------------------------------
do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'SUPER_ADMIN'
  ) then
    update public.profiles set role = 'ADMIN' where role = 'SUPER_ADMIN';
  end if;
end $$;

-- 2. Elective choices, enrollments, organization catalogs (20261020001000 - 1400)
drop table if exists public.trainee_elective_choices;
drop function if exists public.check_trainee_elective_choice();
drop function if exists public.set_training_catalog_from_enrollment();
drop table if exists public.trainee_enrollments;

drop trigger if exists organizations_enable_default_catalog
  on public.organizations;
drop function if exists public.enable_default_catalog_for_organization();
drop table if exists public.organization_catalogs;

-- 3. Component kind and phase (20261020001300, 20261020000700) --------------
alter table public.training_components
  drop column if exists kind,
  drop column if exists phase;

-- 4. Use case enabler link (20261020000800) ----------------------------------
drop view if exists public.v_use_case_enabler_backfill_report;
alter table public.use_cases
  drop constraint if exists use_cases_enabler_course_fk,
  drop constraint if exists use_cases_enabler_id_unique,
  drop column if exists enabler_id;
alter table public.enablers
  drop constraint if exists enablers_id_course_unique;

-- 5. Quiz binding (20261020000600) -------------------------------------------
drop index if exists public.quizzes_global_component_unique;
alter table public.quizzes
  drop constraint if exists quizzes_component_catalog_fk,
  drop column if exists training_component_id,
  drop column if exists training_catalog_id;

-- 6. Learning field model (20261020000500): restore the legacy tables --------
do $$
declare
  fiae constant uuid := '00000000-0000-4000-8000-000000000001';
  lernfelder_kind "char";
begin
  select c.relkind into lernfelder_kind
  from pg_class c
  where c.oid = to_regclass('public.lernfelder');

  if lernfelder_kind = 'v' and to_regclass('public.lernfelder_legacy') is not null then
    drop view public.lernfeld_mappings;
    drop view public.lernfelder;

    -- Rows created, changed or deleted through the views after the migration.
    insert into public.lernfelder_legacy (
      id, title, description, label, created_at, updated_at
    )
    select lf.id, lf.title, lf.description, lf.code, lf.created_at, lf.updated_at
    from public.training_catalog_learning_fields lf
    where lf.training_catalog_id = fiae
    on conflict (id) do update
      set title = excluded.title,
          description = excluded.description,
          label = excluded.label,
          updated_at = excluded.updated_at;

    delete from public.lernfelder_legacy l
    where not exists (
      select 1
      from public.training_catalog_learning_fields lf
      where lf.id = l.id
    );

    insert into public.lernfeld_mappings_legacy (
      id, lernfeld_id, enabler_id, use_case_id, created_at
    )
    select m.id, m.learning_field_id, m.enabler_id, m.use_case_id, m.created_at
    from public.training_catalog_content_mappings m
    where m.training_catalog_id = fiae
      and not exists (
        select 1 from public.lernfeld_mappings_legacy l where l.id = m.id
      )
      and not exists (
        select 1
        from public.lernfeld_mappings_legacy l
        where l.lernfeld_id = m.learning_field_id
          and (l.enabler_id = m.enabler_id or l.use_case_id = m.use_case_id)
      );

    delete from public.lernfeld_mappings_legacy l
    where (l.enabler_id is not null or l.use_case_id is not null)
      and exists (
        select 1
        from public.training_catalog_learning_fields lf
        where lf.id = l.lernfeld_id
      )
      and not exists (
        select 1
        from public.training_catalog_content_mappings m
        where m.learning_field_id = l.lernfeld_id
          and (m.enabler_id = l.enabler_id or m.use_case_id = l.use_case_id)
      );

    alter table public.lernfelder_legacy rename to lernfelder;
    alter table public.lernfeld_mappings_legacy rename to lernfeld_mappings;
    comment on table public.lernfelder is null;
    comment on table public.lernfeld_mappings is null;
  end if;
end $$;

drop function if exists public.lernfelder_view_write();
drop function if exists public.lernfeld_label_training_year(text);

-- 7. Catalog tables and consistency columns (20261020000100 - 0400) ----------
drop table if exists public.training_catalog_content_mappings;
drop table if exists public.training_catalog_learning_fields;

drop trigger if exists enablers_set_training_catalog on public.enablers;
drop trigger if exists use_cases_set_training_catalog on public.use_cases;
drop function if exists public.set_training_catalog_from_course();
drop function if exists public.set_training_catalog_from_learning_field();

-- Dropping a column drops the constraints and indexes that involve it.
alter table public.enablers
  drop column if exists training_catalog_id,
  drop column if exists code;
alter table public.use_cases
  drop column if exists training_catalog_id,
  drop column if exists code;

-- 8. Text codes on courses (20261020000200) and catalog columns -------------
alter table public.courses
  drop column if exists code;

-- Restore the global unique(code) of the FIAE components.
alter table public.training_components
  drop constraint if exists training_components_catalog_code_unique,
  drop constraint if exists training_components_id_catalog_unique,
  add constraint training_components_code_unique unique (code);

alter table public.training_components
  drop column if exists training_catalog_id;

alter table public.courses
  drop constraint if exists courses_id_catalog_unique,
  drop column if exists training_catalog_id;

drop table if exists public.training_catalogs;

commit;
