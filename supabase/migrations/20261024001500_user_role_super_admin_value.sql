-- Package 2.5 (part 7): new user role SUPER_ADMIN (E2), enum value only.
--
-- The value is added in its own file because a new enum value cannot be used
-- in the transaction that adds it. Nothing in this file uses it; the backfill
-- of the platform owner admins is a later file (20261025000000, gated).
--
-- Adding the value is harmless for the running app: no profile has the role
-- yet. ADMIN in customer organizations and TEMP_ADMIN stay as they are.
--
-- PREREQUISITE: 20261023200000_security_profiles_column_privileges.sql (PR 89)
-- must be applied BEFORE this file. As long as authenticated may update
-- profiles.role, a user could set the new role on their own row through the
-- REST API. The file therefore fails while that privilege exists. This file
-- carries an older version number than 20261023200000, so a fresh pipeline run
-- needs PR 89 applied first (see the runbook); the check enforces it.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- preview:skip
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then
    raise exception
      'Apply 20261023200000_security_profiles_column_privileges.sql first: authenticated can still update profiles.role.';
  end if;
end $$;
-- preview:end

alter type public.user_role add value if not exists 'SUPER_ADMIN';
