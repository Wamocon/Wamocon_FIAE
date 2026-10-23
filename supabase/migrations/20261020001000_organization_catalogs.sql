-- Package 2.5 (part 2): which training catalogs an organization may use.
--
-- organization_catalogs(organization_id, training_catalog_id, is_enabled),
-- primary key over both columns. Backfill: every existing organization is
-- enabled for FIAE, so nothing changes for current customers. New
-- organizations get the FIAE row from a trigger, so organization creation in
-- the app keeps working without code changes.
--
-- RLS follows the pattern of public.organizations, but only for logged in
-- users (role authenticated, never public or anon): members read the rows of
-- their own organization (get_user_org_id()), the platform owner reads all.
-- There is no policy with USING (true) and no write policy; the API roles have
-- no INSERT, UPDATE, DELETE or TRUNCATE privilege, the server writes.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.organization_catalogs (
  organization_id uuid not null,
  training_catalog_id uuid not null,
  is_enabled boolean not null default true,
  created_at timestamp not null default now(),
  updated_at timestamp default now(),
  constraint organization_catalogs_organization_id_training_catalog_id_pk
    primary key (organization_id, training_catalog_id),
  constraint organization_catalogs_organization_id_organizations_id_fk
    foreign key (organization_id)
    references public.organizations (id)
    on delete cascade,
  -- Short name: the long generated form would exceed 63 characters.
  constraint organization_catalogs_training_catalog_id_fk
    foreign key (training_catalog_id)
    references public.training_catalogs (id)
    on delete restrict
);

create index if not exists organization_catalogs_training_catalog_id_idx
  on public.organization_catalogs (training_catalog_id);

alter table public.organization_catalogs enable row level security;

drop policy if exists organization_catalogs_select_own_org
  on public.organization_catalogs;
create policy organization_catalogs_select_own_org
  on public.organization_catalogs for select to authenticated
  using (
    organization_id = public.get_user_org_id()
    or public.is_platform_owner()
  );

-- Catalog reads are bound to the caller's organization: a user sees a catalog
-- (and its learning fields and mappings) only if the catalog is active and
-- enabled for the user's organization in organization_catalogs. The platform
-- owner (including SUPER_ADMIN of the platform organization) sees everything.
-- SECURITY DEFINER with a fixed search_path so the check does not depend on the
-- caller's own rights on organization_catalogs; only authenticated may call it.
create or replace function public.can_read_training_catalog(catalog_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_owner()
    or exists (
      select 1
      from public.training_catalogs c
      join public.organization_catalogs oc on oc.training_catalog_id = c.id
      where c.id = catalog_id
        and c.is_active
        and oc.is_enabled
        and oc.organization_id = public.get_user_org_id()
    );
$$;

revoke execute on function public.can_read_training_catalog(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.can_read_training_catalog(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.can_read_training_catalog(uuid) to authenticated;
  end if;
end $$;

drop policy if exists training_catalogs_select_authenticated
  on public.training_catalogs;
create policy training_catalogs_select_authenticated
  on public.training_catalogs for select to authenticated
  using (public.can_read_training_catalog(id));

drop policy if exists training_catalog_learning_fields_select_authenticated
  on public.training_catalog_learning_fields;
create policy training_catalog_learning_fields_select_authenticated
  on public.training_catalog_learning_fields for select to authenticated
  using (public.can_read_training_catalog(training_catalog_id));

drop policy if exists training_catalog_content_mappings_select_authenticated
  on public.training_catalog_content_mappings;
create policy training_catalog_content_mappings_select_authenticated
  on public.training_catalog_content_mappings for select to authenticated
  using (public.can_read_training_catalog(training_catalog_id));

-- Earlier drafts had a write policy for the platform owner; writing is now
-- server side only (privileges below), so no write policy exists.
drop policy if exists organization_catalogs_manage_platform_owner
  on public.organization_catalogs;

-- Read only for the API roles.
-- Writes happen only on the server (role postgres with BYPASSRLS, or
-- service_role); anon and authenticated may only read. Revoked only for roles
-- that exist, so the file also runs on plain PostgreSQL.
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke insert, update, delete, truncate, references, trigger on public.organization_catalogs from %I',
        api_role
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.organization_catalogs from anon;
  end if;
end $$;

-- Backfill: all existing organizations use FIAE (idempotent).
insert into public.organization_catalogs (
  organization_id,
  training_catalog_id,
  is_enabled
)
select o.id, '00000000-0000-4000-8000-000000000001', true
from public.organizations o
on conflict do nothing;

-- New organizations are enabled for FIAE automatically. SECURITY DEFINER so the
-- row is created whatever role (and RLS) creates the organization.
create or replace function public.enable_default_catalog_for_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_catalogs (
    organization_id,
    training_catalog_id,
    is_enabled
  )
  values (new.id, '00000000-0000-4000-8000-000000000001', true)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_enable_default_catalog
  on public.organizations;
create trigger organizations_enable_default_catalog
  after insert on public.organizations
  for each row
  execute function public.enable_default_catalog_for_organization();

comment on table public.organization_catalogs is
  'Training catalogs (occupations) an organization may use. Existing organizations are enabled for FIAE.';
