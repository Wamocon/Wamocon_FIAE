-- Package 2.5 (part 6): elective components chosen by a trainee ("2 of 9").
--
-- trainee_elective_choices(enrollment_id, component_id) with primary key over
-- both columns. Rules:
--   * the component must belong to the catalog of the enrollment (composite
--     foreign keys on training_catalog_id; the column is derived from the
--     enrollment by a BEFORE trigger),
--   * the component must be an elective one (training_components.kind = 'wahl'),
--   * a trainee has at most training_catalogs.elective_pick_count choices.
-- The last two rules are checked by a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger, so several choices can be written in one transaction. Concurrent
-- transactions on the same enrollment are serialised with an advisory lock.
-- "At most" is enforced; having made all picks is a matter for the app.
-- Deleting a chosen component is blocked (no cascade).
--
-- RLS: org isolation through the trainee of the enrollment, like the other
-- org scoped tables.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.trainee_elective_choices (
  enrollment_id uuid not null,
  component_id uuid not null,
  training_catalog_id uuid not null,
  created_at timestamp not null default now(),
  constraint trainee_elective_choices_enrollment_id_component_id_pk
    primary key (enrollment_id, component_id),
  constraint trainee_elective_choices_enrollment_catalog_fk
    foreign key (enrollment_id, training_catalog_id)
    references public.trainee_enrollments (id, training_catalog_id)
    on delete cascade,
  constraint trainee_elective_choices_component_catalog_fk
    foreign key (component_id, training_catalog_id)
    references public.training_components (id, training_catalog_id)
    on delete restrict
);

create index if not exists trainee_elective_choices_component_id_idx
  on public.trainee_elective_choices (component_id);

-- Derive the catalog from the enrollment so callers do not have to pass it.
create or replace function public.set_training_catalog_from_enrollment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_catalog uuid;
begin
  select e.training_catalog_id
  into parent_catalog
  from public.trainee_enrollments e
  where e.id = new.enrollment_id;

  if found then
    new.training_catalog_id := parent_catalog;
  end if;

  return new;
end;
$$;

drop trigger if exists trainee_elective_choices_set_catalog
  on public.trainee_elective_choices;
create trigger trainee_elective_choices_set_catalog
  before insert or update of enrollment_id, training_catalog_id
  on public.trainee_elective_choices
  for each row
  execute function public.set_training_catalog_from_enrollment();

-- Elective rules: component kind and maximum number of choices.
create or replace function public.check_trainee_elective_choice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  component_kind text;
  allowed_count integer;
  chosen_count integer;
begin
  -- Serialise concurrent changes of the same enrollment.
  perform pg_advisory_xact_lock(hashtextextended(new.enrollment_id::text, 0));

  select c.kind
  into component_kind
  from public.training_components c
  where c.id = new.component_id;

  if component_kind is distinct from 'wahl' then
    raise exception
      'Component % is not an elective component (kind = %).',
      new.component_id, coalesce(component_kind, 'unknown')
      using errcode = '23514';
  end if;

  select tc.elective_pick_count
  into allowed_count
  from public.trainee_enrollments e
  join public.training_catalogs tc on tc.id = e.training_catalog_id
  where e.id = new.enrollment_id;

  select count(*)
  into chosen_count
  from public.trainee_elective_choices x
  where x.enrollment_id = new.enrollment_id;

  if chosen_count > coalesce(allowed_count, 0) then
    raise exception
      'Enrollment % has % elective choices, at most % are allowed.',
      new.enrollment_id, chosen_count, coalesce(allowed_count, 0)
      using errcode = '23514';
  end if;

  return null;
end;
$$;

drop trigger if exists trainee_elective_choices_limit
  on public.trainee_elective_choices;
create constraint trigger trainee_elective_choices_limit
  after insert or update of enrollment_id, component_id
  on public.trainee_elective_choices
  deferrable initially deferred
  for each row
  execute function public.check_trainee_elective_choice();

alter table public.trainee_elective_choices enable row level security;

drop policy if exists trainee_elective_choices_org_isolation
  on public.trainee_elective_choices;
create policy trainee_elective_choices_org_isolation
  on public.trainee_elective_choices for all to authenticated
  using (
    exists (
      select 1
      from public.trainee_enrollments e
      join public.profiles p on p.id = e.trainee_id
      where e.id = trainee_elective_choices.enrollment_id
        and p.organization_id = public.get_user_org_id()
    )
    or public.is_platform_owner()
  );

-- No anonymous access (only if the Supabase role exists). The server role
-- bypasses RLS (BYPASSRLS), like service_role. There is no USING (true) policy.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.trainee_elective_choices from anon;
  end if;
end $$;

comment on table public.trainee_elective_choices is
  'Elective components (training_components.kind = wahl) picked by a trainee for an enrollment; at most training_catalogs.elective_pick_count rows per enrollment.';
