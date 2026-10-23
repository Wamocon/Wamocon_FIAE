-- Security hardening 3 of 3 (separate decision): no anonymous read access to course content.
--
-- Measured read-only on production on 2026-10-23: 21 SELECT policies with
-- USING (true) apply to the role public, so anyone with the public key can read
-- courses, enablers, use cases, quizzes, questions and options through the
-- REST API, including the correct answers (options.is_correct).
--
-- The app does not use that path. In the source, supabase-js only touches the
-- tables profiles and notifications and the storage buckets. All course content
-- is read through Drizzle as the role postgres, which bypasses row level
-- security. The public catalog page also reads on the server.
--
-- Effect: after this file only service_role, postgres and the existing
-- *_manage_platform_owner policies reach these tables over the REST API.
-- Not affected: the app. Affected: any outside tool that reads these tables with
-- the anon key. Apply only after hardening 1 and 2 and after the smoke test in
-- docs/security-hardening-2026-10.md.
--
-- Undo (per table, example):
--   create policy courses_select_all on public.courses for select to public using (true);

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.certificate_text_templates') is not null then
    drop policy if exists ctt_select_all on public.certificate_text_templates;
  end if;
  if to_regclass('public.course_skills') is not null then
    drop policy if exists cs_select_all on public.course_skills;
  end if;
  if to_regclass('public.courses') is not null then
    drop policy if exists courses_select_all on public.courses;
  end if;
  if to_regclass('public.enabler_quiz_links') is not null then
    drop policy if exists eql_select_all on public.enabler_quiz_links;
  end if;
  if to_regclass('public.enabler_quizzes') is not null then
    drop policy if exists eq_select_all on public.enabler_quizzes;
  end if;
  if to_regclass('public.enablers') is not null then
    drop policy if exists enablers_select_all on public.enablers;
  end if;
  if to_regclass('public.lernfeld_mappings') is not null then
    drop policy if exists lfm_select_all on public.lernfeld_mappings;
  end if;
  if to_regclass('public.lernfelder') is not null then
    drop policy if exists lf_select_all on public.lernfelder;
  end if;
  if to_regclass('public.lessons') is not null then
    drop policy if exists lessons_select_all on public.lessons;
  end if;
  if to_regclass('public.mes_softskill_criteria') is not null then
    drop policy if exists msc_select_all on public.mes_softskill_criteria;
  end if;
  if to_regclass('public.modules') is not null then
    drop policy if exists modules_select_all on public.modules;
  end if;
  if to_regclass('public.options') is not null then
    drop policy if exists options_select_all on public.options;
  end if;
  if to_regclass('public.questions') is not null then
    drop policy if exists questions_select_all on public.questions;
  end if;
  if to_regclass('public.quizzes') is not null then
    drop policy if exists quizzes_select_all on public.quizzes;
  end if;
  if to_regclass('public.skills') is not null then
    drop policy if exists skills_select_all on public.skills;
  end if;
  if to_regclass('public.sub_lessons') is not null then
    drop policy if exists sub_lessons_select_all on public.sub_lessons;
  end if;
  if to_regclass('public.training_components') is not null then
    drop policy if exists tc_select_all on public.training_components;
  end if;
  if to_regclass('public.training_use_cases') is not null then
    drop policy if exists tuc_select_all on public.training_use_cases;
  end if;
  if to_regclass('public.use_cases') is not null then
    drop policy if exists use_cases_select_all on public.use_cases;
  end if;
end $$;
