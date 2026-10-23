-- Package 2.5 (part 5): kind of a training component (compulsory, elective,
-- integrative).
--
-- kind: 'pflicht' (compulsory, default), 'wahl' (elective, a trainee picks
-- training_catalogs.elective_pick_count of them, KfBM: 2 of 9) or
-- 'integrativ' (integrative, active for the whole training, phase is NULL).
--
-- Backfill for the FIAE components: the seed marks integrative components with
-- training_year = 3 (see src/scripts/seed-training-data.ts), so those rows get
-- kind 'integrativ'; everything else keeps the default 'pflicht'. The UPDATE
-- only touches rows that are still 'pflicht', so a second run changes nothing.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.training_components
  add column if not exists kind text not null default 'pflicht';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_components_kind_check'
      and conrelid = 'public.training_components'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_components
      add constraint training_components_kind_check
      check (kind in ('pflicht', 'wahl', 'integrativ'));
  end if;
end $$;

update public.training_components
set kind = 'integrativ'
where training_year = 3
  and kind = 'pflicht';

-- An integrative component runs through the whole training and has no phase.
-- Added after the backfill; the backfilled rows have phase NULL (file
-- 20261020000700 maps training_year 3 to NULL).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_components_integrative_phase_check'
      and conrelid = 'public.training_components'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_components
      add constraint training_components_integrative_phase_check
      check (kind <> 'integrativ' or phase is null);
  end if;
end $$;

comment on column public.training_components.kind is
  'pflicht = compulsory, wahl = elective (trainee picks training_catalogs.elective_pick_count), integrativ = whole training (phase is NULL).';
