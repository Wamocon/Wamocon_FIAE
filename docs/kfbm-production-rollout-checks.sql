-- Read-only checks for the KfBM rollout to Production (docs/kfbm-production-rollout.md).
--
-- WHO RUNS IT: the owner, by hand, in the Supabase SQL editor of the Production project
-- (role postgres). No agent and no workflow runs this file.
-- WHAT IT DOES: SELECT statements only. Nothing is changed, nothing is written.
-- HOW: the SQL editor shows the result of the LAST statement only. Select the text of ONE
-- check (from its "-- V.." or "-- N.." line to the semicolon) and run the selection. Save
-- every output with date and time (the rollout log in the runbook names where).
--
-- V checks (V01 to V13): BEFORE the rollout. They turn the assumptions of the runbook into
--   measured facts. N checks (N01 to N11): AFTER the stage named in the runbook. The older
--   checks C1 to C20 (docs/production-schema-migration-verification.sql) and the checks 1 to
--   13 of supabase/manual/verify-rls-lockdown.sql stay valid and are referenced by number.
-- Language: comments and column names are English like all SQL in the repository, the
--   runbook explains the expected values in German.

-- ============================================================================
-- V checks (before the rollout)
-- ============================================================================

-- V01. Identity: the project, the role and the server version. The runbook expects
-- Production (project FIEA-Production), role postgres, PostgreSQL 15 or newer.
select current_database() as database_name,
       current_user as db_role,
       current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer >= 150000 as postgres_15_or_newer,
       (select rolbypassrls from pg_roles where rolname = current_user) as role_bypasses_rls;

-- V02. Ledger summary. Before the repair of 202606260001 expect has_202606260001 = false.
-- Last measured 24.10.2026 (project notes): 60 rows, last version 20260227143256.
select count(*) as ledger_rows,
       max(version) as last_version,
       bool_or(version = '202606260001') as has_202606260001,
       count(*) filter (where version >= '20261023') as rows_from_20261023
from supabase_migrations.schema_migrations;

-- V02b. Ledger rows from June 2026 on. Expect: nothing before the repair of
-- 202606260001, afterwards exactly that one row. Rows from 20261023 on tell which of the
-- hardening files were applied through the ledger (assumed: none, they were applied by hand).
select version, name
from supabase_migrations.schema_migrations
where version >= '202606'
order by version;

-- V03. Column privileges on profiles. Expect 0 rows for anon. Expect for authenticated only
-- the five columns avatar_url, birth_date, full_name, start_of_training_date, updated_at
-- (after 20261023300100). If role, organization_id, is_active, trainer_activated, email or
-- assigned_trainer_id show up, 20261023200000 / 20261023300100 are not in effect yet.
select a.attname as column_name,
       has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') as authenticated_update,
       has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE') as anon_update
from pg_attribute a
where a.attrelid = 'public.profiles'::regclass
  and a.attnum > 0 and not a.attisdropped
  and (has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
       or has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE'))
order by a.attname;

-- V03b. The single value the migration 20261024001500 and the backfill test themselves.
-- Must be false, otherwise any signed-in user could set the own role.
select has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
  as authenticated_can_update_role_must_be_false;

-- V04. Triggers on profiles and on auth.users. Expect on public.profiles the trigger
-- profiles_protect_columns (from 20261023300100) and nothing else besides internal ones.
-- Expect NO trigger on auth.users (measured 23.10.2026). A trigger on auth.users that
-- creates profiles must skip accounts with raw_app_meta_data preview_only = true.
select 'public.profiles' as on_table, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
union all
select 'auth.users', t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
from pg_trigger t
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
order by 1, 2;

-- V05. Forms of stored file links. Shows which link shapes exist (public URL of the bucket
-- content, a path under preview/, a signed URL, another host). Needed for the decision on the
-- bucket content (H6) and for the path move of the PDF files. Counts only, no URL is shown.
with urls as (
  select 'content_documents.storage_url' as source, storage_url as url from public.content_documents
  union all select 'enablers.ppt_url', ppt_url from public.enablers
  union all select 'enablers.video_url', video_url from public.enablers
  union all select 'enablers.scenario_pdf_url', scenario_pdf_url from public.enablers
)
select source,
       case
         when url is null then 'NULL'
         when url = '' then 'empty'
         when url like 'private://%' then 'private reference'
         when url like '%/storage/v1/object/public/content/preview/%' then 'public url, bucket content, prefix preview/'
         when url like '%/storage/v1/object/public/content/%' then 'public url, bucket content'
         when url like '%/storage/v1/object/public/avatar/%' then 'public url, bucket avatar'
         when url like '%/storage/v1/object/sign/%' then 'signed url'
         when url like 'http%' then 'other http url'
         else 'other form'
       end as link_form,
       count(*) as links
from urls
group by 1, 2
order by 1, 3 desc;

-- V05b. First folder of content_documents.storage_path (uuid = folder of a person,
-- use-cases = bulk import, preview = Preview upload, other = to look at).
select case
         when storage_path is null or storage_path = '' then 'no path'
         when split_part(storage_path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'folder of a person (uuid)'
         when split_part(storage_path, '/', 1) in ('use-cases', 'preview') then split_part(storage_path, '/', 1)
         else 'other: ' || split_part(storage_path, '/', 1)
       end as first_folder,
       count(*) as documents
from public.content_documents
group by 1
order by 2 desc;

-- V06. Profiles without an organization, by role. Profiles without organization_id are
-- invisible in several organization filters; the runbook wants the number before the rollout.
select role, count(*) as profiles_without_organization,
       count(*) filter (where is_active) as active_ones
from public.profiles
where organization_id is null
group by role
order by role;

-- V06b. Profiles of the platform owner organization by role. The Super admin backfill turns
-- the ADMIN rows into SUPER_ADMIN. The number of ADMIN rows here is the number of people who
-- briefly lose the admin area of the old app between migration and app deploy (the old app
-- tests the string ADMIN).
select o.name as organization, p.role, count(*) as profiles
from public.profiles p
join public.organizations o on o.id = p.organization_id
where o.is_platform_owner
group by o.name, p.role
order by o.name, p.role;

-- V07. Row counts of the tables the rollout touches (measured 23.10.2026: 26 courses,
-- 189 enablers, 88 use cases, 6 profiles). Keep the output: it is the reference for the
-- comparison after the rollout.
select 'courses' as table_name, count(*) as row_count from public.courses
union all select 'enablers', count(*) from public.enablers
union all select 'use_cases', count(*) from public.use_cases
union all select 'training_components', count(*) from public.training_components
union all select 'training_use_cases', count(*) from public.training_use_cases
union all select 'quizzes', count(*) from public.quizzes
union all select 'questions', count(*) from public.questions
union all select 'options', count(*) from public.options
union all select 'enabler_quiz_links', count(*) from public.enabler_quiz_links
union all select 'content_documents', count(*) from public.content_documents
union all select 'lernfelder', count(*) from public.lernfelder
union all select 'lernfeld_mappings', count(*) from public.lernfeld_mappings
union all select 'profiles', count(*) from public.profiles
union all select 'organizations', count(*) from public.organizations
union all select 'hai_embeddings', count(*) from public.hai_embeddings
union all select 'auth.users', count(*) from auth.users
order by 1;

-- V07b. Size of hai_embeddings and its indexes. The migration 20261027000100 locks the
-- table (ACCESS EXCLUSIVE) and updates every row inside a statement_timeout of 60 seconds.
-- Rule of the runbook: more than 50000 rows or more than 1 GB in total means a rehearsal on
-- a restored copy is mandatory (V02 of the runbook) and the window gets longer.
select pg_size_pretty(pg_total_relation_size('public.hai_embeddings')) as total_size,
       (select count(*) from public.hai_embeddings) as chunks;

select i.indexrelid::regclass as index_name,
       pg_size_pretty(pg_relation_size(i.indexrelid)) as index_size,
       pg_get_indexdef(i.indexrelid) as definition
from pg_index i
where i.indrelid = 'public.hai_embeddings'::regclass
order by pg_relation_size(i.indexrelid) desc;

-- V08. Policy inventory of public and storage, and the buckets. Save the output: it is the
-- list to restore from if a policy change has to be undone (also asked by the storage
-- template supabase/manual/20261029_storage_policies_v2.sql, section 0).
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

-- V09. Roles and live connections. Expect the app to connect as postgres (a role with
-- BYPASSRLS, so the lockdown of the API roles does not touch the app). Look for a login
-- role besides postgres, supabase_* and the pooler roles; app_user was seen without
-- ownership and sessions on 23.10.2026.
select rolname, rolbypassrls, rolsuper, rolcanlogin
from pg_roles
where rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'app_user',
                  'app_preview', 'app_preview_migrator')
order by rolname;

select usename as role_name, count(*) as connections
from pg_stat_activity
where datname = current_database()
group by usename
order by connections desc;

-- V10. CREATE on the schema public for PUBLIC. Measured 23.10.2026: true (acl =UC). The
-- file 20261025000100 withdraws it, afterwards false.
select has_schema_privilege('public', 'public', 'CREATE') as public_can_create_in_schema_public,
       (select nspacl::text from pg_namespace where nspname = 'public') as schema_acl;

-- V11. State of the catalog structure before the series: training_catalogs must not exist
-- (null), the legacy learning field tables are plain tables, all five extra columns of
-- lernfelder must be empty (the file 20261024000500 stops at the first value). Run it only
-- BEFORE the series: afterwards lernfelder is a view and the second query fails.
select to_regclass('public.training_catalogs') as training_catalogs_must_be_null,
       (select relkind from pg_class where oid = 'public.lernfelder'::regclass) as lernfelder_relkind_r_expected,
       (select count(*) from public.lernfelder) as lernfelder_rows;

select count(*) filter (where code is not null) as code_values,
       count(*) filter (where training_year is not null) as training_year_values,
       count(*) filter (where hours_budget is not null) as hours_budget_values,
       count(*) filter (where order_index is not null) as order_index_values,
       count(*) filter (where is_common is distinct from true) as is_common_not_true
from public.lernfelder;

-- V12. Precheck of 20261028000300: a letter twice in one component. Expect 0 rows,
-- otherwise the file stops with the number and changes nothing. A person decides.
select component_id, letter, count(*) as occurrences
from public.training_use_cases
group by component_id, letter
having count(*) > 1;

-- V13. Precheck for the HAI index scope (20261027000100): chunks per source_type and the
-- organization spread of the documents (C12 and C12a of the older verification file, copied
-- here so that one file is enough). Platform PDFs that carry the platform organization
-- instead of NULL are no longer found by customer organizations in the HAI.
select source_type, count(*) as chunks
from public.hai_embeddings
group by source_type
order by source_type;

select d.organization_id, o.name, o.is_platform_owner, count(*) as documents
from public.content_documents d
left join public.organizations o on o.id = d.organization_id
group by d.organization_id, o.name, o.is_platform_owner
order by documents desc;

-- ============================================================================
-- N checks (after a stage, the runbook says which)
-- ============================================================================

-- N01. Ledger against the 34 files of the repository. Expect 0 rows after the release (and
-- after the repair of 202606260001). Every row is a file whose version is missing in the
-- ledger: it was not applied through the pipeline.
with expected(version) as (
  values ('202606260001'),
         ('20261023100000'), ('20261023100100'), ('20261023100200'),
         ('20261023200000'), ('20261023300000'), ('20261023300100'),
         ('20261024000100'), ('20261024000200'), ('20261024000300'), ('20261024000400'),
         ('20261024000500'), ('20261024000600'), ('20261024000700'), ('20261024000800'),
         ('20261024000900'), ('20261024001000'), ('20261024001100'), ('20261024001200'),
         ('20261024001300'), ('20261024001400'), ('20261024001500'),
         ('20261025000000'), ('20261025000100'), ('20261026000100'), ('20261027000100'),
         ('20261028000100'), ('20261028000200'), ('20261028000300'),
         ('20261029000100'), ('20261029000200'), ('20261029000300'),
         ('20261030000100'), ('20261030000200')
)
select e.version as missing_in_ledger
from expected e
left join supabase_migrations.schema_migrations m on m.version = e.version
where m.version is null
order by e.version;

-- N02. Objects of the series. Expect no row with present = false after the release. Before
-- the release most rows are false, which tests the query itself.
select check_name, present
from (
  values
    ('table training_catalogs', to_regclass('public.training_catalogs') is not null),
    ('table training_catalog_learning_fields', to_regclass('public.training_catalog_learning_fields') is not null),
    ('table training_catalog_content_mappings', to_regclass('public.training_catalog_content_mappings') is not null),
    ('table organization_catalogs', to_regclass('public.organization_catalogs') is not null),
    ('table trainee_enrollments', to_regclass('public.trainee_enrollments') is not null),
    ('table trainee_elective_choices', to_regclass('public.trainee_elective_choices') is not null),
    ('table lernfelder_legacy', to_regclass('public.lernfelder_legacy') is not null),
    ('table lernfeld_mappings_legacy', to_regclass('public.lernfeld_mappings_legacy') is not null),
    ('table auth_attempts', to_regclass('public.auth_attempts') is not null),
    ('table rls_lockdown_backup', to_regclass('public.rls_lockdown_backup') is not null),
    ('table content_upload_runs', to_regclass('public.content_upload_runs') is not null),
    ('table content_upload_files', to_regclass('public.content_upload_files') is not null),
    ('table content_upload_proposals', to_regclass('public.content_upload_proposals') is not null),
    ('table content_upload_decisions', to_regclass('public.content_upload_decisions') is not null),
    ('table content_upload_ki_calls', to_regclass('public.content_upload_ki_calls') is not null),
    ('table content_upload_applies', to_regclass('public.content_upload_applies') is not null),
    ('table content_upload_applied_rows', to_regclass('public.content_upload_applied_rows') is not null),
    ('column courses.training_catalog_id', exists (select 1 from pg_attribute where attrelid = to_regclass('public.courses') and attname = 'training_catalog_id' and not attisdropped)),
    ('column courses.training_component_id', exists (select 1 from pg_attribute where attrelid = to_regclass('public.courses') and attname = 'training_component_id' and not attisdropped)),
    ('column quizzes.code', exists (select 1 from pg_attribute where attrelid = to_regclass('public.quizzes') and attname = 'code' and not attisdropped)),
    ('column quizzes.training_catalog_id', exists (select 1 from pg_attribute where attrelid = to_regclass('public.quizzes') and attname = 'training_catalog_id' and not attisdropped)),
    ('column options.order_index', exists (select 1 from pg_attribute where attrelid = to_regclass('public.options') and attname = 'order_index' and not attisdropped)),
    ('column use_cases.enabler_id', exists (select 1 from pg_attribute where attrelid = to_regclass('public.use_cases') and attname = 'enabler_id' and not attisdropped)),
    ('column training_components.phase', exists (select 1 from pg_attribute where attrelid = to_regclass('public.training_components') and attname = 'phase' and not attisdropped)),
    ('column training_components.kind', exists (select 1 from pg_attribute where attrelid = to_regclass('public.training_components') and attname = 'kind' and not attisdropped)),
    ('column hai_embeddings.training_catalog_id', exists (select 1 from pg_attribute where attrelid = to_regclass('public.hai_embeddings') and attname = 'training_catalog_id' and not attisdropped)),
    ('column hai_embeddings.visibility', exists (select 1 from pg_attribute where attrelid = to_regclass('public.hai_embeddings') and attname = 'visibility' and not attisdropped)),
    ('column hai_embeddings.organization_id', exists (select 1 from pg_attribute where attrelid = to_regclass('public.hai_embeddings') and attname = 'organization_id' and not attisdropped)),
    ('index trainee_enrollments_trainee_unique', to_regclass('public.trainee_enrollments_trainee_unique') is not null),
    ('index courses_training_component_unique', to_regclass('public.courses_training_component_unique') is not null),
    ('index quizzes_catalog_code_unique', to_regclass('public.quizzes_catalog_code_unique') is not null),
    ('index idx_hai_embeddings_scope', to_regclass('public.idx_hai_embeddings_scope') is not null),
    ('trigger profiles_protect_columns', exists (select 1 from pg_trigger where tgname = 'profiles_protect_columns' and not tgisinternal)),
    ('trigger enabler_quiz_links_catalog_check', exists (select 1 from pg_trigger where tgname = 'enabler_quiz_links_catalog_check' and not tgisinternal)),
    ('trigger quizzes_catalog_link_check', exists (select 1 from pg_trigger where tgname = 'quizzes_catalog_link_check' and not tgisinternal)),
    ('trigger hai_embeddings_set_scope', exists (select 1 from pg_trigger where tgname = 'hai_embeddings_set_scope' and not tgisinternal)),
    ('trigger content_documents_follow_hai_scope', exists (select 1 from pg_trigger where tgname = 'content_documents_follow_hai_scope' and not tgisinternal)),
    ('enum value user_role SUPER_ADMIN', exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel = 'SUPER_ADMIN')),
    ('PUBLIC cannot create in schema public', not has_schema_privilege('public', 'public', 'CREATE'))
) as t(check_name, present)
order by present, check_name;

-- N03. After the Super admin backfill (20261025000000): the platform owner organization has
-- no ADMIN left (C10 of the older verification file). Compare with V06b.
select o.name as organization, p.role, count(*) as profiles
from public.profiles p
join public.organizations o on o.id = p.organization_id
where o.is_platform_owner
group by o.name, p.role
order by o.name, p.role;

-- N04. Catalog state. Expect FIAE active. KFBM stays inactive until the owner activates it
-- in the user interface (the seed creates it inactive). Organizations that may use a catalog:
select code, is_active, duration_years, occupation_code
from public.training_catalogs
order by code;

select c.code as catalog, count(oc.training_catalog_id) as organizations_with_access
from public.training_catalogs c
left join public.organization_catalogs oc on oc.training_catalog_id = c.id
group by c.code
order by c.code;

-- N05. Content per catalog. After the content import compare the KFBM line with the same
-- query on the Preview (schema public_preview, replace the schema name) and with the plan
-- of the import (components, courses, enablers, use cases, quizzes, questions, options).
select c.code as catalog,
       (select count(*) from public.training_components x where x.training_catalog_id = c.id) as components,
       (select count(*) from public.courses x where x.training_catalog_id = c.id) as courses,
       (select count(*) from public.enablers x where x.training_catalog_id = c.id) as enablers,
       (select count(*) from public.use_cases x where x.training_catalog_id = c.id) as use_cases,
       (select count(*) from public.quizzes x where x.training_catalog_id = c.id) as quizzes,
       (select count(*) from public.questions q join public.quizzes z on z.id = q.quiz_id where z.training_catalog_id = c.id) as questions,
       (select count(*) from public.options o join public.questions q on q.id = o.question_id join public.quizzes z on z.id = q.quiz_id where z.training_catalog_id = c.id) as options,
       (select count(*) from public.training_catalog_learning_fields x where x.training_catalog_id = c.id) as learning_fields,
       (select count(*) from public.training_catalog_content_mappings x where x.training_catalog_id = c.id) as content_mappings
from public.training_catalogs c
order by c.code;

-- N06. Solution protection of the documents of KFBM. First the overview, then the violations.
-- Expect 0 rows in the second query: no solution document visible to anyone but trainers,
-- no private reference outside TRAINER_ONLY, no solution file behind a public link.
with kfbm_documents as (
  select d.*
  from public.content_documents d
  left join public.enablers e on e.id = d.enabler_id
  left join public.use_cases u on u.id = d.use_case_id
  left join public.courses c on c.id = d.course_id
  where coalesce(e.training_catalog_id, u.training_catalog_id, c.training_catalog_id)
        = (select id from public.training_catalogs where code = 'KFBM')
)
select document_type, visibility,
       case when storage_url like 'private://%' then 'private reference'
            when storage_url = '' or storage_url is null then 'no file'
            else 'public url' end as storage_form,
       count(*) as documents
from kfbm_documents
group by 1, 2, 3
order by 1, 2, 3;

select d.document_type, d.visibility, count(*) as violations
from public.content_documents d
where (d.document_type = 'TRAINER_SOLUTION' and d.visibility <> 'TRAINER_ONLY')
   or (d.storage_url like 'private://%' and d.visibility <> 'TRAINER_ONLY')
   or (d.document_type = 'TRAINER_SOLUTION' and d.storage_url like 'http%')
group by 1, 2;

-- N07. Activation state by catalog. Imported content arrives inactive. Expect for KFBM all
-- zeros until the owner activates content on purpose.
select c.code as catalog,
       count(*) filter (where co.is_active) as courses_active,
       count(*) filter (where co.is_published) as courses_published,
       count(co.id) as courses_total
from public.training_catalogs c
left join public.courses co on co.training_catalog_id = c.id
group by c.code
order by c.code;

select c.code as catalog,
       count(*) filter (where e.is_active) as enablers_active,
       count(e.id) as enablers_total
from public.training_catalogs c
left join public.enablers e on e.training_catalog_id = c.id
group by c.code
order by c.code;

-- N08. HAI index by catalog, source type and visibility (after the reindex of KFBM). Expect
-- no row with catalog NULL and 0 in the second query (no solution visible to trainees).
select cat.code as catalog, h.source_type, h.visibility, count(*) as chunks
from public.hai_embeddings h
left join public.training_catalogs cat on cat.id = h.training_catalog_id
group by 1, 2, 3
order by 1, 2, 3;

select count(*) as solutions_visible_to_trainees
from public.hai_embeddings
where metadata ->> 'documentType' = 'TRAINER_SOLUTION'
  and visibility <> 'trainer';

-- N09. Upload tables are closed for the API roles. Expect rls_enabled = true and both
-- privileges false on all seven tables (the feature is switched off in Production).
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and c.relname like 'content\_upload\_%'
order by c.relname;

-- N10. Owner of the objects of schema public after the release. Expect ONE owner, postgres
-- (measured 23.10.2026: all 246 objects belong to postgres). The pipeline connects through
-- the temporary login role of the CLI (cli_login_postgres); which owner the new objects
-- get from that role was never measured. A second owner here is a STOP: do not continue
-- with the next stage, see the stop rule in section 2.6 of the runbook.
select pg_get_userbyid(c.relowner) as owner, c.relkind, count(*) as objects
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r', 'p', 'v', 'm', 'S')
group by 1, 2
order by 1, 2;

select pg_get_userbyid(p.proowner) as owner, count(*) as functions
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
group by 1
order by 1;

-- N11. Buckets and storage policies after the manual steps. Expect: content public = true
-- (until decision H6), avatar public = true, content-solutions public = false, content-upload
-- public = false, and no policy that names content-solutions or content-upload.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
