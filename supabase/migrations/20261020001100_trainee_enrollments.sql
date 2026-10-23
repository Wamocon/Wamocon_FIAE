-- Package 2.5 (part 3): enrollment of a trainee in one training catalog.
--
-- A trainee has exactly one occupation per enrollment (E4/E5): one row per
-- (trainee, catalog), with the start date and the planned duration. There is
-- no regulation version per trainee; the catalog carries the informational
-- regulation_version. The table is created empty here; the FIAE backfill of
-- existing trainees is a separate file (20261020001200).
--
-- start_date is nullable like profiles.start_of_training_date. duration_years
-- follows the existing check of profiles.ausbildung_duration_years (2 or 3).
--
-- RLS follows the org isolation pattern of the other org scoped tables: rows
-- are visible and changeable for members of the trainee's organization
-- (get_user_org_id()) and for the platform owner.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.trainee_enrollments (
  id uuid not null default gen_random_uuid(),
  trainee_id uuid not null,
  training_catalog_id uuid not null,
  start_date date,
  duration_years integer not null default 3,
  created_at timestamp not null default now(),
  updated_at timestamp default now(),
  constraint trainee_enrollments_pkey primary key (id),
  constraint trainee_enrollments_trainee_id_profiles_id_fk
    foreign key (trainee_id)
    references public.profiles (id)
    on delete cascade,
  constraint trainee_enrollments_training_catalog_id_training_catalogs_id_fk
    foreign key (training_catalog_id)
    references public.training_catalogs (id)
    on delete restrict,
  constraint trainee_enrollments_trainee_catalog_unique
    unique (trainee_id, training_catalog_id),
  -- Target of composite foreign keys (for example elective choices)
  constraint trainee_enrollments_id_catalog_unique
    unique (id, training_catalog_id),
  constraint trainee_enrollments_duration_years_check
    check (duration_years in (2, 3))
);

create index if not exists trainee_enrollments_training_catalog_id_idx
  on public.trainee_enrollments (training_catalog_id);

alter table public.trainee_enrollments enable row level security;

drop policy if exists trainee_enrollments_org_isolation
  on public.trainee_enrollments;
create policy trainee_enrollments_org_isolation
  on public.trainee_enrollments for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = trainee_enrollments.trainee_id
        and p.organization_id = public.get_user_org_id()
    )
    or public.is_platform_owner()
  );

comment on table public.trainee_enrollments is
  'Enrollment of a trainee in exactly one training catalog (occupation) with start date and planned duration.';
comment on column public.trainee_enrollments.start_date is
  'Start of the training; NULL if unknown (profiles.start_of_training_date is nullable too).';
