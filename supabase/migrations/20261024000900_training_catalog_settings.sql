-- Package 2.5 (part 1): catalog attributes and configuration (E4, E5, E8, E9).
--
-- training_catalogs gets:
--   occupation_code      informational occupation key
--   regulation_version   informational version of the training regulation
--                        (for example '2025'); unique together with
--                        occupation_code
--   settings jsonb       catalog configuration, default '{}'
--   elective_pick_count  number of elective components a trainee has to pick
--                        (KfBM: 2 of 9), default 0
--
-- Documented settings keys (validated in the app by src/lib/catalog/settings.ts,
-- the database checks only type and shape of the keys it knows):
--   shortening_threshold      number, grade threshold for a shortened training
--   school_organization       'block' or 'weekdays'
--   shortened_training_rules  object, rules for shortened training
--   softskill_criteria_set    text, key of the softskill criteria set
--   department_label          text, label of the department field
--   phase_months              array of two integers, months of phase 1 and 2
--
-- Initial values keep today's FIAE behaviour: shortening_threshold 2.45 (the
-- value currently hard coded in the Arbeitszeugnis code), phase months 18 + 18,
-- block school organisation (FIAE uses the block calendar). The values for
-- KfBM (threshold 2.49, phase months 15 + 21, weekday school organisation,
-- 2 electives) are inputs from the project decisions and are not yet used by
-- any code. The updates only touch rows that still have the defaults.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.training_catalogs
  add column if not exists occupation_code text,
  add column if not exists regulation_version text,
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists elective_pick_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalogs_occupation_regulation_unique'
      and conrelid = 'public.training_catalogs'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalogs
      add constraint training_catalogs_occupation_regulation_unique
      unique (occupation_code, regulation_version);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalogs_elective_pick_count_check'
      and conrelid = 'public.training_catalogs'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalogs
      add constraint training_catalogs_elective_pick_count_check
      check (elective_pick_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalogs_settings_object_check'
      and conrelid = 'public.training_catalogs'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalogs
      add constraint training_catalogs_settings_object_check
      check (jsonb_typeof(settings) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalogs_settings_threshold_check'
      and conrelid = 'public.training_catalogs'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalogs
      add constraint training_catalogs_settings_threshold_check
      check (
        settings -> 'shortening_threshold' is null
        or jsonb_typeof(settings -> 'shortening_threshold') = 'number'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalogs_settings_school_org_check'
      and conrelid = 'public.training_catalogs'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalogs
      add constraint training_catalogs_settings_school_org_check
      check (
        settings ->> 'school_organization' is null
        or settings ->> 'school_organization' in ('block', 'weekdays')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'training_catalogs_settings_phase_months_check'
      and conrelid = 'public.training_catalogs'::regclass
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.training_catalogs
      add constraint training_catalogs_settings_phase_months_check
      check (
        settings -> 'phase_months' is null
        or (
          jsonb_typeof(settings -> 'phase_months') = 'array'
          and jsonb_array_length(settings -> 'phase_months') = 2
        )
      );
  end if;
end $$;

-- Initial values (only for rows that still have the defaults).
update public.training_catalogs
set occupation_code = 'FIAE',
    regulation_version = '2020',
    settings = '{"shortening_threshold": 2.45, "school_organization": "block", "phase_months": [18, 18]}'::jsonb
where id = '00000000-0000-4000-8000-000000000001'
  and occupation_code is null
  and regulation_version is null
  and settings = '{}'::jsonb;

update public.training_catalogs
set occupation_code = 'KFBM',
    regulation_version = '2025',
    elective_pick_count = 2,
    settings = '{"shortening_threshold": 2.49, "school_organization": "weekdays", "phase_months": [15, 21]}'::jsonb
where id = '00000000-0000-4000-8000-000000000002'
  and occupation_code is null
  and regulation_version is null
  and elective_pick_count = 0
  and settings = '{}'::jsonb;

comment on column public.training_catalogs.occupation_code is
  'Informational occupation key; unique together with regulation_version.';
comment on column public.training_catalogs.regulation_version is
  'Informational version of the training regulation (for example 2025).';
comment on column public.training_catalogs.settings is
  'Catalog configuration (jsonb object). Keys: shortening_threshold (number), school_organization (block|weekdays), shortened_training_rules (object), softskill_criteria_set (text), department_label (text), phase_months (array of two integers). Validated in the app by src/lib/catalog/settings.ts.';
comment on column public.training_catalogs.elective_pick_count is
  'Number of elective components (training_components.kind = wahl) a trainee must pick; 0 = no electives.';
