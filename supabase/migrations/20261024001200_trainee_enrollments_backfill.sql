-- Package 2.5 (part 4): FIAE enrollment for every existing trainee.
--
-- Every profile with role TRAINEE exists today only in the FIAE occupation, so
-- one enrollment (trainee, FIAE) is created from the profile data:
--   start_date     = profiles.start_of_training_date (date part, may be NULL)
--   duration_years = profiles.ausbildung_duration_years (2 or 3)
--
-- IMPORTANT: this is a one-time snapshot. The profile columns stay the source
-- of truth for the running app until the app switches to trainee_enrollments;
-- later changes of the duration or start date in the profile are not copied
-- automatically. The statement is idempotent (existing enrollments are kept).
-- If the snapshot is not wanted, delete this file before applying the series;
-- no other file depends on it.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  inserted_count integer;
begin
  insert into public.trainee_enrollments (
    trainee_id,
    training_catalog_id,
    start_date,
    duration_years
  )
  select
    p.id,
    '00000000-0000-4000-8000-000000000001',
    p.start_of_training_date::date,
    p.ausbildung_duration_years
  from public.profiles p
  where p.role = 'TRAINEE'
  on conflict (trainee_id, training_catalog_id) do nothing;

  get diagnostics inserted_count = row_count;
  raise notice 'trainee_enrollments backfill: % FIAE enrollments created.', inserted_count;
end $$;
