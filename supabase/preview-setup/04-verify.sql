-- =============================================================================
-- Preview setup, step 4 of 4: verification (READ ONLY)
-- =============================================================================
-- WHO/WHEN: a human, after steps 1 to 3, and again after every "Preview Reset".
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

-- 4. Both auth triggers exist and are mutually exclusive by the sign-up metadata.
--    EXPECTED: on_auth_user_created with "is distinct from 'preview'" and
--              on_auth_user_created_preview with "= 'preview'"
select tgname, pg_get_triggerdef(oid) as definition
  from pg_trigger
 where tgrelid = 'auth.users'::regclass and not tgisinternal and tgname in ('on_auth_user_created', 'on_auth_user_created_preview');

-- 5. Helper functions have a fixed search_path in both schemas.
--    EXPECTED: four rows, proconfig contains search_path=<schema>, pg_temp
select n.nspname, p.proname, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'public_preview') and p.proname in ('get_user_org_id', 'is_platform_owner')
 order by n.nspname, p.proname;

-- 6. Realtime membership of the Preview tables.
--    EXPECTED: notifications and profiles in public_preview
select schemaname, tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname in ('public', 'public_preview') and tablename in ('notifications', 'profiles')
 order by schemaname, tablename;

-- 7. Storage policies for the preview/ prefix.
--    EXPECTED: six policies ending in _preview (avatar and content: insert, update, delete)
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like '%\_preview'
 order by policyname;

-- 8. Preview holds no copy of production user data right after setup.
--    EXPECTED: 0 (users arrive only through sign-ups from Preview; content comes from seed, import or the content sync)
select count(*) as preview_profiles from public_preview.profiles;

-- 9. Migration history of Preview equals the ledger of public (right after a reset)
--    plus the migrations of master that are not released yet.
select (select count(*) from supabase_migrations.schema_migrations) as public_ledger,
       (select count(*) from supabase_migrations.preview_schema_migrations) as preview_ledger;
