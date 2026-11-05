-- School exams (Prüfungen) and school blocks (Berufsschul-Kalender) belong to one occupation
-- (training catalog).
--
-- Why: a trainee in two trainings (src/lib/catalog, several rows in trainee_enrollments)
-- saw the exams and the calendar entries of BOTH occupations in every occupation tab
-- (WMCNL-2955 trainee, WMCNL-3018 trainer), because school_exams and ausbildung_blocks had
-- no occupation at all and every route filtered by trainee_id only. An exam of the KfBM
-- training showed up in the FIAE tab and the other way round. Both tables now carry the
-- occupation the row was written for.
--
-- What it does, in this order:
--   1. stops with a clear message if a table or column it needs is missing or the FIAE
--      catalog row is missing (the backfill falls back to it and the key points at it).
--      Nothing is changed in that case
--   2. adds school_exams.training_catalog_id and ausbildung_blocks.training_catalog_id
--      (uuid, nullable first) with a foreign key each to training_catalogs (on delete
--      restrict, like the other tables of the series)
--   3. backfills every row that has no value yet, the best occupation per row first:
--        a) school_exams only: the learning field of the row (school_exams.lernfeld_code
--           against training_catalog_learning_fields.code), but only among the occupations
--           the trainee is enrolled in and only if the code exists in exactly ONE of them.
--           ausbildung_blocks has no column that points to an occupation (it holds the
--           type, the dates, a free title and notes), so a block has no such step
--        b) otherwise the occupation of the first enrollment of the trainee (the order of
--           src/lib/catalog/enrollments.ts: created_at, then start_date with a missing
--           date last, then the catalog id). A trainee with ONE enrollment is clear by
--           this step alone
--        c) otherwise FIAE (the legacy rule: no enrollment counts as FIAE)
--   4. sets the default FIAE and NOT NULL. The default keeps an older app version working
--      that does not know the column yet (it inserts without it and gets FIAE, which is
--      right as long as every trainee has only FIAE)
--   5. creates one index per table on (trainee_id, training_catalog_id) for the lookups
--      "exams / blocks of this trainee in this occupation"
--   6. checks the result: both columns, not null, default, foreign key, index, no value is
--      null
--
-- What it does not do: no uniqueness is added or replaced (neither table has one per week,
-- several exams and blocks per day and trainee are normal), no row is deleted, no other
-- table is touched. The rows keep their dates, types and results (school_exam_results
-- follows its exam).
--
-- What it changes in rows: only rows with training_catalog_id null, once. Later runs find
-- none and change nothing, so a corrected value is never overwritten. The number of rows
-- in school_exams and ausbildung_blocks of Production is not known from the schema and is
-- not claimed here (the checks in docs/kfbm-production-rollout-checks.sql can count them).
-- Production holds three trainees today, all in FIAE only: every row becomes FIAE (by a, b
-- or c, the result is the same), the exams and blocks they see do not change.
--
-- Locks: ADD COLUMN, SET DEFAULT and SET NOT NULL take a short exclusive lock on each of the
-- two tables (SET NOT NULL scans the table, both are small). The lock timeout below stops
-- the file instead of waiting behind a long transaction.
--
-- Safe to run twice (add column if not exists, backfill only where null, guarded
-- constraints, create index if not exists, then the same check of the result).
-- Sorting: behind 20261102000400 and behind GATED_TO (20261030000300, prepared as WP3 of the
-- rollout runbook), so after the gate was limited upwards it needs no extra approval. Until
-- then the rollout gate (scripts/db/rollout-gate.mjs, gated from 20261024000100) holds it
-- back together with the series. Production is not migrated by this change.
--
-- Undo (exams and blocks of a second occupation lose their occupation, they stay as rows):
--   drop index if exists public.school_exams_trainee_catalog_idx;
--   drop index if exists public.ausbildung_blocks_trainee_catalog_idx;
--   alter table public.school_exams drop column if exists training_catalog_id;
--   alter table public.ausbildung_blocks drop column if exists training_catalog_id;
--   The app of this change reads the columns, so first deploy the previous app version.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Pre check ---------------------------------------------------------------------

do $$
begin
  if to_regclass('public.school_exams') is null
     or to_regclass('public.ausbildung_blocks') is null
     or to_regclass('public.training_catalogs') is null
     or to_regclass('public.training_catalog_learning_fields') is null
     or to_regclass('public.trainee_enrollments') is null then
    raise exception
      'school catalog: a table is missing (school_exams, ausbildung_blocks, training_catalogs, training_catalog_learning_fields or trainee_enrollments), apply the catalog series (20261024000100 to 20261024001200) first. Nothing was changed.';
  end if;
  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.school_exams'::regclass
       and a.attname = 'lernfeld_code'
       and not a.attisdropped
  ) then
    raise exception
      'school catalog: public.school_exams.lernfeld_code is missing. Nothing was changed.';
  end if;
  if not exists (
    select 1
      from public.training_catalogs
     where id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception
      'school catalog: the FIAE catalog row (00000000-0000-4000-8000-000000000001) is missing in public.training_catalogs. Nothing was changed.';
  end if;
end $$;

-- 2. The columns --------------------------------------------------------------------

alter table public.school_exams
  add column if not exists training_catalog_id uuid;

alter table public.ausbildung_blocks
  add column if not exists training_catalog_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.school_exams'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.conname = 'school_exams_training_catalog_id_training_catalogs_id_fk'
  ) then
    alter table public.school_exams
      add constraint school_exams_training_catalog_id_training_catalogs_id_fk
      foreign key (training_catalog_id)
      references public.training_catalogs (id)
      on delete restrict;
  end if;

  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.ausbildung_blocks'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.conname = 'ausbildung_blocks_training_catalog_id_training_catalogs_id_fk'
  ) then
    alter table public.ausbildung_blocks
      add constraint ausbildung_blocks_training_catalog_id_training_catalogs_id_fk
      foreign key (training_catalog_id)
      references public.training_catalogs (id)
      on delete restrict;
  end if;
end $$;

-- 3. Backfill -----------------------------------------------------------------------

do $$
declare
  exams_by_field integer;
  exams_total integer;
  blocks_total integer;
begin
  -- a) exams: the learning field exists in exactly one occupation of the trainee
  with field_catalog as (
    select e.id as exam_id,
           min(lf.training_catalog_id::text) as catalog_text,
           count(distinct lf.training_catalog_id) as catalogs
      from public.school_exams e
      join public.trainee_enrollments en on en.trainee_id = e.trainee_id
      join public.training_catalog_learning_fields lf
        on lf.training_catalog_id = en.training_catalog_id
       and lf.code = e.lernfeld_code
     where e.training_catalog_id is null
       and e.lernfeld_code is not null
     group by e.id
  )
  update public.school_exams e
     set training_catalog_id = fc.catalog_text::uuid
    from field_catalog fc
   where fc.exam_id = e.id
     and fc.catalogs = 1
     and e.training_catalog_id is null;
  get diagnostics exams_by_field = row_count;

  -- b) the first enrollment of the trainee, c) FIAE
  update public.school_exams e
     set training_catalog_id = coalesce(
           (
             select en.training_catalog_id
               from public.trainee_enrollments en
              where en.trainee_id = e.trainee_id
              order by en.created_at,
                       coalesce(en.start_date, date '9999-12-31'),
                       en.training_catalog_id::text
              limit 1
           ),
           '00000000-0000-4000-8000-000000000001'::uuid
         )
   where e.training_catalog_id is null;
  get diagnostics exams_total = row_count;

  -- blocks: b) the first enrollment of the trainee, c) FIAE (no hint on the row itself)
  update public.ausbildung_blocks b
     set training_catalog_id = coalesce(
           (
             select en.training_catalog_id
               from public.trainee_enrollments en
              where en.trainee_id = b.trainee_id
              order by en.created_at,
                       coalesce(en.start_date, date '9999-12-31'),
                       en.training_catalog_id::text
              limit 1
           ),
           '00000000-0000-4000-8000-000000000001'::uuid
         )
   where b.training_catalog_id is null;
  get diagnostics blocks_total = row_count;

  raise notice
    'school catalog: % exam(s) set from their learning field, % from the enrollment of the trainee or FIAE, % block(s) from the enrollment of the trainee or FIAE.',
    exams_by_field, exams_total, blocks_total;
end $$;

-- 4. Default and NOT NULL -----------------------------------------------------------

alter table public.school_exams
  alter column training_catalog_id set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null;

alter table public.ausbildung_blocks
  alter column training_catalog_id set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null;

comment on column public.school_exams.training_catalog_id is
  'Occupation (training catalog) of the exam. A trainee in several trainings sees the exams of the chosen occupation only. Default FIAE for writers that do not know the column.';

comment on column public.ausbildung_blocks.training_catalog_id is
  'Occupation (training catalog) of the calendar entry. A trainee in several trainings sees the entries of the chosen occupation only. Default FIAE for writers that do not know the column.';

-- 5. Indexes ------------------------------------------------------------------------

create index if not exists school_exams_trainee_catalog_idx
  on public.school_exams (trainee_id, training_catalog_id);

create index if not exists ausbildung_blocks_trainee_catalog_idx
  on public.ausbildung_blocks (trainee_id, training_catalog_id);

-- 6. Check of the result --------------------------------------------------------------

do $$
declare
  fk_columns text[];
  checked_table text;
begin
  foreach checked_table in array array['school_exams', 'ausbildung_blocks'] loop
    if not exists (
      select 1
        from pg_attribute a
       where a.attrelid = format('public.%I', checked_table)::regclass
         and a.attname = 'training_catalog_id'
         and a.attnotnull
         and a.atthasdef
         and not a.attisdropped
    ) then
      raise exception
        'school catalog: % training_catalog_id is missing, nullable or has no default', checked_table;
    end if;

    select array_agg(a.attname::text order by k.ord) into fk_columns
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.conrelid = format('public.%I', checked_table)::regclass
       and c.connamespace = 'public'::regnamespace
       and c.conname = checked_table || '_training_catalog_id_training_catalogs_id_fk'
       and c.contype = 'f';
    if fk_columns is distinct from array['training_catalog_id'] then
      raise exception
        'school catalog: the foreign key on % training_catalog_id is missing', checked_table;
    end if;

    if to_regclass(format('public.%I', checked_table || '_trainee_catalog_idx')) is null then
      raise exception
        'school catalog: the index %_trainee_catalog_idx is missing', checked_table;
    end if;
  end loop;

  if exists (select 1 from public.school_exams where training_catalog_id is null) then
    raise exception
      'school catalog: an exam without an occupation is left';
  end if;
  if exists (select 1 from public.ausbildung_blocks where training_catalog_id is null) then
    raise exception
      'school catalog: a block without an occupation is left';
  end if;
end $$;
