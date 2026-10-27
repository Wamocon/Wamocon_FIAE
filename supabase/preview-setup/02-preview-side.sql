-- =============================================================================
-- Preview setup, step 2 of 4: finishing touches inside public_preview
-- =============================================================================
-- WHO/WHEN: run automatically by scripts/db/preview-migrate.mjs (rebuild, i.e.
--           the workflow "Preview Reset") right after the structure of public
--           was cloned into public_preview. Runs as the role
--           app_preview_migrator, so it can only touch public_preview.
--           IDEMPOTENT.
-- EFFECT:   (1) fixes the search_path of the RLS helper functions in
--           public_preview, (2) takes EXECUTE on SECURITY DEFINER functions away
--           from PUBLIC (only the API roles and the app role keep it), (3) grants
--           the app role access to what the clone created.
--           Never changes a Production object, never touches auth or storage.
--
-- Not in here (needs rights the migration role does not have, see 03):
-- realtime membership and storage policies.
--
-- No auth trigger is needed: auth.users has no trigger, profiles are created by
-- /api/auth/sync-profile in the schema the deployment is connected to. So a user
-- who signs in from Preview gets the profile in public_preview, and nothing on the
-- auth side has to be created or changed.
-- =============================================================================

-- 1. Helper functions of the Preview schema with a fixed search_path.
--    They exist after the structure clone (rewritten copies of the public ones).
do $$
begin
  if to_regprocedure('public_preview.get_user_org_id()') is not null then
    execute 'alter function public_preview.get_user_org_id() set search_path = public_preview, pg_temp';
  end if;
  if to_regprocedure('public_preview.is_platform_owner()') is not null then
    execute 'alter function public_preview.is_platform_owner() set search_path = public_preview, pg_temp';
  end if;
end
$$;

-- 2. SECURITY DEFINER functions of public_preview are not executable by PUBLIC.
--    The API roles anon and authenticated get no EXECUTE (no policy of the lockdown
--    migration 20261029000300 calls a helper), service_role and the app role keep it.
--    (The default privileges of the migration role already avoid the PUBLIC grant
--    for new functions, this covers whatever came with the clone.)
do $$
declare
  z record;
begin
  for z in
    select p.oid::regprocedure::text as signature
      from pg_proc p
     where p.pronamespace = 'public_preview'::regnamespace and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', z.signature);
    execute format('grant execute on function %s to postgres, service_role', z.signature);
    if exists (select 1 from pg_roles where rolname = 'app_preview') then
      execute format('grant execute on function %s to app_preview', z.signature);
    end if;
  end loop;
end
$$;

-- 3. Make the new objects reachable for the Preview app role (a no-op while the role does not exist)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_preview') then
    execute 'grant usage on schema public_preview to app_preview';
    execute 'grant all on all tables in schema public_preview to app_preview';
    execute 'grant all on all sequences in schema public_preview to app_preview';
  end if;
end
$$;
