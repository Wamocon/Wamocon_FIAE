-- =============================================================================
-- Preview setup, step 1 of 4: schemas, rights and the two Preview database roles
-- =============================================================================
-- WHO/WHEN: a human, ONCE, in the Supabase SQL editor (or psql) as the
--           project owner (role postgres). Not run by any workflow.
-- EFFECT:   creates the schemas public_preview and preview_meta and the login
--           roles app_preview (runtime of the Preview app) and
--           app_preview_migrator (migrations of unreviewed branches in CI).
--           Touches NOTHING in public, auth or storage.
-- ORDER:    01 (this file) -> set the two passwords by hand -> workflow
--           "Preview Reset" (mode execute) clones the structure of public into
--           public_preview and runs 02 -> 03 (human, shared objects) ->
--           04 (verify). No step changes anything in public or auth.
--
-- Idempotent: running it again changes nothing that is already in place.
--
-- NOTHING SECRET in this file. The passwords of the roles are set separately,
-- by hand, and never committed (see section 3).
--
-- THE TWO ROLES AND WHY
--   app_preview            runtime of the Preview deployment (Drizzle, search_path
--                          public_preview). Needs BYPASSRLS like postgres does for
--                          Production, because the app authorises itself. It has no
--                          rights on public.
--   app_preview_migrator   runs the (rewritten) SQL of unreviewed branches. It is
--                          the SECURITY BOUNDARY of the Preview pipeline: it owns
--                          public_preview and preview_meta, it has no rights on
--                          public, auth, storage or any other schema, it has no
--                          BYPASSRLS, no CREATEROLE, no CREATEDB, is no superuser
--                          and has no role memberships. Its connection string is
--                          the secret PREVIEW_DB_URL of the GitHub environment
--                          "Preview". The Production access token never enters a
--                          Preview job.
-- =============================================================================

-- 1. Schemas
create schema if not exists public_preview;
comment on schema public_preview is 'Structural copy of public for Preview deployments';
-- Ledger of the Preview migrations (kept apart from supabase_migrations, which the
-- migration role must not see)
create schema if not exists preview_meta;
comment on schema preview_meta is 'Migration history of public_preview';

-- 2. The migration role (the security boundary, see above)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_preview_migrator') then
    create role app_preview_migrator with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 5;
  end if;
end
$$;
-- The attributes are fixed when the role is created. ALTER ROLE must NOT name SUPERUSER or
-- NOSUPERUSER: PostgreSQL then demands the SUPERUSER attribute of the caller, and the Supabase
-- role postgres has none (permission denied to alter role). So the attributes are not
-- re-applied here, they are ASSERTED instead. A role that exists with other attributes (for
-- example created by hand) stops the script instead of being used as the security boundary.
alter role app_preview_migrator with connection limit 5;
do $$
begin
  if exists (
    select 1 from pg_roles
     where rolname = 'app_preview_migrator'
       and (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolinherit or not rolcanlogin)
  ) then
    raise exception 'app_preview_migrator exists with unexpected attributes (must be: login, nosuperuser, nocreatedb, nocreaterole, noinherit, nobypassrls). Drop and recreate it, or fix it as a superuser.';
  end if;
end
$$;
alter role app_preview_migrator set search_path = public_preview, extensions;
alter role app_preview_migrator set statement_timeout = '300s';
alter role app_preview_migrator set idle_in_transaction_session_timeout = '60s';
alter role app_preview_migrator set lock_timeout = '30s';

-- lets the project owner transfer the ownership of the schemas below; the migration role itself gets no membership
grant app_preview_migrator to postgres;
alter schema public_preview owner to app_preview_migrator;
alter schema preview_meta owner to app_preview_migrator;

-- The vector type and friends live in the extensions schema
grant usage on schema extensions to app_preview_migrator;

-- NO rights on public, auth, storage (what PUBLIC grants to everybody is checked in 04-verify.sql)
revoke all on schema public from app_preview_migrator;
revoke all on schema auth from app_preview_migrator;
revoke all on schema storage from app_preview_migrator;
revoke all on all tables in schema public from app_preview_migrator;
revoke all on all sequences in schema public from app_preview_migrator;
revoke all on all functions in schema public from app_preview_migrator;

-- 3. The Preview application role
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
-- Guard rails for a role that runs the Preview app
alter role app_preview set statement_timeout = '30s';
alter role app_preview set idle_in_transaction_session_timeout = '30s';

-- Lets the project owner manage the role (as in the Supabase guide for custom Drizzle roles)
grant app_preview to postgres;

-- Passwords (do this by hand, NOT in a file). Generate two long random passwords in a
-- password manager and run in the SQL editor only:
--   alter role app_preview          with password '<long random password>';
--   alter role app_preview_migrator with password '<another long random password>';
-- Then
--   * Vercel (environment Preview): DB_CONNECTION_STRING with the user
--     app_preview.<project-ref> on the pooler,
--   * GitHub (environment Preview): secret PREVIEW_DB_URL with the user
--     app_preview_migrator.<project-ref> on the session pooler (port 5432).
-- Never commit them.

-- 4. Rights of the objects the migration role creates in public_preview.
--    The migration role owns them; the API roles and the app role get access
--    through default privileges, so a new table needs no extra grant.
grant usage on schema public_preview to postgres, anon, authenticated, service_role, app_preview;
grant usage on schema extensions to app_preview;
alter default privileges for role app_preview_migrator in schema public_preview grant all on tables to postgres, anon, authenticated, service_role, app_preview;
alter default privileges for role app_preview_migrator in schema public_preview grant all on sequences to postgres, anon, authenticated, service_role, app_preview;
alter default privileges for role app_preview_migrator in schema public_preview grant all on functions to postgres, anon, authenticated, service_role, app_preview;
-- Functions created by the migration role get no EXECUTE for PUBLIC (a SECURITY DEFINER
-- function must not be callable by everybody). Global form on purpose: schema scoped
-- default privileges cannot remove the built-in default of PUBLIC. The role can only
-- create objects in public_preview and preview_meta.
alter default privileges for role app_preview_migrator revoke execute on functions from public;
-- Rights on what exists already (a no-op on a fresh schema)
grant all on all tables in schema public_preview to postgres, anon, authenticated, service_role, app_preview;
grant all on all sequences in schema public_preview to postgres, anon, authenticated, service_role, app_preview;
grant all on all functions in schema public_preview to postgres, anon, authenticated, service_role, app_preview;

-- 5. NO rights on public for the app role. Production tables carry grants for anon,
--    authenticated and service_role only, so a new role has none; the revokes make
--    it explicit and repeatable. 04-verify.sql proves it.
revoke all on all tables in schema public from app_preview;
revoke all on all sequences in schema public from app_preview;
revoke all on all functions in schema public from app_preview;
