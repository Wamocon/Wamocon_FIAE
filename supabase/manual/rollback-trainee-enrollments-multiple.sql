-- Rollback of supabase/migrations/20261030000300_trainee_enrollments_multiple.sql.
-- RUN BY A HUMAN, only if a trainee may have exactly one enrollment again.
--
-- What it does: creates the unique index trainee_enrollments_trainee_unique on
-- trainee_enrollments (trainee_id) again, the state after 20261026000100. Nothing else
-- is touched: no other index, no constraint, no row.
--
-- Safety: the file stops with an error and changes nothing if one trainee has two or
-- more enrollments. Such a table cannot satisfy the index, and this file does not delete
-- rows (an enrollment carries the elective choices of the trainee, and removing one is a
-- decision of a person). Remove the enrollments that are not wanted anymore first, in the
-- admin area ("Ausbildung entfernen") or by hand, then run this file again. Note that the
-- application of this release adds enrollments (addTraineeEnrollment); the app of the
-- earlier release replaces them. Roll back the app first if the earlier app runs again.
--
-- Run it in the Supabase SQL editor as the project owner (role postgres), in one go.
-- First as a try: replace the last statement "commit;" by "rollback;", run it, read the
-- notice, then run it again with "commit;". It can be run twice.
--
-- Creating the index takes a short SHARE lock on trainee_enrollments and reads all its
-- rows once. The table is small. The lock timeout below bounds the wait. CONCURRENTLY
-- cannot run in a transaction, so it is not used (same reason as in 20261026000100).
--
-- Preview: the schema public_preview is rebuilt from the migrations by the Preview
-- reset (docs/release-prozess.md, section 7). Use that instead of this file there, this
-- file names the schema public.
--
-- What it does not remove: the record of the migration. It stays recorded as applied, so
-- a later "supabase db push" does not drop the index again. To drop it again, remove the
-- row with the version 20261030000300 from supabase_migrations.schema_migrations by hand
-- (only if you really want it back) before pushing.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  affected integer;
  total integer;
begin
  if to_regclass('public.trainee_enrollments') is null then
    raise notice 'public.trainee_enrollments does not exist, nothing to do';
    return;
  end if;

  select count(*), coalesce(sum(d.n), 0)
    into affected, total
  from (
    select count(*) as n
    from public.trainee_enrollments
    group by trainee_id
    having count(*) > 1
  ) d;
  raise notice 'trainees with more than one enrollment: % (% rows in total)', affected, total;

  if affected > 0 then
    raise exception
      '% trainee(s) have more than one enrollment (% rows in total), the unique index would fail. Nothing was changed. List them with: select trainee_id, count(*) from public.trainee_enrollments group by trainee_id having count(*) > 1;',
      affected, total;
  end if;
end $$;

create unique index if not exists trainee_enrollments_trainee_unique
  on public.trainee_enrollments (trainee_id);

comment on index public.trainee_enrollments_trainee_unique is
  'One enrollment per trainee: changing the occupation replaces the row (setTraineeEnrollment).';

-- A leftover index of the same name that is not unique or not valid would pass the
-- statement above unnoticed (if not exists), so look at the result.
do $$
begin
  if not exists (
    select 1
      from pg_index i
     where i.indexrelid = 'public.trainee_enrollments_trainee_unique'::regclass
       and i.indisunique
       and i.indisvalid
       and i.indnatts = 1
  ) then
    raise exception 'public.trainee_enrollments_trainee_unique exists but is not a valid unique index on trainee_id alone, nothing was committed';
  end if;
end $$;

-- The table comment still says "a trainee can have several": the app of the earlier
-- release does not read it, change it by hand if you want it to say "one".

commit;
