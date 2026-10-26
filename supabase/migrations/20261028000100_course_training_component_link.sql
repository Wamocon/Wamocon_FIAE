-- KfBM content import, model gap 1: link from a course to its training
-- component.
--
-- Until now a course and a training component were only related by the
-- similarity of their codes, there was no column that connects them. The phase
-- plan, the elective filter and the global quiz of a course all need that link
-- (a course of the KfBM import belongs to exactly one component).
--
-- courses.training_component_id is nullable. The composite foreign key
-- (training_component_id, training_catalog_id) -> training_components
-- (id, training_catalog_id) makes it impossible to link a course to a
-- component of another catalog (same pattern as quizzes, file 20261024000600).
-- It is checked only where training_component_id is set (MATCH SIMPLE), so all
-- existing courses stay valid. The key is RESTRICT: a component that is linked
-- to a course cannot be deleted (the FIAE seed script deletes components, it
-- fails loudly instead of silently unlinking courses). A partial unique index
-- allows at most one course per component.
--
-- Backfill: a course gets the component with the same code in the same catalog
-- (courses.code = training_components.code), but only where that component is
-- not taken by another course yet. Both tables are unique per (catalog, code),
-- so such a pair is unambiguous by construction. The FIAE courses have no code
-- (NULL), so the backfill finds nothing for them and they keep
-- training_component_id NULL. That is not an error: the run reports the numbers
-- with raise notice and never stops because of the backfill.
--
-- Precheck: the file stops with an exception if the catalog columns of
-- 20261024000100 and 20261024000200 are missing. Nothing is changed then.
--
-- Safe to run twice (if not exists, the backfill only touches courses that
-- are still unlinked).
--
-- Undo (only if something breaks):
--   drop index public.courses_training_component_unique;
--   alter table public.courses drop constraint courses_component_catalog_fk;
--   alter table public.courses drop column training_component_id;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.training_components') is null
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = to_regclass('public.courses')
         and a.attname = 'training_catalog_id'
         and not a.attisdropped
     )
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = to_regclass('public.courses')
         and a.attname = 'code'
         and not a.attisdropped
     ) then
    raise exception
      'Run the files 20261024000100 to 20261024000200 first (training_catalog_id or code of courses is missing). Nothing was changed.';
  end if;
end $$;

-- Target of the composite foreign key. 20261024000300 creates it, this file
-- adds it only if it is missing.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_components_id_catalog_unique'
      and conrelid = 'public.training_components'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_components
      add constraint training_components_id_catalog_unique
      unique (id, training_catalog_id);
  end if;
end $$;

alter table public.courses
  add column if not exists training_component_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'courses_component_catalog_fk'
      and conrelid = 'public.courses'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.courses
      add constraint courses_component_catalog_fk
      foreign key (training_component_id, training_catalog_id)
      references public.training_components (id, training_catalog_id)
      on delete restrict;
  end if;
end $$;

-- Backfill by equal codes in the same catalog, only for free components.
do $$
declare
  candidates integer;
  linked integer;
begin
  select count(*)
    into candidates
  from public.courses c
  where c.training_component_id is null
    and c.code is not null;

  update public.courses c
  set training_component_id = t.id
  from public.training_components t
  where c.training_component_id is null
    and c.code is not null
    and t.training_catalog_id = c.training_catalog_id
    and t.code = c.code
    and not exists (
      select 1 from public.courses o where o.training_component_id = t.id
    );
  get diagnostics linked = row_count;

  raise notice
    'courses.training_component_id: % course(s) with a code, % linked to the component with the same code, % stay NULL (no component with that code, or none free).',
    candidates, linked, candidates - linked;
end $$;

create unique index if not exists courses_training_component_unique
  on public.courses (training_component_id)
  where training_component_id is not null;

comment on column public.courses.training_component_id is
  'Training component the course belongs to (composite foreign key with training_catalog_id, at most one course per component). NULL for courses without a component (all FIAE courses until they are linked).';
