-- =============================================================================
-- Preview setup, step 4 of 4: verification (READ ONLY)
-- =============================================================================
-- WHO/WHEN: a human, after steps 1 to 3, and again after every "Preview Reset".
--           Only SELECT. Every query states what the expected result is.
-- =============================================================================

-- 1. Both roles exist; the migration role has no dangerous attributes.
--    EXPECTED: app_preview:          rolcanlogin = true, rolbypassrls = true,
--                                    search_path=public_preview, extensions
--              app_preview_migrator: rolcanlogin = true, rolbypassrls = false,
--                                    rolsuper = false, rolcreaterole = false,
--                                    rolcreatedb = false
select rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb, rolconfig
  from pg_roles
 where rolname in ('app_preview', 'app_preview_migrator')
 order by rolname;

-- 2. Neither role is a member of another role (no inherited rights).
--    EXPECTED: zero rows
select r.rolname as member, g.rolname as member_of
  from pg_auth_members m
  join pg_roles r on r.oid = m.member
  join pg_roles g on g.oid = m.roleid
 where r.rolname in ('app_preview', 'app_preview_migrator');

-- 3. Neither role has a table privilege in public, auth or storage.
--    EXPECTED: zero rows
select r.rolname, n.nspname, c.relname, p.priv
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('select'), ('insert'), ('update'), ('delete'), ('references'), ('trigger')) as p(priv)
  cross join (values ('app_preview'), ('app_preview_migrator')) as r(rolname)
 where n.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'p', 'v', 'm')
   and has_table_privilege(r.rolname, c.oid, p.priv);

-- 4. Schema privileges of both roles on public, auth and storage.
--    EXPECTED: usage = false on auth and storage. usage on public is true because PUBLIC
--    (everybody) holds it, that alone gives no access to a table.
--    WATCH create on public: if it says true, PUBLIC holds CREATE on the schema public
--    (seen in the local image of the Supabase Postgres, ACL "=UC"). Then both roles can
--    create objects in public, which is a gap. The fix is a decision for Production:
--    revoke create on schema public from public (this template does not do it).
select r.rolname, n.nspname,
       has_schema_privilege(r.rolname, n.nspname, 'usage')  as usage_priv,
       has_schema_privilege(r.rolname, n.nspname, 'create') as create_priv
  from pg_namespace n
  cross join (values ('app_preview'), ('app_preview_migrator')) as r(rolname)
 where n.nspname in ('public', 'auth', 'storage')
 order by r.rolname, n.nspname;

-- 5. Functions of public, auth and storage that the roles can EXECUTE (through PUBLIC or otherwise).
--    EXPECTED: review every row. Typical and harmless: read-only helpers such as
--    auth.uid(). Anything that writes data in a SECURITY DEFINER function of public
--    needs a decision of the owner (revoke execute from public in a Production
--    migration, this template changes nothing in Production).
select r.rolname, n.nspname, p.oid::regprocedure::text as function_signature, p.prosecdef as security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('app_preview'), ('app_preview_migrator')) as r(rolname)
 where n.nspname in ('public', 'auth', 'storage')
   and has_function_privilege(r.rolname, p.oid, 'execute')
   and p.prosecdef
 order by r.rolname, n.nspname, function_signature;

-- 6. The migration role owns exactly its two schemas.
--    EXPECTED: preview_meta and public_preview
select nspname from pg_namespace
 where nspowner = (select oid from pg_roles where rolname = 'app_preview_migrator')
 order by nspname;

-- 7. The app role can use public_preview.
--    EXPECTED: true
select has_schema_privilege('app_preview', 'public_preview', 'usage') as usage_on_preview;

-- 8. SECURITY DEFINER functions of public_preview are not executable by PUBLIC.
--    EXPECTED: zero rows
select p.oid::regprocedure::text as function_signature
  from pg_proc p
 where p.pronamespace = 'public_preview'::regnamespace and p.prosecdef
   and exists (
     select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
   );

-- 9. Helper functions of public_preview have a fixed search_path.
--    EXPECTED: two rows for public_preview with search_path=public_preview, pg_temp.
--    The rows of public are shown for comparison and stay unchanged.
select n.nspname, p.proname, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'public_preview') and p.proname in ('get_user_org_id', 'is_platform_owner')
 order by n.nspname, p.proname;

-- 10. Realtime membership of the Preview tables (after 03-shared-objects.sql).
--     EXPECTED: notifications and profiles in public_preview
select schemaname, tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname in ('public', 'public_preview') and tablename in ('notifications', 'profiles')
 order by schemaname, tablename;

-- 11. Storage policies for the preview/ prefix (after 03-shared-objects.sql).
--     EXPECTED: six policies ending in _preview (avatar and content: insert, update, delete)
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like '%\_preview'
 order by policyname;

-- 12. Preview holds no copy of production user data right after a reset.
--     EXPECTED: 0 (profiles arrive through /api/auth/sync-profile at the first
--     sign-in from Preview; content comes from seed, import or the content sync)
select count(*) as preview_profiles from public_preview.profiles;

-- 13. Migration history of Preview equals the ledger of public (right after a reset)
--     plus the migrations of master that are not released yet.
select (select count(*) from supabase_migrations.schema_migrations) as public_ledger,
       (select count(*) from preview_meta.schema_migrations) as preview_ledger;

-- 14. Extensions and where they live. pgvector in public is why public is on the
--     search_path of both Preview roles. EXPECTED: review. In the local Supabase image
--     (supautils) ANY login role, even a fresh one without privileges, could run
--     "drop extension vector cascade" (tried, rolled back). Check this on the hosted
--     project with a throwaway role and a rolled back transaction before relying on the
--     role boundary; see docs/release-prozess.md, "Einschränkungen".
select e.extname, e.extnamespace::regnamespace::text as schema, e.extowner::regrole::text as owner
  from pg_extension e
 where e.extname not in ('plpgsql')
 order by 1;
