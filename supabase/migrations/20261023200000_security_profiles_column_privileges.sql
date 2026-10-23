-- Security fix: no self-service privilege escalation through public.profiles.
--
-- Measured read-only on production on 2026-10-23:
--   - Policy profiles_update_own: USING (id = auth.uid()) for the role public,
--     no WITH CHECK.
--   - The roles anon and authenticated hold the privilege UPDATE on EVERY column
--     of public.profiles (role, organization_id, is_active, trainer_activated,
--     assigned_trainer_id, email, ...), and the table has no trigger.
--   - Sign-up is open and needs no e-mail confirmation.
-- Result: anyone can register and then change the own row through the REST API
-- with the own session, for example role = 'ADMIN' or organization_id = the
-- platform owner. The server routes read the role from this table, so this gives
-- full admin access. Six accounts exist, none younger than 30 days, so there is
-- no sign of abuse, but the logs were not available.
--
-- What the client really writes (src/contexts/AuthContext.tsx updateProfile):
--   full_name, avatar_url, birth_date, start_of_training_date, assigned_trainer_id,
--   updated_at. The function switchRole wrote role from the browser, no component
--   calls it, it is removed in the same pull request.
-- Everything else (role, organization, activation, e-mail, training duration) is
-- written on the server (Drizzle as role postgres, or the service role), both
-- bypass these privileges.
--
-- Effect: anon loses UPDATE on profiles completely, authenticated keeps UPDATE on
-- the six columns above only, and the policy gets a WITH CHECK and is limited to
-- authenticated. No data is changed.
--
-- Undo (only if something breaks):
--   grant update on table public.profiles to anon, authenticated;
--   drop policy profiles_update_own on public.profiles;
--   create policy profiles_update_own on public.profiles for update to public using (id = auth.uid());

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.profiles') is not null then
    revoke update on table public.profiles from anon, authenticated;
    grant update (
      full_name,
      avatar_url,
      birth_date,
      start_of_training_date,
      assigned_trainer_id,
      updated_at
    ) on table public.profiles to authenticated;

    drop policy if exists profiles_update_own on public.profiles;
    create policy profiles_update_own on public.profiles
      for update to authenticated
      using (id = auth.uid())
      with check (id = auth.uid());
  end if;
end $$;
