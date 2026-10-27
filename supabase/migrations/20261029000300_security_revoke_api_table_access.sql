-- Security hardening: the API roles anon and authenticated get no direct table access.
--
-- Why: the app reads and writes its data on the server (Drizzle as the role
-- postgres, which bypasses row level security). The browser uses supabase-js only
-- for sign in, the own profile row (select, a few own columns update, realtime),
-- the own notifications (realtime) and the storage upload of the own avatar and
-- PDFs. The tables nevertheless carried the Supabase default grants for the API
-- roles. This file reduces anon and authenticated to that documented minimum
-- (defense in depth): without a privilege no policy is ever evaluated, and without
-- a policy a later grant by mistake still gives nothing. Row level security stays
-- enabled on every table.
--
-- Effect (schema public):
--   * all privileges on all tables, views and sequences are revoked from anon and
--     authenticated (column privileges included),
--   * all policies on all tables are dropped, the four below are created,
--   * the default privileges of the migration role no longer grant anything on
--     new tables, sequences and functions to anon and authenticated, so a new
--     table is closed until a migration opens it on purpose,
--   * EXECUTE on the functions of the app (not on extension functions such as
--     pgvector) is revoked from PUBLIC, anon and authenticated and granted to
--     service_role (the owner keeps it). Triggers keep working, trigger
--     functions are not checked at run time,
--   * row level security is enabled on every table that still lacks it.
-- What the browser keeps (documented minimum, guarded by
-- tests/unit/security/browser-db-access.test.ts):
--   profiles       select (own row), update of full_name, avatar_url, birth_date,
--                  start_of_training_date, updated_at (own row; role, organization,
--                  activation stay protected by the trigger of 20261023300000)
--   notifications  select (own rows), needed by the realtime subscription
--   organizations  select of id, name, slug, subscription_plan, is_platform_owner,
--                  is_active (own organization), embedded in the profile query
-- The roles postgres, service_role and the Preview roles are not touched.
--
-- Needs the profile protection trigger (20261023300000, 20261023300100) and checks
-- for it at the end; the other hardening files of 20261023* are not required, their
-- policies are dropped here anyway. Safe to run twice. If the file stops with a lock
-- timeout nothing was changed, run it again. Before
-- the first change the old grants, policies and function rights are written to
-- public.rls_lockdown_backup (only the first run saves, the table is closed for
-- the API roles). The table is dropped by hand when the rollback window is over.
--
-- Not covered here (needs rights a migration does not have, or other work):
--   * storage policies and the bucket flags (supabase/manual/20261029_storage_policies_v2.sql),
--   * default privileges of the role supabase_admin (not ours to change),
--   * the built-in EXECUTE grant to PUBLIC of functions created later: a new
--     function needs its own "revoke execute ... from public" (see
--     supabase/manual/verify-rls-lockdown.sql, check 5).
--
-- Rollout: gated like the whole series (20261024000100 and newer, see
-- scripts/db/rollout-gate.mjs). Check before and after with
-- supabase/manual/verify-rls-lockdown.sql.
--
-- Undo: run supabase/manual/rollback-rls-lockdown.sql (restores grants, policies
-- and function rights from public.rls_lockdown_backup). By hand, quick and
-- coarse (reopens the Supabase default, policies are then missing):
--   grant all on all tables in schema public to anon, authenticated;
--   alter default privileges in schema public grant all on tables to anon, authenticated;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. New objects start closed (the backup table below must not inherit grants).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
    alter default privileges in schema public revoke execute on functions from anon, authenticated;
  end if;
end $$;

-- A default privilege entry of the migration role that is not bound to a schema is added
-- to the schema entry above, so it is closed as well (Production only: default
-- privileges without a schema apply to every schema and are not part of the Preview
-- copy, the Preview roles use schema entries only).
-- preview:skip
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated')
     and exists (
       select 1 from pg_default_acl d
       where d.defaclrole = (select r.oid from pg_roles r where r.rolname = current_user)
         and d.defaclnamespace = 0
         and d.defaclobjtype in ('r', 'S')
     ) then
    alter default privileges revoke all on tables from anon, authenticated;
    alter default privileges revoke all on sequences from anon, authenticated;
  end if;
end $$;
-- preview:end

-- 2. Backup of what is removed (first run only).
create table if not exists public.rls_lockdown_backup (
  kind text not null,
  object text not null,
  detail jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (kind, object)
);
alter table public.rls_lockdown_backup enable row level security;
comment on table public.rls_lockdown_backup is
  'Grants, policies and function rights removed by 20261029000300; used by supabase/manual/rollback-rls-lockdown.sql. Drop after the rollback window.';

do $$
begin
  if exists (select 1 from public.rls_lockdown_backup) then
    return;
  end if;

  -- table level privileges of anon and authenticated (tables, views)
  insert into public.rls_lockdown_backup (kind, object, detail)
  select 'privilege', c.relname || ':' || g.grantee,
         jsonb_build_object('relation', c.relname, 'role', g.grantee, 'privileges', jsonb_agg(g.priv order by g.priv))
  from pg_class c
  cross join lateral (
    select r.rolname::text as grantee, a.privilege_type::text as priv
    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    join pg_roles r on r.oid = a.grantee
    where r.rolname in ('anon', 'authenticated')
  ) g
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
  group by c.relname, g.grantee;

  -- column level privileges
  insert into public.rls_lockdown_backup (kind, object, detail)
  select 'column_privilege', c.relname || '.' || a.attname || ':' || r.rolname,
         jsonb_build_object('relation', c.relname, 'column', a.attname, 'role', r.rolname::text,
                            'privileges', jsonb_agg(x.privilege_type::text order by x.privilege_type))
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  cross join lateral aclexplode(a.attacl) x
  join pg_roles r on r.oid = x.grantee
  where c.relnamespace = 'public'::regnamespace
    and a.attnum > 0 and not a.attisdropped
    and r.rolname in ('anon', 'authenticated')
  group by c.relname, a.attname, r.rolname;

  -- sequences
  insert into public.rls_lockdown_backup (kind, object, detail)
  select 'sequence_privilege', c.relname || ':' || g.grantee,
         jsonb_build_object('relation', c.relname, 'role', g.grantee, 'privileges', jsonb_agg(g.priv order by g.priv))
  from pg_class c
  cross join lateral (
    select r.rolname::text as grantee, a.privilege_type::text as priv
    from aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
    join pg_roles r on r.oid = a.grantee
    where r.rolname in ('anon', 'authenticated')
  ) g
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'S'
  group by c.relname, g.grantee;

  -- EXECUTE on the functions of the app (PUBLIC, anon, authenticated)
  insert into public.rls_lockdown_backup (kind, object, detail)
  select 'function_privilege', p.oid::regprocedure::text || ':' || coalesce(r.rolname::text, 'PUBLIC'),
         jsonb_build_object('function', p.oid::regprocedure::text, 'role', coalesce(r.rolname::text, 'PUBLIC'))
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
  left join pg_roles r on r.oid = x.grantee
  where p.pronamespace = 'public'::regnamespace
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and x.privilege_type = 'EXECUTE'
    and (x.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  on conflict do nothing;

  -- policies
  insert into public.rls_lockdown_backup (kind, object, detail)
  select 'policy', c.relname || '.' || pol.polname,
         jsonb_build_object(
           'relation', c.relname,
           'name', pol.polname,
           'permissive', pol.polpermissive,
           'command', pol.polcmd,
           'roles', (select coalesce(jsonb_agg(coalesce(r.rolname::text, 'PUBLIC')), '[]'::jsonb)
                     from unnest(pol.polroles) u(oid)
                     left join pg_roles r on r.oid = u.oid),
           'using', pg_get_expr(pol.polqual, pol.polrelid),
           'check', pg_get_expr(pol.polwithcheck, pol.polrelid))
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where c.relnamespace = 'public'::regnamespace;

  -- tables without row level security
  insert into public.rls_lockdown_backup (kind, object, detail)
  select 'no_rls', c.relname, jsonb_build_object('relation', c.relname)
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and c.relname <> 'rls_lockdown_backup';
end $$;

-- 3. The lockdown.
do $$
declare
  z record;
begin
  if not (exists (select 1 from pg_roles where rolname = 'anon')
          and exists (select 1 from pg_roles where rolname = 'authenticated')) then
    return;
  end if;

  -- row level security on every table (second line of defence)
  for z in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', z.relname);
  end loop;

  -- no policy survives, a later grant by mistake then gives nothing
  for z in
    select pol.polname, c.relname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relnamespace = 'public'::regnamespace
  loop
    execute format('drop policy %I on public.%I', z.polname, z.relname);
  end loop;

  revoke all on all tables in schema public from anon, authenticated;
  revoke all on all sequences in schema public from anon, authenticated;

  -- functions of the app (extension functions such as pgvector stay as they are)
  for z in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on routine %s from public, anon, authenticated', z.signature);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on routine %s to service_role', z.signature);
    end if;
  end loop;

  -- the documented minimum of the browser
  if to_regclass('public.profiles') is not null then
    grant select on table public.profiles to authenticated;
    grant update (full_name, avatar_url, birth_date, start_of_training_date, updated_at)
      on table public.profiles to authenticated;
    create policy profiles_select_own on public.profiles
      for select to authenticated
      using (id = (select auth.uid()));
    create policy profiles_update_own on public.profiles
      for update to authenticated
      using (id = (select auth.uid()))
      with check (id = (select auth.uid()));
  end if;

  if to_regclass('public.notifications') is not null then
    grant select on table public.notifications to authenticated;
    create policy notifications_select_own on public.notifications
      for select to authenticated
      using (user_id = (select auth.uid()));
  end if;

  if to_regclass('public.organizations') is not null and to_regclass('public.profiles') is not null then
    grant select (id, name, slug, subscription_plan, is_platform_owner, is_active)
      on table public.organizations to authenticated;
    create policy organizations_select_own on public.organizations
      for select to authenticated
      using (id in (select p.organization_id from public.profiles p where p.id = (select auth.uid())));
  end if;
end $$;

-- 4. Proof: the file stops (and rolls back) if anything is left open.
do $$
declare
  leftover text;
begin
  if not (exists (select 1 from pg_roles where rolname = 'anon')
          and exists (select 1 from pg_roles where rolname = 'authenticated')) then
    return;
  end if;

  -- table level privileges (also those of views)
  select string_agg(distinct c.relname || ' ' || coalesce(r.rolname::text, 'PUBLIC') || ' ' || x.privilege_type, ', ')
  into leftover
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
  left join pg_roles r on r.oid = x.grantee
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (x.grantee = 0 or r.rolname in ('anon', 'authenticated'))
    and (coalesce(r.rolname::text, 'PUBLIC'), c.relname, x.privilege_type) not in (
      ('authenticated', 'profiles', 'SELECT'),
      ('authenticated', 'notifications', 'SELECT'));
  if leftover is not null then
    raise exception 'RLS lockdown incomplete, privileges left: %', leftover;
  end if;

  -- column level privileges
  select string_agg(distinct c.relname || '.' || a.attname || ' ' || coalesce(r.rolname::text, 'PUBLIC') || ' ' || x.privilege_type, ', ')
  into leftover
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  cross join lateral aclexplode(a.attacl) x
  left join pg_roles r on r.oid = x.grantee
  where c.relnamespace = 'public'::regnamespace
    and a.attnum > 0 and not a.attisdropped
    and (x.grantee = 0 or r.rolname in ('anon', 'authenticated'))
    and (c.relname, a.attname, coalesce(r.rolname::text, 'PUBLIC'), x.privilege_type) not in (
      ('profiles', 'full_name', 'authenticated', 'UPDATE'),
      ('profiles', 'avatar_url', 'authenticated', 'UPDATE'),
      ('profiles', 'birth_date', 'authenticated', 'UPDATE'),
      ('profiles', 'start_of_training_date', 'authenticated', 'UPDATE'),
      ('profiles', 'updated_at', 'authenticated', 'UPDATE'),
      ('organizations', 'id', 'authenticated', 'SELECT'),
      ('organizations', 'name', 'authenticated', 'SELECT'),
      ('organizations', 'slug', 'authenticated', 'SELECT'),
      ('organizations', 'subscription_plan', 'authenticated', 'SELECT'),
      ('organizations', 'is_platform_owner', 'authenticated', 'SELECT'),
      ('organizations', 'is_active', 'authenticated', 'SELECT'));
  if leftover is not null then
    raise exception 'RLS lockdown incomplete, column privileges left: %', leftover;
  end if;

  -- rights through a role membership are invisible to the lists above (PUBLIC is in them)
  select string_agg(c.relname || ' ' || r.rolname, ', ')
  into leftover
  from pg_class c
  cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege(r.rolname, c.oid,
           case when c.relname in ('profiles', 'notifications')
                then 'INSERT, UPDATE, DELETE, REFERENCES, TRIGGER'
                else 'SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER' end)
         or has_any_column_privilege(r.rolname, c.oid,
           case c.relname when 'profiles' then 'INSERT, REFERENCES'
                          when 'organizations' then 'INSERT, UPDATE, REFERENCES'
                          when 'notifications' then 'INSERT, UPDATE, REFERENCES'
                          else 'SELECT, INSERT, UPDATE, REFERENCES' end));
  if leftover is not null then
    raise exception 'RLS lockdown incomplete, privileges through a role membership left: %', leftover;
  end if;

  select string_agg(c.relname || ' ' || r.role, ', ')
  into leftover
  from pg_class c
  cross join (values ('anon'), ('authenticated')) as r(role)
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'S'
    and (has_sequence_privilege(r.role, c.oid, 'USAGE')
         or has_sequence_privilege(r.role, c.oid, 'SELECT')
         or has_sequence_privilege(r.role, c.oid, 'UPDATE'));
  if leftover is not null then
    raise exception 'RLS lockdown incomplete, sequence privileges left: %', leftover;
  end if;

  select string_agg(p.oid::regprocedure::text || ' ' || r.role, ', ')
  into leftover
  from pg_proc p
  cross join (values ('anon'), ('authenticated')) as r(role)
  where p.pronamespace = 'public'::regnamespace
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege(r.role, p.oid, 'EXECUTE');
  if leftover is not null then
    raise exception 'RLS lockdown incomplete, EXECUTE left: %', leftover;
  end if;

  select string_agg(c.relname || '.' || pol.polname, ', ')
  into leftover
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where c.relnamespace = 'public'::regnamespace
    and (c.relname, pol.polname) not in (
      ('profiles', 'profiles_select_own'),
      ('profiles', 'profiles_update_own'),
      ('notifications', 'notifications_select_own'),
      ('organizations', 'organizations_select_own'));
  if leftover is not null then
    raise exception 'RLS lockdown incomplete, policies left: %', leftover;
  end if;

  -- new tables and sequences of this role start without a grant for the API roles
  select string_agg(distinct d.defaclobjtype::text, ', ')
  into leftover
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) x
  left join pg_roles r on r.oid = x.grantee
  where d.defaclrole = (select o.oid from pg_roles o where o.rolname = current_user)
    and (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
    and d.defaclobjtype in ('r', 'S')
    and (x.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if leftover is not null then
    raise exception 'RLS lockdown incomplete, default privileges still give the API roles access, object types: %', leftover;
  end if;

  -- the minimum of profiles rests on the column privileges and on this trigger
  if to_regclass('public.profiles') is not null
     and not exists (
       select 1 from pg_trigger t
       where t.tgrelid = 'public.profiles'::regclass
         and t.tgname = 'profiles_protect_columns'
         and not t.tgisinternal
     ) then
    raise exception 'The trigger profiles_protect_columns is missing, apply 20261023300000 and 20261023300100 first';
  end if;
end $$;
