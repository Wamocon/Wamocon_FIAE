-- Package 2.4 (part 2): explicit training phase on training components.
--
-- phase smallint: 1 or 2, NULL = integrative (active for the whole training).
-- Backfill from training_year, which the FIAE seed uses as phase marker:
--   training_year 1 (months 1 to 18) -> phase 1
--   training_year 2 (months 19 to 36) -> phase 2
--   training_year 3 (integrative) and NULL -> phase NULL
-- The statement only touches rows whose phase is still NULL, so a second run
-- changes nothing. training_year itself is not modified.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.training_components
  add column if not exists phase smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_components_phase_check'
      and conrelid = 'public.training_components'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_components
      add constraint training_components_phase_check
      check (phase is null or phase in (1, 2));
  end if;
end $$;

update public.training_components
set phase = training_year
where phase is null
  and training_year in (1, 2);

comment on column public.training_components.phase is
  'Training phase 1 or 2; NULL = integrative (whole training). Backfilled from training_year (1 -> 1, 2 -> 2, 3 and NULL -> NULL).';
