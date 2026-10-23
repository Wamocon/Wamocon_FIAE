-- Package 2.5 (part 8): platform owner admins become SUPER_ADMIN (E2).
--
-- !!! ROLLOUT GATE (enforced, the file fails while the gate is closed) !!!
-- This file sorts last (20261025000000, after 20261023200000 of PR 89) and only
-- runs when two things are true:
--
--   1. PR 89 is applied: authenticated has no UPDATE privilege on
--      profiles.role (has_column_privilege(...) is false). Otherwise a user
--      could set the new role on their own row through the REST API.
--   2. A human confirmed that the app release that treats SUPER_ADMIN at least
--      like ADMIN is live. Today part of the app checks the role string
--      'ADMIN'; if the backfill ran first, the platform owner admins would lose
--      the admin area until the app is updated. Confirm with:
--        comment on type public.user_role is 'super_admin_backfill=approved';
--      (the comment text is only the approval token, it changes no behaviour).
--
-- While the gate is closed the file raises an exception, so the pipeline stops
-- here instead of recording the file as applied. After the approval the next
-- run applies it. The checks and the update are framed with preview:skip: they
-- inspect and change production roles, Preview has nothing to do here.
--
-- What it does:
--   * profiles with role ADMIN in an organization with is_platform_owner = true
--     become SUPER_ADMIN,
--   * ADMIN in customer organizations stays ADMIN,
--   * TEMP_ADMIN, TRAINER and TRAINEE stay as they are (TEMP_ADMIN keeps its
--     scope of the own organization).
-- With no platform owner organization nothing is changed. A second run changes
-- nothing, because no ADMIN is left in the platform owner organization.
--
-- Rollback: update public.profiles set role = 'ADMIN' where role = 'SUPER_ADMIN';
-- (valid as long as SUPER_ADMIN was only created by this backfill).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- preview:skip
do $$
declare
  owner_org_count integer;
  affected_count integer;
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.oid = 'public.user_role'::regtype
      and e.enumlabel = 'SUPER_ADMIN'
  ) then
    raise exception
      'Enum value SUPER_ADMIN is missing; apply 20261024001500_user_role_super_admin_value.sql first.';
  end if;

  -- Gate 1: PR 89 (column privileges on profiles)
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then
    raise exception
      'Gate closed: authenticated can still update profiles.role. Apply 20261023200000_security_profiles_column_privileges.sql first.';
  end if;

  -- Gate 2: human approval that the SUPER_ADMIN aware app release is live
  if coalesce(obj_description('public.user_role'::regtype, 'pg_type'), '')
       <> 'super_admin_backfill=approved' then
    raise exception
      'Gate closed: the app release that treats SUPER_ADMIN like ADMIN is not confirmed. Deploy it, then run: comment on type public.user_role is ''super_admin_backfill=approved'';';
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

  update public.profiles p
  set role = 'SUPER_ADMIN'
  from public.organizations o
  where o.id = p.organization_id
    and o.is_platform_owner
    and p.role = 'ADMIN';
end $$;
-- preview:end
