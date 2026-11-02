-- Weekly evaluations (Wochenbewertungen) belong to one occupation (training catalog).
--
-- Why: since 20261102000300 an activity report (Ausbildungsnachweis) belongs to one
-- occupation, so a trainee in two trainings (src/lib/catalog, several rows in
-- trainee_enrollments) can write one report per week in EACH occupation. The weekly
-- evaluation of that week still existed only once per trainee, week and year (unique
-- trainee_id, week_number, year), so the second occupation could not be evaluated, and
-- the lists could attribute an evaluation to an occupation only through the report it is
-- linked to. The evaluation now carries the occupation it was written for.
--
-- What it does, in this order:
--   1. stops with a clear message if a table or column it needs is missing (among them
--      activity_reports.training_catalog_id of 20261102000300) or the FIAE catalog row is
--      missing (the backfill falls back to it and the key points at it). Nothing is
--      changed in that case
--   2. adds weekly_evaluations.training_catalog_id (uuid, nullable first) with a foreign
--      key to training_catalogs (on delete restrict, like the other tables of the series)
--   3. backfills every row that has no value yet, the best occupation per evaluation first:
--        a) the occupation of the activity report the evaluation is linked to
--           (weekly_evaluations.activity_report_id, activity_reports.training_catalog_id)
--        b) otherwise the occupation of the first enrollment of the trainee (the order of
--           src/lib/catalog/enrollments.ts: created_at, then start_date with a missing
--           date last, then the catalog id)
--        c) otherwise FIAE (the legacy rule: no enrollment counts as FIAE)
--   4. sets the default FIAE and NOT NULL. The default keeps an older app version working
--      that does not know the column yet (it inserts without it and gets FIAE, which is
--      right as long as every trainee has only FIAE)
--   5. creates the index (trainee_id, training_catalog_id, year, week_number) for the
--      lookups "evaluations of this trainee in this occupation" and "does this week exist"
--   6. replaces an existing uniqueness "one evaluation per trainee, week and year" (a unique
--      constraint or unique index on exactly trainee_id, week_number, year, found by its
--      columns, so a differently named one such as unique_trainee_week_year is replaced as
--      well) by a unique constraint on (trainee_id, training_catalog_id, year, week_number).
--      The replacement can only succeed because the old one was stricter. Without an old
--      uniqueness this step does nothing and the check "one evaluation per week and
--      occupation" stays in the app (the evaluation is looked up through its report)
--   7. checks the result: column, not null, default, foreign key, index, no value is null
--
-- What it changes in rows: only rows with training_catalog_id null, once. Later runs find
-- none and change nothing, so a corrected value is never overwritten. Production holds
-- three trainees today, all in FIAE only: every evaluation becomes FIAE (by a, b or c, the
-- result is the same).
--
-- Locks: ADD COLUMN, SET DEFAULT and SET NOT NULL take a short exclusive lock on
-- weekly_evaluations (SET NOT NULL scans the table, it is small). The lock timeout below
-- stops the file instead of waiting behind a long transaction.
--
-- Safe to run twice (add column if not exists, backfill only where null, guarded
-- constraints, create index if not exists, then the same check of the result).
-- Sorting: behind 20261102000300 (it needs activity_reports.training_catalog_id) and behind
-- GATED_TO (20261030000300, prepared as WP3 of the rollout runbook), so after the gate was
-- limited upwards it needs no extra approval. Until then the rollout gate
-- (scripts/db/rollout-gate.mjs, gated from 20261024000100) holds it back together with the
-- series. Production is not migrated by this change.
--
-- Undo (evaluations of a second occupation lose their occupation, they stay as rows):
--   alter table public.weekly_evaluations
--     drop constraint if exists weekly_evaluations_trainee_catalog_week_unique;
--   drop index if exists public.weekly_evaluations_trainee_catalog_week_idx;
--   alter table public.weekly_evaluations drop column if exists training_catalog_id;
--   If the old uniqueness existed and has to come back (check first that no trainee has two
--   evaluations for one week and year):
--   alter table public.weekly_evaluations
--     add constraint unique_trainee_week_year
--     unique (trainee_id, week_number, year);
--   The app of this change reads the column, so first deploy the previous app version.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Pre check ---------------------------------------------------------------------

do $$
begin
  if to_regclass('public.weekly_evaluations') is null
     or to_regclass('public.activity_reports') is null
     or to_regclass('public.training_catalogs') is null
     or to_regclass('public.trainee_enrollments') is null then
    raise exception
      'weekly evaluations catalog: a table is missing (weekly_evaluations, activity_reports, training_catalogs or trainee_enrollments), apply the catalog series (20261024000100 to 20261024001200) first. Nothing was changed.';
  end if;
  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.activity_reports'::regclass
       and a.attname = 'training_catalog_id'
       and not a.attisdropped
  ) then
    raise exception
      'weekly evaluations catalog: public.activity_reports.training_catalog_id is missing, apply 20261102000300 first. Nothing was changed.';
  end if;
  if not exists (
    select 1
      from public.training_catalogs
     where id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception
      'weekly evaluations catalog: the FIAE catalog row (00000000-0000-4000-8000-000000000001) is missing in public.training_catalogs. Nothing was changed.';
  end if;
end $$;

-- 2. The column ---------------------------------------------------------------------

alter table public.weekly_evaluations
  add column if not exists training_catalog_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.weekly_evaluations'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.conname = 'weekly_evaluations_training_catalog_id_training_catalogs_id_fk'
  ) then
    alter table public.weekly_evaluations
      add constraint weekly_evaluations_training_catalog_id_training_catalogs_id_fk
      foreign key (training_catalog_id)
      references public.training_catalogs (id)
      on delete restrict;
  end if;
end $$;

-- 3. Backfill -----------------------------------------------------------------------

do $$
declare
  filled_by_report integer;
  filled_total integer;
begin
  -- a) the occupation of the linked activity report
  update public.weekly_evaluations w
     set training_catalog_id = r.training_catalog_id
    from public.activity_reports r
   where r.id = w.activity_report_id
     and r.training_catalog_id is not null
     and w.training_catalog_id is null;
  get diagnostics filled_by_report = row_count;

  -- b) the first enrollment of the trainee, c) FIAE
  update public.weekly_evaluations w
     set training_catalog_id = coalesce(
           (
             select en.training_catalog_id
               from public.trainee_enrollments en
              where en.trainee_id = w.trainee_id
              order by en.created_at,
                       coalesce(en.start_date, date '9999-12-31'),
                       en.training_catalog_id::text
              limit 1
           ),
           '00000000-0000-4000-8000-000000000001'::uuid
         )
   where w.training_catalog_id is null;
  get diagnostics filled_total = row_count;

  raise notice
    'weekly evaluations catalog: % evaluation(s) set from their activity report, % from the enrollment of the trainee or FIAE.',
    filled_by_report, filled_total;
end $$;

-- 4. Default and NOT NULL -----------------------------------------------------------

alter table public.weekly_evaluations
  alter column training_catalog_id set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null;

comment on column public.weekly_evaluations.training_catalog_id is
  'Occupation (training catalog) of the weekly evaluation. A trainee in several trainings has one evaluation per week and occupation. Default FIAE for writers that do not know the column.';

-- 5. Index --------------------------------------------------------------------------

create index if not exists weekly_evaluations_trainee_catalog_week_idx
  on public.weekly_evaluations (trainee_id, training_catalog_id, year, week_number);

-- 6. Uniqueness per week and occupation ---------------------------------------------

do $$
declare
  old_constraint record;
  old_index record;
  replaced boolean := false;
begin
  -- an old unique constraint on exactly (trainee_id, week_number, year), any name
  for old_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.weekly_evaluations'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from unnest(c.conkey) as k(attnum)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
       ) = array['trainee_id', 'week_number', 'year']
  loop
    execute format(
      'alter table public.weekly_evaluations drop constraint %I',
      old_constraint.conname
    );
    replaced := true;
  end loop;

  -- an old unique index of the same columns that is not backed by a constraint
  for old_index in
    select ic.relname as index_name
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
     where i.indrelid = 'public.weekly_evaluations'::regclass
       and ic.relnamespace = 'public'::regnamespace
       and i.indisunique
       and not i.indisprimary
       and i.indpred is null
       and i.indexprs is null
       and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from unnest(i.indkey::int2[]) as k(attnum)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
       ) = array['trainee_id', 'week_number', 'year']
  loop
    execute format('drop index public.%I', old_index.index_name);
    replaced := true;
  end loop;

  if replaced and not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.weekly_evaluations'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.conname = 'weekly_evaluations_trainee_catalog_week_unique'
  ) then
    alter table public.weekly_evaluations
      add constraint weekly_evaluations_trainee_catalog_week_unique
      unique (trainee_id, training_catalog_id, year, week_number);
  end if;
end $$;

-- 7. Check of the result --------------------------------------------------------------

do $$
declare
  fk_columns text[];
begin
  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.weekly_evaluations'::regclass
       and a.attname = 'training_catalog_id'
       and a.attnotnull
       and a.atthasdef
       and not a.attisdropped
  ) then
    raise exception
      'weekly evaluations catalog: training_catalog_id is missing, nullable or has no default';
  end if;

  select array_agg(a.attname::text order by k.ord) into fk_columns
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.weekly_evaluations'::regclass
     and c.connamespace = 'public'::regnamespace
     and c.conname = 'weekly_evaluations_training_catalog_id_training_catalogs_id_fk'
     and c.contype = 'f';
  if fk_columns is distinct from array['training_catalog_id'] then
    raise exception
      'weekly evaluations catalog: the foreign key on training_catalog_id is missing';
  end if;

  if to_regclass('public.weekly_evaluations_trainee_catalog_week_idx') is null then
    raise exception
      'weekly evaluations catalog: the index weekly_evaluations_trainee_catalog_week_idx is missing';
  end if;

  if exists (select 1 from public.weekly_evaluations where training_catalog_id is null) then
    raise exception
      'weekly evaluations catalog: an evaluation without an occupation is left';
  end if;
end $$;
