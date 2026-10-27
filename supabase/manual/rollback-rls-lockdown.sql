-- Rollback of supabase/migrations/20261029000300_security_revoke_api_table_access.sql.
-- RUN BY A HUMAN, only if the lockdown breaks something that cannot be fixed forward.
--
-- What it does: restores the grants, policies, row level security flags and function
-- rights that the migration saved in public.rls_lockdown_backup before it changed
-- anything, and re-opens the default privileges for anon and authenticated. The
-- four policies of the lockdown are dropped first (their old twins come back from
-- the backup where the name was used before). The backup table is kept, drop it
-- by hand when the rollback window is over:
--   drop table public.rls_lockdown_backup;
--
-- Run it in the Supabase SQL editor as the project owner (role postgres), in one go.
-- The file stops with an error and changes nothing if the backup is missing or empty.
-- It can be run twice.
--
-- The default privileges are reopened as the Supabase default (all privileges for
-- anon and authenticated on new tables, sequences and functions); tables created after
-- the lockdown stay without grants. The backup keeps the state of the FIRST run of the
-- migration: if you apply the migration again after a rollback and the state has
-- changed in between, drop public.rls_lockdown_backup before applying it again.
--
-- After the rollback run supabase/manual/verify-rls-lockdown.sql to see the state.
-- A rollback reopens the REST path to the tables (that is its purpose). Do it
-- only for as long as the cause is being fixed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions;

do $$
declare
  z record;
  roles_sql text;
  stmt text;
begin
  if to_regclass('public.rls_lockdown_backup') is null
     or not exists (select 1 from public.rls_lockdown_backup) then
    raise exception 'public.rls_lockdown_backup is missing or empty, nothing to restore';
  end if;

  -- default privileges as before
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;

  -- policies: drop everything that exists now, then restore the saved ones
  for z in
    select pol.polname, c.relname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname <> 'rls_lockdown_backup'
  loop
    execute format('drop policy %I on public.%I', z.polname, z.relname);
  end loop;

  for z in select detail from public.rls_lockdown_backup where kind = 'policy' order by object loop
    if to_regclass('public.' || quote_ident(z.detail ->> 'relation')) is null then
      raise notice 'skipped (relation gone): policy % on %', z.detail ->> 'name', z.detail ->> 'relation';
      continue;
    end if;
    select string_agg(case when r = 'PUBLIC' then 'public' else quote_ident(r) end, ', ')
    into roles_sql
    from jsonb_array_elements_text(z.detail -> 'roles') r;
    stmt := format('create policy %I on public.%I as %s for %s to %s',
      z.detail ->> 'name',
      z.detail ->> 'relation',
      case when (z.detail ->> 'permissive')::boolean then 'permissive' else 'restrictive' end,
      case z.detail ->> 'command'
        when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all'
      end,
      coalesce(roles_sql, 'public'));
    if z.detail ->> 'using' is not null then
      stmt := stmt || ' using (' || (z.detail ->> 'using') || ')';
    end if;
    if z.detail ->> 'check' is not null then
      stmt := stmt || ' with check (' || (z.detail ->> 'check') || ')';
    end if;
    execute stmt;
  end loop;

  -- tables that had no row level security before
  for z in select detail from public.rls_lockdown_backup where kind = 'no_rls' loop
    execute format('alter table public.%I disable row level security', z.detail ->> 'relation');
  end loop;

  -- table, column and sequence privileges: clear the lockdown state, then restore
  revoke all on all tables in schema public from anon, authenticated;
  revoke all on all sequences in schema public from anon, authenticated;

  -- items whose table, column or function is gone since (a later migration) are skipped and reported
  for z in select detail from public.rls_lockdown_backup where kind = 'privilege' order by object loop
    if to_regclass('public.' || quote_ident(z.detail ->> 'relation')) is null then
      raise notice 'skipped (relation gone): %', z.detail ->> 'relation';
      continue;
    end if;
    execute format('grant %s on table public.%I to %I',
      (select string_agg(p, ', ') from jsonb_array_elements_text(z.detail -> 'privileges') p),
      z.detail ->> 'relation', z.detail ->> 'role');
  end loop;

  for z in select detail from public.rls_lockdown_backup where kind = 'column_privilege' order by object loop
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || quote_ident(z.detail ->> 'relation'))
        and a.attname = z.detail ->> 'column' and not a.attisdropped
    ) then
      raise notice 'skipped (column gone): %.%', z.detail ->> 'relation', z.detail ->> 'column';
      continue;
    end if;
    execute format('grant %s (%I) on table public.%I to %I',
      (select string_agg(p, ', ') from jsonb_array_elements_text(z.detail -> 'privileges') p),
      z.detail ->> 'column', z.detail ->> 'relation', z.detail ->> 'role');
  end loop;

  for z in select detail from public.rls_lockdown_backup where kind = 'sequence_privilege' order by object loop
    if to_regclass('public.' || quote_ident(z.detail ->> 'relation')) is null then
      raise notice 'skipped (sequence gone): %', z.detail ->> 'relation';
      continue;
    end if;
    execute format('grant %s on sequence public.%I to %I',
      (select string_agg(p, ', ') from jsonb_array_elements_text(z.detail -> 'privileges') p),
      z.detail ->> 'relation', z.detail ->> 'role');
  end loop;

  -- EXECUTE on the functions as before (PUBLIC, anon, authenticated)
  for z in select detail from public.rls_lockdown_backup where kind = 'function_privilege' order by object loop
    if to_regprocedure(z.detail ->> 'function') is null then
      raise notice 'skipped (function gone): %', z.detail ->> 'function';
      continue;
    end if;
    execute format('grant execute on routine %s to %s',
      z.detail ->> 'function',
      case when z.detail ->> 'role' = 'PUBLIC' then 'public' else quote_ident(z.detail ->> 'role') end);
  end loop;
end $$;

commit;
