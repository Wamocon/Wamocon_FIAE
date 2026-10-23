-- =============================================================================
-- Preview setup, step 3 of 3: verification (READ ONLY)
-- =============================================================================
-- WHO/WHEN: a human, after steps 1 and 2, and again after every "Preview Reset".
--           Only SELECT. Every query states what the expected result is.
-- =============================================================================

-- 1. The role exists, can log in, bypasses RLS, and its search_path is fixed.
--    EXPECTED: one row, rolcanlogin = true, rolbypassrls = true,
--              rolconfig contains search_path=public_preview, extensions
select rolname, rolcanlogin, rolbypassrls, rolconfig from pg_roles where rolname = 'app_preview';

-- 2. The role has NO table privilege in public.
--    EXPECTED: zero rows
select c.relname, p.priv
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
   and has_table_privilege('app_preview', c.oid, p.priv);

-- 3. The role can use public_preview.
--    EXPECTED: true
select has_schema_privilege('app_preview', 'public_preview', 'usage') as usage_on_preview;

-- 4. Helper functions of public_preview have a fixed search_path.
--    EXPECTED: two rows for public_preview with search_path=public_preview, pg_temp.
--    The rows of public are shown for comparison and stay unchanged.
select n.nspname, p.proname, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'public_preview') and p.proname in ('get_user_org_id', 'is_platform_owner')
 order by n.nspname, p.proname;

-- 5. Realtime membership of the Preview tables.
--    EXPECTED: notifications and profiles in public_preview
select schemaname, tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname in ('public', 'public_preview') and tablename in ('notifications', 'profiles')
 order by schemaname, tablename;

-- 6. Storage policies for the preview/ prefix.
--    EXPECTED: six policies ending in _preview (avatar and content: insert, update, delete)
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like '%\_preview'
 order by policyname;

-- 7. Preview holds no copy of production user data right after setup.
--    EXPECTED: 0 (users arrive only through sign-ups from Preview; content comes from seed, import or the content sync)
select count(*) as preview_profiles from public_preview.profiles;

-- 8. Migration history of Preview equals the ledger of public (right after a reset)
--    plus the migrations of master that are not released yet.
select (select count(*) from supabase_migrations.schema_migrations) as public_ledger,
       (select count(*) from supabase_migrations.preview_schema_migrations) as preview_ledger;
