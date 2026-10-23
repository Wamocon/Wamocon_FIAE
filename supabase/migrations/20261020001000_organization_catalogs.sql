-- Package 2.5 (part 2): which training catalogs an organization may use.
--
-- organization_catalogs(organization_id, training_catalog_id, is_enabled),
-- primary key over both columns. Backfill: every existing organization is
-- enabled for FIAE, so nothing changes for current customers. New
-- organizations get the FIAE row from a trigger, so organization creation in
-- the app keeps working without code changes.
--
-- RLS follows the pattern of public.organizations: members read the rows of
-- their own organization (get_user_org_id()), only the platform owner changes
-- them.

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
  on public.organization_catalogs for select
  using (
    organization_id = public.get_user_org_id()
    or public.is_platform_owner()
  );

drop policy if exists organization_catalogs_manage_platform_owner
  on public.organization_catalogs;
create policy organization_catalogs_manage_platform_owner
  on public.organization_catalogs for all
  using (public.is_platform_owner());

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
