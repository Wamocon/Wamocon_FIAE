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
