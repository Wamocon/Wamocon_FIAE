-- Package 2.5 (part 8): platform owner admins become SUPER_ADMIN (E2).
--
-- !!! ROLLOUT GATE !!!
-- Apply this file ONLY AFTER the app release that understands the role
-- SUPER_ADMIN (permission checks for 'ADMIN' also accepting 'SUPER_ADMIN') is
-- live. Today the app checks the role string 'ADMIN'. If this file runs first,
-- the platform owner admins are no longer recognised as admins and lose access
-- to the admin area until the app is updated. Hold this file back (do not push
-- it to the target database) until that release is deployed.
--
-- What it does:
--   * profiles with role ADMIN in an organization with is_platform_owner = true
--     become SUPER_ADMIN,
--   * ADMIN in customer organizations stays ADMIN,
--   * TEMP_ADMIN, TRAINER and TRAINEE stay as they are (TEMP_ADMIN keeps its
--     scope of the own organization).
-- Precheck: the enum value must exist and the number of affected profiles is
-- reported. With no platform owner organization (for example in a preview
-- database) nothing is changed. A second run changes nothing, because no ADMIN
-- is left in the platform owner organization.
--
-- Rollback: update public.profiles set role = 'ADMIN' where role = 'SUPER_ADMIN';
-- (valid as long as SUPER_ADMIN was only created by this backfill).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  owner_org_count integer;
  affected_count integer;
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'SUPER_ADMIN'
  ) then
    raise exception
      'Enum value SUPER_ADMIN is missing; apply 20261020001500_user_role_super_admin_value.sql first.';
  end if;

  select count(*) into owner_org_count
  from public.organizations o
  where o.is_platform_owner;

  select count(*) into affected_count
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where o.is_platform_owner
    and p.role = 'ADMIN';

  raise notice
    'SUPER_ADMIN backfill: % platform owner organization(s), % ADMIN profile(s) will become SUPER_ADMIN.',
    owner_org_count, affected_count;
end $$;

update public.profiles p
set role = 'SUPER_ADMIN'
from public.organizations o
where o.id = p.organization_id
  and o.is_platform_owner
  and p.role = 'ADMIN';
