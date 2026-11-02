-- Activity reports (Ausbildungsnachweise) belong to one occupation (training catalog).
--
-- Why: a trainee in two trainings (src/lib/catalog, several rows in trainee_enrollments)
-- saw the same reports whichever occupation tab was chosen, because activity_reports had
-- no occupation at all. The list filtered by trainee_id only, "one report per week and
-- year" ignored the occupation, so a second report for the other occupation could not be
-- created. The report now carries the occupation it was written for.
--
-- What it does, in this order:
--   1. stops with a clear message if a table it needs is missing or the FIAE catalog row
--      is missing (the backfill falls back to it and the key points at it). Nothing is
--      changed in that case
--   2. adds activity_reports.training_catalog_id (uuid, nullable first) with a foreign key
--      to training_catalogs (on delete restrict, like the other tables of the series)
--   3. backfills every row that has no value yet, the best occupation per report first:
--        a) the occupation of the use case entries of the report (entries point at
--           training_use_cases, a use case at a training component, a component at a
--           catalog), but only if ALL entries lie in exactly one occupation
--        b) otherwise the occupation of the first enrollment of the trainee (the order of
--           src/lib/catalog/enrollments.ts: created_at, then start_date with a missing
--           date last, then the catalog id)
--        c) otherwise FIAE (the legacy rule: no enrollment counts as FIAE)
--   4. sets the default FIAE and NOT NULL. The default keeps an older app version working
--      that does not know the column yet (it inserts without it and gets FIAE, which is
--      right as long as every trainee has only FIAE)
--   5. creates the index (trainee_id, training_catalog_id, year, week_number) for the
--      lookups "reports of this trainee in this occupation" and "does this week exist"
--   6. replaces an existing uniqueness "one report per trainee, week and year" (a unique
--      constraint or unique index on exactly trainee_id, week_number, year, found by its
--      columns, so a differently named one is replaced as well) by a unique constraint on
--      (trainee_id, training_catalog_id, year, week_number). The replacement can only
--      succeed because the old one was stricter. In the migration chain of the repository
--      no such constraint exists on activity_reports (the app checks the week itself), so
--      this step does nothing there and the check "one report per week and occupation" stays
--      in the app (POST /api/activity-reports and the HAI action create_activity_report)
--   7. checks the result: column, not null, default, foreign key, index, no value is null
--
-- What it changes in rows: only rows with training_catalog_id null, once. Later runs find
-- none and change nothing, so a corrected value is never overwritten. Production holds
-- three trainees today, all in FIAE only: every report becomes FIAE (by a, b or c, the
-- result is the same).
--
-- Locks: ADD COLUMN, SET DEFAULT and SET NOT NULL take a short exclusive lock on
-- activity_reports (SET NOT NULL scans the table, it is small). The lock timeout below
-- stops the file instead of waiting behind a long transaction.
--
-- Safe to run twice (add column if not exists, backfill only where null, guarded
-- constraints, create index if not exists, then the same check of the result).
-- Sorting: behind 20261102000200 and behind GATED_TO (20261030000300, prepared as WP3 of the
-- rollout runbook), so after the gate was limited upwards it needs no extra approval. Until
-- then the rollout gate (scripts/db/rollout-gate.mjs, gated from 20261024000100) holds it
-- back together with the series. Production is not migrated by this change.
--
-- Undo (reports of a second occupation lose their occupation, they stay as rows):
--   alter table public.activity_reports
--     drop constraint if exists activity_reports_trainee_catalog_week_unique;
--   drop index if exists public.activity_reports_trainee_catalog_week_idx;
--   alter table public.activity_reports drop column if exists training_catalog_id;
--   If the old uniqueness existed and has to come back (check first that no trainee has two
--   reports for one week and year):
--   alter table public.activity_reports
--     add constraint activity_reports_trainee_week_year_unique
--     unique (trainee_id, week_number, year);
--   The app of this change reads the column, so first deploy the previous app version.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Pre check ---------------------------------------------------------------------

do $$
begin
  if to_regclass('public.activity_reports') is null
     or to_regclass('public.activity_report_use_case_entries') is null
     or to_regclass('public.training_use_cases') is null
     or to_regclass('public.training_components') is null
     or to_regclass('public.training_catalogs') is null
     or to_regclass('public.trainee_enrollments') is null then
    raise exception
      'activity reports catalog: a table is missing (activity_reports, activity_report_use_case_entries, training_use_cases, training_components, training_catalogs or trainee_enrollments), apply the catalog series (20261024000100 to 20261024001200) first. Nothing was changed.';
  end if;
  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.training_components'::regclass
       and a.attname = 'training_catalog_id'
       and not a.attisdropped
  ) then
    raise exception
      'activity reports catalog: public.training_components.training_catalog_id is missing, apply 20261024000100 first. Nothing was changed.';
  end if;
  if not exists (
    select 1
      from public.training_catalogs
     where id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception
      'activity reports catalog: the FIAE catalog row (00000000-0000-4000-8000-000000000001) is missing in public.training_catalogs. Nothing was changed.';
  end if;
end $$;

-- 2. The column ---------------------------------------------------------------------

alter table public.activity_reports
  add column if not exists training_catalog_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.activity_reports'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.conname = 'activity_reports_training_catalog_id_training_catalogs_id_fk'
  ) then
    alter table public.activity_reports
      add constraint activity_reports_training_catalog_id_training_catalogs_id_fk
      foreign key (training_catalog_id)
      references public.training_catalogs (id)
      on delete restrict;
  end if;
end $$;

-- 3. Backfill -----------------------------------------------------------------------

do $$
declare
  filled_by_entries integer;
  filled_total integer;
begin
  -- a) all entries of a report lie in one occupation
  with entry_catalog as (
    select e.report_id,
           min(tc.training_catalog_id::text) as catalog_text,
           count(distinct tc.training_catalog_id) as catalogs
      from public.activity_report_use_case_entries e
      join public.training_use_cases u on u.id = e.use_case_id
      join public.training_components tc on tc.id = u.component_id
     group by e.report_id
  )
  update public.activity_reports r
     set training_catalog_id = ec.catalog_text::uuid
    from entry_catalog ec
   where ec.report_id = r.id
     and ec.catalogs = 1
     and r.training_catalog_id is null;
  get diagnostics filled_by_entries = row_count;

  -- b) the first enrollment of the trainee, c) FIAE
  update public.activity_reports r
     set training_catalog_id = coalesce(
           (
             select en.training_catalog_id
               from public.trainee_enrollments en
              where en.trainee_id = r.trainee_id
              order by en.created_at,
                       coalesce(en.start_date, date '9999-12-31'),
                       en.training_catalog_id::text
              limit 1
           ),
           '00000000-0000-4000-8000-000000000001'::uuid
         )
   where r.training_catalog_id is null;
  get diagnostics filled_total = row_count;

  raise notice
    'activity reports catalog: % report(s) set from their use case entries, % from the enrollment of the trainee or FIAE.',
    filled_by_entries, filled_total;
end $$;

-- 4. Default and NOT NULL -----------------------------------------------------------

alter table public.activity_reports
  alter column training_catalog_id set default '00000000-0000-4000-8000-000000000001',
  alter column training_catalog_id set not null;

comment on column public.activity_reports.training_catalog_id is
  'Occupation (training catalog) of the report. A trainee in several trainings writes one report per week and occupation. Default FIAE for writers that do not know the column.';

-- 5. Index --------------------------------------------------------------------------

create index if not exists activity_reports_trainee_catalog_week_idx
  on public.activity_reports (trainee_id, training_catalog_id, year, week_number);

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
     where c.conrelid = 'public.activity_reports'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from unnest(c.conkey) as k(attnum)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
       ) = array['trainee_id', 'week_number', 'year']
  loop
    execute format(
      'alter table public.activity_reports drop constraint %I',
      old_constraint.conname
    );
    replaced := true;
  end loop;

  -- an old unique index of the same columns that is not backed by a constraint
  for old_index in
    select ic.relname as index_name
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
     where i.indrelid = 'public.activity_reports'::regclass
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
     where c.conrelid = 'public.activity_reports'::regclass
       and c.connamespace = 'public'::regnamespace
       and c.conname = 'activity_reports_trainee_catalog_week_unique'
  ) then
    alter table public.activity_reports
      add constraint activity_reports_trainee_catalog_week_unique
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
     where a.attrelid = 'public.activity_reports'::regclass
       and a.attname = 'training_catalog_id'
       and a.attnotnull
       and a.atthasdef
       and not a.attisdropped
  ) then
    raise exception
      'activity reports catalog: training_catalog_id is missing, nullable or has no default';
  end if;

  select array_agg(a.attname::text order by k.ord) into fk_columns
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.activity_reports'::regclass
     and c.connamespace = 'public'::regnamespace
     and c.conname = 'activity_reports_training_catalog_id_training_catalogs_id_fk'
     and c.contype = 'f';
  if fk_columns is distinct from array['training_catalog_id'] then
    raise exception
      'activity reports catalog: the foreign key on training_catalog_id is missing';
  end if;

  if to_regclass('public.activity_reports_trainee_catalog_week_idx') is null then
    raise exception
      'activity reports catalog: the index activity_reports_trainee_catalog_week_idx is missing';
  end if;

  if exists (select 1 from public.activity_reports where training_catalog_id is null) then
    raise exception
      'activity reports catalog: a report without an occupation is left';
  end if;
end $$;
