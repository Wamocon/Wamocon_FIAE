-- Safe production schema migration.
--
-- Purpose:
--   Add the apprenticeship duration schema required by the app without seeding,
--   deleting, or changing existing application data, except for the controlled
--   default/backfill of profiles.ausbildung_duration_years.
--
-- Important:
--   Apply this curated SQL through the Supabase MCP migration tool only after
--   confirming the production project ID/name and running the read-only checks
--   in docs/production-schema-migration-verification.sql.
--
-- Do not replace this file with drizzle-kit push output or the full
-- src/db/migrations/drizzle folder. That folder contains seed/data migrations.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create extension if not exists pgcrypto;
create extension if not exists vector;

do $$
declare
  missing_tables text[];
  missing_enums text[];
begin
  select array_agg(expected.table_name order by expected.table_name)
  into missing_tables
  from (
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
  ) as expected(table_name)
  where to_regclass(format('public.%I', expected.table_name)) is null;

  select array_agg(expected.enum_name order by expected.enum_name)
  into missing_enums
  from (
    values
      ('user_role'),
      ('duration_unit'),
      ('quiz_type'),
      ('question_type'),
      ('quiz_difficulty'),
      ('review_status'),
      ('performance_rating'),
      ('certificate_status'),
      ('competency_area'),
      ('evaluation_status'),
      ('subscription_plan'),
      ('content_document_type'),
      ('document_visibility'),
      ('hai_source_type'),
      ('hai_context_type'),
      ('hai_message_role'),
      ('block_type'),
      ('exam_sub_type'),
      ('activity_report_status'),
      ('exam_type')
  ) as expected(enum_name)
  where to_regtype(format('public.%I', expected.enum_name)) is null;

  if missing_tables is not null then
    raise exception
      'Production schema is missing required tables: %. Stop and generate a reviewed schema-only migration for those objects first.',
      array_to_string(missing_tables, ', ');
  end if;

  if missing_enums is not null then
    raise exception
      'Production schema is missing required enums: %. Stop and generate a reviewed schema-only migration for those objects first.',
      array_to_string(missing_enums, ', ');
  end if;
end $$;

alter table public.profiles
  add column if not exists ausbildung_duration_years integer;

alter table public.profiles
  alter column ausbildung_duration_years set default 3;

-- The only allowed production data change in this migration:
-- existing profiles get the safe default so the deployed app can read the
-- column immediately. Trainers can later change trainees to 2 years in-app.
update public.profiles
set ausbildung_duration_years = 3
where ausbildung_duration_years is null
   or ausbildung_duration_years not in (2, 3);

alter table public.profiles
  alter column ausbildung_duration_years set not null;

alter table public.profiles
  drop constraint if exists profiles_ausbildung_duration_years_check;

alter table public.profiles
  add constraint profiles_ausbildung_duration_years_check
  check (ausbildung_duration_years in (2, 3));

comment on column public.profiles.ausbildung_duration_years is
  'Apprenticeship duration in years. Defaults to 3; trainers may set trainees to 2 or 3 years.';

commit;
