-- Migration: Clean up test/seed data for production
-- This removes all demo data while preserving the schema and real user profiles
-- Run this ONCE before importing production data

-- IMPORTANT: This migration is DESTRUCTIVE. Backup your data first!

-- 1. Clear activity logs (test activities)
DELETE FROM "activity_log";

-- 2. Clear quiz-related submissions and answers
DELETE FROM "quiz_submission_answers";
DELETE FROM "quiz_submissions";
DELETE FROM "quiz_assignments";

-- 3. Clear enabler-related submissions
DELETE FROM "enabler_submissions";
DELETE FROM "enabler_completions";

-- 4. Clear use case submissions and links
DELETE FROM "use_case_submission_links";
DELETE FROM "use_case_submissions";

-- 5. Clear trainee progress data
DELETE FROM "reflections";
DELETE FROM "knowledge_notes";
DELETE FROM "acceptance_protocols";
DELETE FROM "trainee_achieved_skills";

-- 6. Clear override tables
DELETE FROM "trainee_enabler_overrides";
DELETE FROM "trainee_use_case_overrides";

-- 7. Clear content documents (uploaded PDFs metadata)
DELETE FROM "content_documents";

-- 8. Clear quiz structure (questions, options, quiz links)
DELETE FROM "options";
DELETE FROM "questions";
DELETE FROM "enabler_quiz_links";
DELETE FROM "enabler_quizzes";
DELETE FROM "quiz_members";
DELETE FROM "quizzes";

-- 9. Clear course content
DELETE FROM "enablers";
DELETE FROM "use_cases";

-- 10. Clear course memberships (but keep profiles)
DELETE FROM "course_members";
DELETE FROM "course_skills";

-- 11. Clear skills and courses
DELETE FROM "skills";
DELETE FROM "courses";

-- 12. Clear notifications
DELETE FROM "notifications";

-- NOTE: Profiles are NOT deleted to preserve real user accounts
-- If you need to remove test profiles, do it manually after verifying
-- which accounts are real vs test accounts.
