-- Package 2.2 (part 1): catalog consistency for course content.
--
-- Goal: a KfBM learning field mapping can never point to an FIAE enabler or
-- use case, and an enabler or use case can never belong to a different
-- catalog than its course. This is enforced with composite foreign keys that
-- include training_catalog_id.
--
-- Steps:
--   1. Unique keys (id, training_catalog_id) as targets for composite FKs.
--   2. training_catalog_id on enablers, use_cases and
--      training_catalog_content_mappings, backfilled from the parent row.
--   3. BEFORE triggers that derive the column from the parent row, so legacy
--      inserts that do not know the column keep working unchanged.
--   4. Composite foreign keys, created NOT VALID. They are enforced for new
--      and changed rows immediately and validated in the next file
--      (20261020000400_catalog_consistency_validate.sql).
--
-- Table sizes are small (hundreds of rows), so the backfill UPDATEs run well
-- inside the statement timeout. The existing single-column foreign keys stay
-- in place; the composite keys are additional.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.training_catalog_content_mappings') is null
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = to_regclass('public.courses')
         and a.attname = 'training_catalog_id'
         and not a.attisdropped
     ) then
    raise exception
      'Run 20261020000100_training_catalog_curriculum.sql first (training catalog tables are missing).';
  end if;
end $$;

-- 1. Composite key targets ---------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'courses_id_catalog_unique'
      and conrelid = 'public.courses'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.courses
      add constraint courses_id_catalog_unique
      unique (id, training_catalog_id);
  end if;

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

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalog_learning_fields_id_catalog_unique'
      and conrelid = 'public.training_catalog_learning_fields'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalog_learning_fields
      add constraint training_catalog_learning_fields_id_catalog_unique
      unique (id, training_catalog_id);
  end if;
end $$;

-- 2. training_catalog_id on enablers, use_cases and mappings -----------------

alter table public.enablers
  add column if not exists training_catalog_id uuid;
alter table public.use_cases
  add column if not exists training_catalog_id uuid;
alter table public.training_catalog_content_mappings
  add column if not exists training_catalog_id uuid;

update public.enablers e
set training_catalog_id = c.training_catalog_id
from public.courses c
where c.id = e.course_id
  and e.training_catalog_id is null;

update public.use_cases u
set training_catalog_id = c.training_catalog_id
from public.courses c
where c.id = u.course_id
  and u.training_catalog_id is null;

update public.training_catalog_content_mappings m
set training_catalog_id = lf.training_catalog_id
from public.training_catalog_learning_fields lf
where lf.id = m.learning_field_id
  and m.training_catalog_id is null;

-- The FIAE default only keeps inserts without the column valid until the
-- trigger below derives the real value from the course.
alter table public.enablers
  alter column training_catalog_id
    set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null;

alter table public.use_cases
  alter column training_catalog_id
    set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null;

alter table public.training_catalog_content_mappings
  alter column training_catalog_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'enablers_id_catalog_unique'
      and conrelid = 'public.enablers'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.enablers
      add constraint enablers_id_catalog_unique
      unique (id, training_catalog_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'use_cases_id_catalog_unique'
      and conrelid = 'public.use_cases'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.use_cases
      add constraint use_cases_id_catalog_unique
      unique (id, training_catalog_id);
  end if;
end $$;

create index if not exists enablers_training_catalog_id_idx
  on public.enablers (training_catalog_id);
create index if not exists use_cases_training_catalog_id_idx
  on public.use_cases (training_catalog_id);
create index if not exists training_catalog_content_mappings_catalog_idx
  on public.training_catalog_content_mappings (training_catalog_id);

-- 3. Derive training_catalog_id from the parent row --------------------------
-- The value is always taken from the parent (course or learning field), so a
-- caller can never store a different catalog than the parent has. If the
-- parent does not exist the value is left alone and the foreign key reports
-- the missing parent.

create or replace function public.set_training_catalog_from_course()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_catalog uuid;
begin
  select c.training_catalog_id
  into parent_catalog
  from public.courses c
  where c.id = new.course_id;

  if found then
    new.training_catalog_id := parent_catalog;
  end if;

  return new;
end;
$$;

create or replace function public.set_training_catalog_from_learning_field()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_catalog uuid;
begin
  select lf.training_catalog_id
  into parent_catalog
  from public.training_catalog_learning_fields lf
  where lf.id = new.learning_field_id;

  if found then
    new.training_catalog_id := parent_catalog;
  end if;

  return new;
end;
$$;

drop trigger if exists enablers_set_training_catalog on public.enablers;
create trigger enablers_set_training_catalog
  before insert or update of course_id, training_catalog_id
  on public.enablers
  for each row
  execute function public.set_training_catalog_from_course();

drop trigger if exists use_cases_set_training_catalog on public.use_cases;
create trigger use_cases_set_training_catalog
  before insert or update of course_id, training_catalog_id
  on public.use_cases
  for each row
  execute function public.set_training_catalog_from_course();

drop trigger if exists tccm_set_training_catalog
  on public.training_catalog_content_mappings;
create trigger tccm_set_training_catalog
  before insert or update of learning_field_id, training_catalog_id
  on public.training_catalog_content_mappings
  for each row
  execute function public.set_training_catalog_from_learning_field();

-- 4. Composite foreign keys (NOT VALID, validated in the next file) ----------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'enablers_course_catalog_fk'
      and conrelid = 'public.enablers'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.enablers
      add constraint enablers_course_catalog_fk
      foreign key (course_id, training_catalog_id)
      references public.courses (id, training_catalog_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'use_cases_course_catalog_fk'
      and conrelid = 'public.use_cases'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.use_cases
      add constraint use_cases_course_catalog_fk
      foreign key (course_id, training_catalog_id)
      references public.courses (id, training_catalog_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalog_content_mappings_learning_field_catalog_fk'
      and conrelid = 'public.training_catalog_content_mappings'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalog_content_mappings
      add constraint training_catalog_content_mappings_learning_field_catalog_fk
      foreign key (learning_field_id, training_catalog_id)
      references public.training_catalog_learning_fields (id, training_catalog_id)
      on delete cascade
      not valid;
  end if;

  -- MATCH SIMPLE: the key is only checked when enabler_id (use_case_id) is set.
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalog_content_mappings_enabler_catalog_fk'
      and conrelid = 'public.training_catalog_content_mappings'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalog_content_mappings
      add constraint training_catalog_content_mappings_enabler_catalog_fk
      foreign key (enabler_id, training_catalog_id)
      references public.enablers (id, training_catalog_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalog_content_mappings_use_case_catalog_fk'
      and conrelid = 'public.training_catalog_content_mappings'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalog_content_mappings
      add constraint training_catalog_content_mappings_use_case_catalog_fk
      foreign key (use_case_id, training_catalog_id)
      references public.use_cases (id, training_catalog_id)
      on delete cascade
      not valid;
  end if;
end $$;

comment on column public.enablers.training_catalog_id is
  'Derived from courses.training_catalog_id by trigger; consistent with the course through a composite foreign key.';
comment on column public.use_cases.training_catalog_id is
  'Derived from courses.training_catalog_id by trigger; consistent with the course through a composite foreign key.';
comment on column public.training_catalog_content_mappings.training_catalog_id is
  'Derived from the learning field by trigger; composite foreign keys keep learning field and content in the same catalog.';
