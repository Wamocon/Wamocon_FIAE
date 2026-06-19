-- ============================================================
-- RLS POLICIES: Multi-tenant organization isolation
-- ============================================================
-- This migration enables Row-Level Security on all tables and
-- creates policies for org-based data isolation.
--
-- auth.uid() is available when queries go through Supabase client.
-- For Drizzle ORM (direct postgres), org filtering is in app code.
-- RLS acts as a defense-in-depth safety net.
-- ============================================================

-- Helper function: get current user's organization_id
CREATE OR REPLACE FUNCTION public.get_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;--> statement-breakpoint

-- Helper function: check if current user belongs to platform-owner org
CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.organizations o ON p.organization_id = o.id
    WHERE p.id = auth.uid() AND o.is_platform_owner = true
  );
$$;--> statement-breakpoint

-- ============================================================
-- ORGANIZATIONS TABLE
-- ============================================================
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "org_select_own" ON "organizations"
  FOR SELECT USING (
    id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

CREATE POLICY "org_manage_platform_owner" ON "organizations"
  FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- ============================================================
-- PROFILES TABLE
-- ============================================================
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "profiles_select_own_org" ON "profiles"
  FOR SELECT USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

CREATE POLICY "profiles_update_own" ON "profiles"
  FOR UPDATE USING (id = auth.uid());--> statement-breakpoint

CREATE POLICY "profiles_manage_platform_owner" ON "profiles"
  FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- ============================================================
-- SHARED CONTENT TABLES (everyone reads, platform owner writes)
-- ============================================================

-- COURSES
ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "courses_select_all" ON "courses" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "courses_manage_platform_owner" ON "courses" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- ENABLERS
ALTER TABLE "enablers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "enablers_select_all" ON "enablers" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "enablers_manage_platform_owner" ON "enablers" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- USE_CASES
ALTER TABLE "use_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "use_cases_select_all" ON "use_cases" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "use_cases_manage_platform_owner" ON "use_cases" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- QUIZZES
ALTER TABLE "quizzes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quizzes_select_all" ON "quizzes" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "quizzes_manage_platform_owner" ON "quizzes" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- QUESTIONS
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "questions_select_all" ON "questions" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "questions_manage_platform_owner" ON "questions" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- OPTIONS
ALTER TABLE "options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "options_select_all" ON "options" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "options_manage_platform_owner" ON "options" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- ENABLER_QUIZ_LINKS
ALTER TABLE "enabler_quiz_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "eql_select_all" ON "enabler_quiz_links" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "eql_manage_platform_owner" ON "enabler_quiz_links" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- ENABLER_QUIZZES
ALTER TABLE "enabler_quizzes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "eq_select_all" ON "enabler_quizzes" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "eq_manage_platform_owner" ON "enabler_quizzes" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- SKILLS
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "skills_select_all" ON "skills" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "skills_manage_platform_owner" ON "skills" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- COURSE_SKILLS
ALTER TABLE "course_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cs_select_all" ON "course_skills" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "cs_manage_platform_owner" ON "course_skills" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- TRAINING_COMPONENTS
ALTER TABLE "training_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tc_select_all" ON "training_components" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "tc_manage_platform_owner" ON "training_components" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- TRAINING_USE_CASES
ALTER TABLE "training_use_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tuc_select_all" ON "training_use_cases" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "tuc_manage_platform_owner" ON "training_use_cases" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- LERNFELDER
ALTER TABLE "lernfelder" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lf_select_all" ON "lernfelder" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "lf_manage_platform_owner" ON "lernfelder" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- LERNFELD_MAPPINGS
ALTER TABLE "lernfeld_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lfm_select_all" ON "lernfeld_mappings" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "lfm_manage_platform_owner" ON "lernfeld_mappings" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- MES_SOFTSKILL_CRITERIA
ALTER TABLE "mes_softskill_criteria" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "msc_select_all" ON "mes_softskill_criteria" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "msc_manage_platform_owner" ON "mes_softskill_criteria" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- CERTIFICATE_TEXT_TEMPLATES
ALTER TABLE "certificate_text_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ctt_select_all" ON "certificate_text_templates" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "ctt_manage_platform_owner" ON "certificate_text_templates" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- HAI_EMBEDDINGS (shared knowledge base)
ALTER TABLE "hai_embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "he_select_all" ON "hai_embeddings" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "he_manage_platform_owner" ON "hai_embeddings" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- HAI_REINDEX_JOBS
ALTER TABLE "hai_reindex_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "hrj_select_all" ON "hai_reindex_jobs" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "hrj_manage_platform_owner" ON "hai_reindex_jobs" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

-- ============================================================
-- CONTENT_DOCUMENTS (mixed: NULL org = system, non-NULL = org-specific)
-- ============================================================
ALTER TABLE "content_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "cd_select" ON "content_documents"
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

CREATE POLICY "cd_insert_own_org" ON "content_documents"
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

CREATE POLICY "cd_update_own" ON "content_documents"
  FOR UPDATE USING (
    (uploaded_by_id = auth.uid() AND organization_id IS NOT NULL)
    OR public.is_platform_owner()
  );--> statement-breakpoint

CREATE POLICY "cd_delete_own" ON "content_documents"
  FOR DELETE USING (
    (uploaded_by_id = auth.uid() AND organization_id IS NOT NULL)
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ============================================================
-- ORG-SCOPED TABLES (own org + platform owner)
-- ============================================================

-- COURSE_MEMBERS
ALTER TABLE "course_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cm_org_isolation" ON "course_members"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ENABLER_SUBMISSIONS
ALTER TABLE "enabler_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "es_org_isolation" ON "enabler_submissions"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- USE_CASE_SUBMISSIONS
ALTER TABLE "use_case_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ucs_org_isolation" ON "use_case_submissions"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- USE_CASE_SUBMISSION_LINKS (inherit from submission)
ALTER TABLE "use_case_submission_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ucsl_via_submission" ON "use_case_submission_links"
  FOR ALL USING (
    submission_id IN (
      SELECT id FROM use_case_submissions
      WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- QUIZ_SUBMISSIONS
ALTER TABLE "quiz_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "qs_org_isolation" ON "quiz_submissions"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- QUIZ_SUBMISSION_ANSWERS (inherit from submission)
ALTER TABLE "quiz_submission_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "qsa_via_submission" ON "quiz_submission_answers"
  FOR ALL USING (
    submission_id IN (
      SELECT id FROM quiz_submissions
      WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- QUIZ_ASSIGNMENTS
ALTER TABLE "quiz_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "qa_org_isolation" ON "quiz_assignments"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- QUIZ_MEMBERS
ALTER TABLE "quiz_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "qm_org_isolation" ON "quiz_members"
  FOR ALL USING (
    trainer_id IN (
      SELECT id FROM profiles WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ENABLER_COMPLETIONS
ALTER TABLE "enabler_completions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ec_org_isolation" ON "enabler_completions"
  FOR ALL USING (
    trainee_id IN (
      SELECT id FROM profiles WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- TRAINEE_ENABLER_OVERRIDES
ALTER TABLE "trainee_enabler_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "teo_org_isolation" ON "trainee_enabler_overrides"
  FOR ALL USING (
    trainee_id IN (
      SELECT id FROM profiles WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- TRAINEE_USE_CASE_OVERRIDES
ALTER TABLE "trainee_use_case_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tuco_org_isolation" ON "trainee_use_case_overrides"
  FOR ALL USING (
    trainee_id IN (
      SELECT id FROM profiles WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- TRAINEE_ACHIEVED_SKILLS
ALTER TABLE "trainee_achieved_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tas_org_isolation" ON "trainee_achieved_skills"
  FOR ALL USING (
    trainee_id IN (
      SELECT id FROM profiles WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- NOTIFICATIONS
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notif_org_isolation" ON "notifications"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ACTIVITY_REPORTS
ALTER TABLE "activity_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ar_org_isolation" ON "activity_reports"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ACTIVITY_REPORT_ENTRIES (inherit from report)
ALTER TABLE "activity_report_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "are_via_report" ON "activity_report_entries"
  FOR ALL USING (
    report_id IN (
      SELECT id FROM activity_reports
      WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ACTIVITY_REPORT_USE_CASE_ENTRIES (inherit from report)
ALTER TABLE "activity_report_use_case_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "aruce_via_report" ON "activity_report_use_case_entries"
  FOR ALL USING (
    report_id IN (
      SELECT id FROM activity_reports
      WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- AUSBILDUNG_BLOCKS
ALTER TABLE "ausbildung_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ab_org_isolation" ON "ausbildung_blocks"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- SCHOOL_EXAMS
ALTER TABLE "school_exams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "se_org_isolation" ON "school_exams"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- SCHOOL_EXAM_RESULTS (inherit from exam)
ALTER TABLE "school_exam_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ser_via_exam" ON "school_exam_results"
  FOR ALL USING (
    exam_id IN (
      SELECT id FROM school_exams
      WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- WEEKLY_EVALUATIONS
ALTER TABLE "weekly_evaluations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "we_org_isolation" ON "weekly_evaluations"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- WEEKLY_SOFTSKILL_RATINGS (inherit from evaluation)
ALTER TABLE "weekly_softskill_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "wsr_via_evaluation" ON "weekly_softskill_ratings"
  FOR ALL USING (
    weekly_evaluation_id IN (
      SELECT id FROM weekly_evaluations
      WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ANNUAL_PERFORMANCE_SUMMARIES
ALTER TABLE "annual_performance_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "aps_org_isolation" ON "annual_performance_summaries"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- WORK_CERTIFICATES
ALTER TABLE "work_certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "wc_org_isolation" ON "work_certificates"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ACCEPTANCE_PROTOCOLS
ALTER TABLE "acceptance_protocols" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ap_org_isolation" ON "acceptance_protocols"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- HAI_CHAT_SESSIONS
ALTER TABLE "hai_chat_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "hcs_org_isolation" ON "hai_chat_sessions"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- HAI_CHAT_MESSAGES (inherit from session)
ALTER TABLE "hai_chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "hcm_via_session" ON "hai_chat_messages"
  FOR ALL USING (
    session_id IN (
      SELECT id FROM hai_chat_sessions
      WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- KNOWLEDGE_NOTES
ALTER TABLE "knowledge_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "kn_org_isolation" ON "knowledge_notes"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ACTIVITY_LOG
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "al_org_isolation" ON "activity_log"
  FOR ALL USING (
    organization_id = public.get_user_org_id()
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- GRADE_EDIT_HISTORY
ALTER TABLE "grade_edit_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "geh_org_isolation" ON "grade_edit_history"
  FOR ALL USING (
    changed_by IN (
      SELECT id FROM profiles WHERE organization_id = public.get_user_org_id()
    )
    OR public.is_platform_owner()
  );--> statement-breakpoint

-- ============================================================
-- LEGACY TABLES (basic policies)
-- ============================================================
ALTER TABLE "modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "modules_select_all" ON "modules" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "modules_manage_platform_owner" ON "modules" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lessons_select_all" ON "lessons" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "lessons_manage_platform_owner" ON "lessons" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

ALTER TABLE "sub_lessons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sub_lessons_select_all" ON "sub_lessons" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "sub_lessons_manage_platform_owner" ON "sub_lessons" FOR ALL USING (public.is_platform_owner());--> statement-breakpoint

ALTER TABLE "progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "progress_own" ON "progress"
  FOR ALL USING (
    user_id = auth.uid()
    OR public.is_platform_owner()
  );
