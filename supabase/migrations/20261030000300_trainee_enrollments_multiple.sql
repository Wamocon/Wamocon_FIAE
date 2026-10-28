-- A trainee can have several enrollments: drop the unique index on trainee_id.
--
-- Decision of the owner (28.10.2026), it replaces the earlier one ("a trainee has
-- exactly one occupation", file 20261026000100): a trainee can be enrolled in
-- several trainings, also at the same time. Until now the unique index
-- public.trainee_enrollments_trainee_unique (on trainee_id alone) and
-- setTraineeEnrollment (src/lib/catalog/admin.ts) allowed only one. The app now adds
-- an enrollment (addTraineeEnrollment) and removes one only on purpose
-- (removeTraineeEnrollment), so the database must no longer forbid the second row.
--
-- What it does, in this order:
--   1. stops with a clear message if the table is missing, or if the constraint that
--      stays (unique on trainee_id plus training_catalog_id) or the one that the
--      elective choices point at (unique on id plus training_catalog_id) is missing.
--      Dropping the index without them would leave the table with no uniqueness at all
--   2. drops the index trainee_enrollments_trainee_unique if it exists
--   3. updates the comment of the table, which still said "exactly one"
--   4. checks the result: the index is gone, the unique constraint on
--      (trainee_id, training_catalog_id) is still there (its columns are compared, not
--      the text of its definition), and the triggers of the elective choices are still
--      in place
--
-- What stays and why nothing else has to change:
--   - unique (trainee_id, training_catalog_id), constraint
--     trainee_enrollments_trainee_catalog_unique: a trainee is enrolled in one catalog
--     at most once. It also starts with trainee_id, so every lookup by trainee keeps an
--     index (the dropped index was the only other one on that column)
--   - unique (id, training_catalog_id): target of the composite key of
--     trainee_elective_choices
--   - the triggers and checks of the catalog series do not assume one enrollment per
--     trainee. check_trainee_elective_choice counts the choices per enrollment id and
--     takes the limit from the catalog of that enrollment, set_training_catalog_from_enrollment
--     reads the enrollment by id, the policies trainee_enrollments_org_isolation and
--     trainee_elective_choices_org_isolation test the trainee of the row. Elective
--     choices therefore stay per enrollment, so a second enrollment has its own
--   - hai_embedding_catalog (20261027000100) takes the enrollment with the latest start
--     date for the personal chunks of a trainee (order by start_date desc limit 1). It
--     already tolerates several rows; the personal chunks carry one catalog
--
-- No row is read apart from the existence checks, no row is changed or deleted. Dropping
-- an index takes a short exclusive lock on trainee_enrollments, the lock timeout below
-- stops the file instead of waiting behind a long transaction. The table is small (one
-- row per enrollment).
--
-- Safe to run twice (drop index if exists, then the same check of the result). Sorting:
-- behind 20261030000200, so the rollout gate (scripts/db/rollout-gate.mjs, gated from
-- 20261024000100) holds it back in Production together with the series. In Production
-- the series runs in one go, so 20261026000100 creates the index and this file drops it
-- again a moment later. That is intended, a recorded migration is never edited.
-- Production is not migrated by this change.
--
-- Undo (only while no trainee has more than one enrollment):
--   run supabase/manual/rollback-trainee-enrollments-multiple.sql, first as a try with
--   "rollback;" in place of "commit;". The template stops if a trainee has two or more
--   enrollments, it never deletes a row.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Pre check ---------------------------------------------------------------------

do $$
begin
  if to_regclass('public.trainee_enrollments') is null then
    raise exception
      'trainee enrollments: public.trainee_enrollments is missing, apply 20261024001100 first';
  end if;
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.trainee_enrollments'::regclass
       and c.conname = 'trainee_enrollments_trainee_catalog_unique'
       and c.contype = 'u'
  ) then
    raise exception
      'trainee enrollments: the unique constraint trainee_enrollments_trainee_catalog_unique is missing, the table would have no uniqueness left';
  end if;
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.trainee_enrollments'::regclass
       and c.conname = 'trainee_enrollments_id_catalog_unique'
       and c.contype = 'u'
  ) then
    raise exception
      'trainee enrollments: the unique constraint trainee_enrollments_id_catalog_unique is missing, the elective choices point at it';
  end if;
end $$;

-- 2. The index -----------------------------------------------------------------------

drop index if exists public.trainee_enrollments_trainee_unique;

-- 3. Comment -------------------------------------------------------------------------

comment on table public.trainee_enrollments is
  'Enrollment of a trainee in one training catalog (occupation) with start date and planned duration. A trainee can have several, one per catalog.';

-- 4. Check of the result --------------------------------------------------------------

do $$
declare
  catalog_unique_columns text[];
begin
  if to_regclass('public.trainee_enrollments_trainee_unique') is not null then
    raise exception
      'trainee enrollments: the index trainee_enrollments_trainee_unique still exists';
  end if;

  -- the columns of the constraint, in order (not the text of its definition,
  -- which changes with options such as DEFERRABLE)
  select array_agg(a.attname::text order by k.ord) into catalog_unique_columns
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.trainee_enrollments'::regclass
     and c.conname = 'trainee_enrollments_trainee_catalog_unique'
     and c.contype = 'u';
  if catalog_unique_columns is distinct from array['trainee_id', 'training_catalog_id'] then
    raise exception
      'trainee enrollments: trainee_enrollments_trainee_catalog_unique is not unique on (trainee_id, training_catalog_id), found %',
      coalesce(array_to_string(catalog_unique_columns, ', '), 'nothing');
  end if;

  -- the elective choices belong to the enrollments of the catalog series; the table
  -- and its triggers exist after 20261024001400
  if to_regclass('public.trainee_elective_choices') is not null then
    if not exists (
      select 1 from pg_trigger t
       where t.tgrelid = 'public.trainee_elective_choices'::regclass
         and t.tgname = 'trainee_elective_choices_set_catalog'
         and not t.tgisinternal
    ) or not exists (
      select 1 from pg_trigger t
       where t.tgrelid = 'public.trainee_elective_choices'::regclass
         and t.tgname = 'trainee_elective_choices_limit'
         and not t.tgisinternal
    ) then
      raise exception
        'trainee enrollments: a trigger of trainee_elective_choices is missing';
    end if;
  end if;
end $$;
