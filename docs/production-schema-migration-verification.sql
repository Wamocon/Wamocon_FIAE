-- Read-only production checks for the safe schema migration.
--
-- Run this before and after applying:
--   supabase/migrations/202606260001_schema_only_ausbildung_duration.sql
--
-- Save the row-count output before migration and compare it after migration.
-- Counts must remain unchanged. The only allowed data change is filling
-- profiles.ausbildung_duration_years with 3 for existing rows where needed.

-- 1. Current database identity.
select
  current_database() as database_name,
  current_schema() as current_schema,
  current_user as current_user_name,
  now() as checked_at;

-- 2. Extension state.
select
  extname,
  extversion,
  nspname as schema_name
from pg_extension
join pg_namespace on pg_namespace.oid = pg_extension.extnamespace
where extname in ('pgcrypto', 'vector')
order by extname;

-- 3. App enum state.
select
  n.nspname as schema_name,
  t.typname as enum_name,
  array_agg(e.enumlabel order by e.enumsortorder) as enum_values
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname in (
    'user_role',
    'duration_unit',
    'quiz_type',
    'question_type',
    'quiz_difficulty',
    'review_status',
    'performance_rating',
    'certificate_status',
    'competency_area',
    'evaluation_status',
    'subscription_plan',
    'content_document_type',
    'document_visibility',
    'hai_source_type',
    'hai_context_type',
    'hai_message_role',
    'block_type',
    'exam_sub_type',
    'activity_report_status',
    'exam_type'
  )
group by n.nspname, t.typname
order by t.typname;

-- 4. App-critical table existence.
with expected_tables(table_name) as (
  values
    ('organizations'),
    ('profiles'),
    ('courses'),
    ('course_members'),
    ('skills'),
    ('course_skills'),
    ('enablers'),
    ('content_documents'),
    ('quizzes'),
    ('enabler_quizzes'),
    ('enabler_quiz_links'),
    ('questions'),
    ('options'),
    ('quiz_assignments'),
    ('quiz_submissions'),
    ('quiz_members'),
    ('quiz_submission_answers'),
    ('use_cases'),
    ('use_case_submissions'),
    ('use_case_submission_links'),
    ('knowledge_notes'),
    ('acceptance_protocols'),
    ('trainee_achieved_skills'),
    ('activity_log'),
    ('notifications'),
    ('enabler_completions'),
    ('trainee_enabler_overrides'),
    ('trainee_use_case_overrides'),
    ('enabler_submissions'),
    ('modules'),
    ('lessons'),
    ('sub_lessons'),
    ('progress'),
    ('hai_embeddings'),
    ('hai_reindex_jobs'),
    ('hai_chat_sessions'),
    ('hai_chat_messages'),
    ('ausbildung_blocks'),
    ('school_exams'),
    ('school_exam_results'),
    ('lernfelder'),
    ('lernfeld_mappings'),
    ('activity_reports'),
    ('activity_report_entries'),
    ('training_components'),
    ('training_use_cases'),
    ('activity_report_use_case_entries'),
    ('mes_softskill_criteria'),
    ('weekly_evaluations'),
    ('weekly_softskill_ratings'),
    ('annual_performance_summaries'),
    ('work_certificates'),
    ('certificate_text_templates'),
    ('grade_edit_history')
)
select
  expected_tables.table_name,
  case
    when information_schema.tables.table_name is null then 'missing'
    else 'present'
  end as state
from expected_tables
left join information_schema.tables
  on information_schema.tables.table_schema = 'public'
 and information_schema.tables.table_name = expected_tables.table_name
order by expected_tables.table_name;

-- 5. Exact row counts for important production data tables that exist.
-- Missing tables are reported in section 4 instead of making this query fail.
with expected_tables(table_name) as (
  values
    ('organizations'),
    ('profiles'),
    ('courses'),
    ('course_members'),
    ('skills'),
    ('course_skills'),
    ('enablers'),
    ('content_documents'),
    ('quizzes'),
    ('enabler_quizzes'),
    ('enabler_quiz_links'),
    ('questions'),
    ('options'),
    ('quiz_assignments'),
    ('quiz_submissions'),
    ('quiz_members'),
    ('quiz_submission_answers'),
    ('use_cases'),
    ('use_case_submissions'),
    ('use_case_submission_links'),
    ('knowledge_notes'),
    ('acceptance_protocols'),
    ('trainee_achieved_skills'),
    ('activity_log'),
    ('notifications'),
    ('enabler_completions'),
    ('trainee_enabler_overrides'),
    ('trainee_use_case_overrides'),
    ('enabler_submissions'),
    ('modules'),
    ('lessons'),
    ('sub_lessons'),
    ('progress'),
    ('hai_embeddings'),
    ('hai_reindex_jobs'),
    ('hai_chat_sessions'),
    ('hai_chat_messages'),
    ('ausbildung_blocks'),
    ('school_exams'),
    ('school_exam_results'),
    ('lernfelder'),
    ('lernfeld_mappings'),
    ('activity_reports'),
    ('activity_report_entries'),
    ('training_components'),
    ('training_use_cases'),
    ('activity_report_use_case_entries'),
    ('mes_softskill_criteria'),
    ('weekly_evaluations'),
    ('weekly_softskill_ratings'),
    ('annual_performance_summaries'),
    ('work_certificates'),
    ('certificate_text_templates'),
    ('grade_edit_history')
),
existing_tables as (
  select
    expected_tables.table_name,
    format('%I.%I', 'public', expected_tables.table_name) as qualified_name
  from expected_tables
  join information_schema.tables
    on information_schema.tables.table_schema = 'public'
   and information_schema.tables.table_name = expected_tables.table_name
)
select
  table_name,
  (
    xpath(
      '/row/row_count/text()',
      query_to_xml(
        format('select count(*) as row_count from %s', qualified_name),
        false,
        true,
        ''
      )
    )
  )[1]::text::bigint as row_count
from existing_tables
order by table_name;

-- 6. Migration history table state, if present.
select
  table_schema,
  table_name
from information_schema.tables
where table_schema in ('public', 'drizzle', 'supabase_migrations')
  and table_name ilike '%migration%'
order by table_schema, table_name;

-- 7. Required duration column/default/check verification.
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'profiles'
  and c.column_name = 'ausbildung_duration_years';

select
  conname as constraint_name,
  pg_get_constraintdef(pg_constraint.oid) as constraint_definition
from pg_constraint
join pg_class on pg_class.oid = pg_constraint.conrelid
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where pg_namespace.nspname = 'public'
  and pg_class.relname = 'profiles'
  and conname = 'profiles_ausbildung_duration_years_check';

select
  case
    when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'ausbildung_duration_years'
    )
      then query_to_xml(
        'select ausbildung_duration_years, count(*) as profile_count
         from public.profiles
         group by ausbildung_duration_years
         order by ausbildung_duration_years',
        true,
        false,
        ''
      )::text
    else 'column_missing'
  end as duration_distribution;

select
  case
    when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'ausbildung_duration_years'
    )
      then (
        xpath(
          '/row/invalid_duration_profiles/text()',
          query_to_xml(
            'select count(*) as invalid_duration_profiles
             from public.profiles
             where ausbildung_duration_years not in (2, 3)
                or ausbildung_duration_years is null',
            false,
            true,
            ''
          )
        )
      )[1]::text::bigint
    else null
  end as invalid_duration_profiles;

-- 8. RLS policy inventory for app tables.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'organizations',
    'profiles',
    'courses',
    'course_members',
    'content_documents',
    'quizzes',
    'questions',
    'options',
    'quiz_submissions',
    'quiz_members',
    'use_cases',
    'activity_reports',
    'activity_report_entries',
    'weekly_evaluations',
    'work_certificates'
  )
order by tablename, policyname;

-- ============================================================================
-- Catalog series (supabase/migrations/20261020*), read-only checks
-- ============================================================================

-- C1. Precheck: server version (at least 15 required), roles, catalog table
-- must NOT exist before the series, ledger state.
select
  current_setting('server_version_num')::integer >= 150000 as postgres_15_or_newer,
  exists (select 1 from pg_roles where rolname = 'anon') as role_anon_exists,
  exists (select 1 from pg_roles where rolname = 'authenticated') as role_authenticated_exists,
  to_regclass('public.training_catalogs') is null as catalog_table_missing_as_expected;

select max(version) as last_ledger_version, count(*) as ledger_rows
from supabase_migrations.schema_migrations;

-- C1b. Precheck before 20261020001500: PR 89 must be applied. Must return false,
-- otherwise authenticated can still change its own role.
select has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
  as authenticated_can_update_role_must_be_false;

-- C2. Precheck: course content counts (production reference, measured
-- 2026-10-23: 26 courses, 189 enablers, 88 use cases).
select
  (select count(*) from public.courses) as courses,
  (select count(*) from public.enablers) as enablers,
  (select count(*) from public.use_cases) as use_cases,
  (select count(*) from public.training_components) as training_components,
  (select count(*) from public.quizzes) as quizzes,
  (select count(*) from public.lernfelder) as lernfelder,
  (select count(*) from public.lernfeld_mappings) as lernfeld_mappings,
  (select count(*) from public.profiles where role = 'TRAINEE') as trainees;

-- C3. Precheck: labels of lernfelder (the migration derives code and training
-- year from them; unusual labels default to training year 1).
select label, count(*) as occurrences
from public.lernfelder
group by label
order by label;

-- C4. Postcheck (after the series without 20261024000000): everything is FIAE.
select 'courses' as table_name, training_catalog_id, count(*) from public.courses group by 2
union all select 'enablers', training_catalog_id, count(*) from public.enablers group by 2
union all select 'use_cases', training_catalog_id, count(*) from public.use_cases group by 2
union all select 'training_components', training_catalog_id, count(*) from public.training_components group by 2
union all select 'quizzes', training_catalog_id, count(*) from public.quizzes group by 2;

-- C5. Postcheck: legacy and view row counts agree.
select
  (select count(*) from public.lernfelder) as lernfelder_view,
  (select count(*) from public.lernfelder_legacy) as lernfelder_legacy,
  (select count(*) from public.lernfeld_mappings) as mappings_view,
  (select count(*) from public.lernfeld_mappings_legacy) as mappings_legacy;

-- C6. Postcheck: all constraints validated (expect 0 rows).
select conrelid::regclass as table_name, conname
from pg_constraint
where connamespace = 'public'::regnamespace
  and not convalidated;

-- C7. Postcheck: use case enabler link (all NULL for FIAE) and per course report.
select count(*) filter (where enabler_id is not null) as linked_use_cases,
       count(*) as use_cases
from public.use_cases;

select course_title, enabler_count, use_case_count, paired_count, status, needs_review
from public.v_use_case_enabler_backfill_report
order by course_title;

-- C8. Postcheck: no policy of the new tables for public or anon (expect 0 rows).
select tablename, policyname, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename in (
    'training_catalogs',
    'training_catalog_learning_fields',
    'training_catalog_content_mappings',
    'organization_catalogs',
    'trainee_enrollments',
    'trainee_elective_choices'
  )
  and (roles && array['public', 'anon']::name[]);

-- C9. Postcheck: enrollments and organization catalogs backfilled.
select
  (select count(*) from public.trainee_enrollments) as enrollments,
  (select count(*) from public.profiles where role = 'TRAINEE') as trainees,
  (select count(*) from public.organization_catalogs) as organization_catalogs,
  (select count(*) from public.organizations) as organizations;

-- C10. After 20261024000000 only: no ADMIN left in the platform owner organization.
select p.role, count(*)
from public.profiles p
join public.organizations o on o.id = p.organization_id
where o.is_platform_owner
group by p.role
order by p.role;
