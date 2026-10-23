-- =============================================================================
-- Preview setup, step 1 of 3: schema, rights and the database role app_preview
-- =============================================================================
-- WHO/WHEN: a human, ONCE, in the Supabase SQL editor (or psql) as the
--           project owner (role postgres). Not run by any workflow.
-- EFFECT:   creates the empty schema public_preview and the login role
--           app_preview. Touches NOTHING in public, auth or storage.
-- ORDER:    01 (this file) -> workflow "Preview Reset" (mode execute) clones the
--           structure of public into public_preview and runs 02 ->
--           03 (verify). No step changes anything in public or auth.
--
-- Idempotent: running it again changes nothing that is already in place.
--
-- NOTHING SECRET in this file. The password of the role is set separately,
-- by hand, and never committed (see the commented statement in section 3).
-- =============================================================================

-- 1. Schema with rights like public (the preview scripts create it too, if it is missing)
create schema if not exists public_preview;
comment on schema public_preview is 'Structural copy of public for Preview deployments';

grant usage on schema public_preview to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public_preview grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public_preview grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public_preview grant all on functions to postgres, anon, authenticated, service_role;

-- 2. The Preview application role
--    - bypassrls: the app connects with Drizzle and does its own authorisation,
--      exactly like the role postgres does for Production. The role has NO
--      rights on public, so bypassing RLS only ever concerns public_preview.
--    - search_path is fixed at ROLE level (more robust than a startup
--      parameter behind the pooler): unqualified table names of Drizzle
--      resolve to public_preview, and only there.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_preview') then
    create role app_preview with login bypassrls;
  end if;
end
$$;

alter role app_preview set search_path = public_preview, extensions;
-- Optional guard rails for a role that runs unreviewed branch code:
alter role app_preview set statement_timeout = '30s';
alter role app_preview set idle_in_transaction_session_timeout = '30s';

-- Lets the project owner manage the role (as in the Supabase guide for custom Drizzle roles)
grant app_preview to postgres;

-- 3. Password (do this by hand, NOT in a file):
--    Generate a long random password in a password manager and run in the SQL editor only:
--      alter role app_preview with password '<long random password>';
--    The Preview connection string in Vercel (environment "Preview") then uses
--    the user name app_preview.<project-ref> on the pooler. Never commit it.

-- 4. Rights: only public_preview (plus the extensions schema for the vector type)
grant usage on schema public_preview to app_preview;
grant all on all tables in schema public_preview to app_preview;
grant all on all sequences in schema public_preview to app_preview;
grant all on all functions in schema public_preview to app_preview;
alter default privileges for role postgres in schema public_preview grant all on tables to app_preview;
alter default privileges for role postgres in schema public_preview grant all on sequences to app_preview;
alter default privileges for role postgres in schema public_preview grant all on functions to app_preview;
grant usage on schema extensions to app_preview;

-- 5. NO rights on public. Production tables carry grants for anon, authenticated
--    and service_role only, so a new role has none; the revokes make it explicit
--    and repeatable. Section 03-verify.sql proves it.
revoke all on all tables in schema public from app_preview;
revoke all on all sequences in schema public from app_preview;
revoke all on all functions in schema public from app_preview;
