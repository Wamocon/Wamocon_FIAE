-- Read-only check of the API access state (supabase/migrations/20261029000300_security_revoke_api_table_access.sql
-- and supabase/manual/20261029_storage_policies_v2.sql).
-- Run it in the Supabase SQL editor BEFORE and AFTER the rollout and keep both outputs.
-- It contains only SELECT statements, nothing is changed. The SQL editor shows only
-- the result of the LAST statement, so run the checks one by one (select the text
-- of one check and run the selection).
--
-- EXPECTED AFTER the migration (the state before differs, that is the point):
--   check 1  0 rows
--   check 2  0 rows for anon; for authenticated exactly four rows:
--            notifications SELECT, organizations SELECT, profiles SELECT, profiles UPDATE
--   check 3  4 rows: notifications_select_own, organizations_select_own,
--            profiles_select_own, profiles_update_own (all roles = authenticated)
--   check 4  0 rows
--   check 5  0 rows (a function that shows up here was created after the migration
--            without "revoke execute on function ... from public, anon, authenticated")
--   check 6  no anon, authenticated or PUBLIC in the acl of the postgres rows for tables and
--            sequences, in scope public and in scope "all schemas" (the rows of the role
--            supabase_admin keep them, that is the Supabase platform default and only
--            concerns objects created by that role)
--   check 7  0 rows
--   check 8  five columns: avatar_url, birth_date, full_name, start_of_training_date, updated_at
--            (never role, organization_id, is_active, trainer_activated, email)
--   check 9  (after the storage template) the bucket policies are the own-folder
--            policies (and the *_preview policies of the Preview setup); none with the
--            role public or anon on the buckets content and avatar
--   check 10 content: public = true (stays until the app serves signed URLs, see the storage
--            template), avatar: public = true
--   check 11 rows for the kinds policy, privilege, column_privilege, function_privilege
--            (the backup of the migration). BEFORE the migration this check fails with
--            "relation public.rls_lockdown_backup does not exist": that is expected
--   check 12 informational: views and their security_invoker flag
--   check 13 informational: tables in the realtime publication (profiles and notifications
--            must stay in it, the browser listens to them)

-- check 1: tables of public without row level security
select c.relname as table_without_rls
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by c.relname;

-- check 2: privileges of anon and authenticated on tables and views (column privileges included)
select c.relname as relation, r.role, p.priv as privilege,
       has_table_privilege(r.role, c.oid, p.priv) as table_level
from pg_class c
cross join (values ('anon'), ('authenticated')) as r(role)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and (has_table_privilege(r.role, c.oid, p.priv)
       or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
           and has_any_column_privilege(r.role, c.oid, p.priv)))
order by r.role, c.relname, p.priv;

-- check 3: all policies of public
select c.relname as table_name, pol.polname as policy,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as command,
       (select string_agg(coalesce(r.rolname::text, 'public'), ', ') from unnest(pol.polroles) u(oid) left join pg_roles r on r.oid = u.oid) as roles,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expression
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
where c.relnamespace = 'public'::regnamespace
order by c.relname, pol.polname;

-- check 4: policies that apply to public or anon
select c.relname as table_name, pol.polname as policy
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
where c.relnamespace = 'public'::regnamespace
  and (0 = any (pol.polroles)
       or exists (select 1 from pg_roles r where r.oid = any (pol.polroles) and r.rolname = 'anon'))
order by c.relname, pol.polname;

-- check 5: functions of the app (no extension members, such as pgvector) that anon, authenticated or PUBLIC may execute
select p.oid::regprocedure::text as function_signature, r.role as who
from pg_proc p
cross join (values ('anon'), ('authenticated')) as r(role)
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege(r.role, p.oid, 'EXECUTE')
order by 1, 2;

-- check 6: default privileges for new objects (schema public and the ones that apply to every schema)
select pg_get_userbyid(d.defaclrole) as for_role,
       case when d.defaclnamespace = 0 then 'all schemas' else d.defaclnamespace::regnamespace::text end as scope,
       case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' else d.defaclobjtype::text end as object_type,
       d.defaclacl::text as acl
from pg_default_acl d
where d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace
order by 1, 2, 3;

-- check 7: sequences that anon or authenticated may use
select c.relname as sequence_name, r.role as who
from pg_class c
cross join (values ('anon'), ('authenticated')) as r(role)
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'S'
  and (has_sequence_privilege(r.role, c.oid, 'USAGE') or has_sequence_privilege(r.role, c.oid, 'SELECT') or has_sequence_privilege(r.role, c.oid, 'UPDATE'))
order by 1, 2;

-- check 8: columns of profiles that authenticated may update
select a.attname as column_name
from pg_attribute a
where a.attrelid = 'public.profiles'::regclass
  and a.attnum > 0 and not a.attisdropped
  and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
order by a.attname;

-- check 9: storage policies of the buckets content and avatar
select pol.policyname, pol.cmd, pol.roles, pol.qual, pol.with_check
from pg_policies pol
where pol.schemaname = 'storage' and pol.tablename = 'objects'
order by pol.policyname;

-- check 10: buckets
select b.id, b.public, b.file_size_limit, b.allowed_mime_types
from storage.buckets b
order by b.id;

-- check 11: backup written by the migration (counts per kind)
select kind, count(*) as items, min(saved_at) as saved_at
from public.rls_lockdown_backup
group by kind
order by kind;

-- check 12: views of public
select c.relname as view_name, c.reloptions
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
order by c.relname;

-- check 13: tables in the realtime publication
select pt.schemaname, pt.tablename
from pg_publication_tables pt
where pt.pubname = 'supabase_realtime'
order by 1, 2;
