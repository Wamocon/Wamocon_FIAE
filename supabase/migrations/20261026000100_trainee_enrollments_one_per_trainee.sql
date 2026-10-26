-- One enrollment per trainee: unique index on trainee_enrollments (trainee_id).
--
-- Decision of the owner: a trainee has exactly one occupation. Changing the
-- occupation replaces the enrollment (src/lib/catalog/admin.ts
-- setTraineeEnrollment deletes the other enrollments of the trainee in the same
-- transaction, under an advisory lock). Until now only the app enforced that.
-- The table has unique constraints on (trainee_id, training_catalog_id) and on
-- (id, training_catalog_id), but none on the trainee alone. This index makes the
-- database enforce it too, so no other writer (a script, the SQL editor, later
-- code) can give a trainee a second occupation.
--
-- Precheck: if a trainee already has more than one enrollment, the file stops
-- with an exception that names the number of trainees and rows. Nothing is
-- deleted or merged silently; a human decides which enrollment stays (the one of
-- the current occupation), then runs the file again. Today every writer creates
-- at most one row per trainee (the FIAE backfill 20261024001200 and
-- setTraineeEnrollment), so the check is expected to pass.
--
-- Why a plain CREATE UNIQUE INDEX and not CONCURRENTLY: CONCURRENTLY cannot run
-- inside a transaction block, and every file of this series runs in one (the
-- runbook, "set local" in every file, and the Preview applier, which wraps the
-- file in a DO block). It is also not needed: the table holds one row per
-- trainee, it is created by 20261024001100 in the same release, and only the
-- admin area writes to it. The build takes a SHARE lock for a few milliseconds
-- and lock_timeout 5s makes the file fail fast instead of waiting behind a
-- long transaction.
--
-- The two existing unique constraints stay. (id, training_catalog_id) is the
-- target of the composite foreign key of trainee_elective_choices.
-- (trainee_id, training_catalog_id) is implied by the new index, but it stays:
-- it is the conflict target of the backfill file and dropping it is a separate
-- decision.
--
-- No data is changed. Safe to run twice (if not exists).
--
-- Undo (only if something breaks):
--   drop index public.trainee_enrollments_trainee_unique;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  affected integer;
  total integer;
begin
  if to_regclass('public.trainee_enrollments') is null then
    raise exception
      'Run 20261024001100_trainee_enrollments.sql first (the table public.trainee_enrollments is missing).';
  end if;

  select count(*), coalesce(sum(d.n), 0)
    into affected, total
  from (
    select count(*) as n
    from public.trainee_enrollments
    group by trainee_id
    having count(*) > 1
  ) d;

  if affected > 0 then
    raise exception
      '% trainee(s) have more than one enrollment (% rows in total), but a trainee may have only one. Keep one enrollment per trainee (the one of the current occupation) and run this file again. Nothing was changed. List them with: select trainee_id, count(*) from public.trainee_enrollments group by trainee_id having count(*) > 1;',
      affected, total;
  end if;
end $$;

create unique index if not exists trainee_enrollments_trainee_unique
  on public.trainee_enrollments (trainee_id);

comment on index public.trainee_enrollments_trainee_unique is
  'One enrollment per trainee: changing the occupation replaces the row (setTraineeEnrollment).';
