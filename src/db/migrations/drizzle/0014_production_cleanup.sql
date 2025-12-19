-- Migration: Production cleanup - Removes test/seed data
-- Preserves: profiles (user accounts), Supabase Storage files (PDFs)
-- Run this ONCE before importing production data

-- IMPORTANT: This migration is DESTRUCTIVE. All test data will be permanently deleted.

-- =====================================================
-- 1. CLEAR SUBMISSION & PROGRESS DATA
-- =====================================================

-- Quiz submissions and answers
DELETE FROM "quiz_submission_answers";
DELETE FROM "quiz_submissions";
DELETE FROM "quiz_assignments";

-- Enabler submissions and completions
DELETE FROM "enabler_submissions";
DELETE FROM "enabler_completions";

-- Use case submissions
DELETE FROM "use_case_submission_links";
DELETE FROM "use_case_submissions";

-- =====================================================
-- 2. CLEAR TRAINEE PROGRESS DATA
-- =====================================================

DELETE FROM "reflections";
DELETE FROM "knowledge_notes";
DELETE FROM "acceptance_protocols";
DELETE FROM "trainee_achieved_skills";

-- Override tables
DELETE FROM "trainee_enabler_overrides";
DELETE FROM "trainee_use_case_overrides";

-- =====================================================
-- 3. CLEAR CONTENT DOCUMENTS (metadata only)
-- =====================================================
-- NOTE: This only removes database records, NOT the actual PDF files in Supabase Storage

DELETE FROM "content_documents";

-- =====================================================
-- 4. CLEAR QUIZ STRUCTURE
-- =====================================================

DELETE FROM "options";
DELETE FROM "questions";
DELETE FROM "enabler_quiz_links";
DELETE FROM "enabler_quizzes";
DELETE FROM "quiz_members";
DELETE FROM "quizzes";

-- =====================================================
-- 5. CLEAR COURSE CONTENT
-- =====================================================

DELETE FROM "enablers";
DELETE FROM "use_cases";

-- =====================================================
-- 6. CLEAR MEMBERSHIPS (but NOT profiles)
-- =====================================================

DELETE FROM "course_members";
DELETE FROM "course_skills";

-- =====================================================
-- 7. CLEAR SKILLS & COURSES
-- =====================================================

DELETE FROM "skills";
DELETE FROM "courses";

-- =====================================================
-- 8. CLEAR ACTIVITY & NOTIFICATIONS
-- =====================================================

DELETE FROM "activity_log";
DELETE FROM "notifications";

-- =====================================================
-- PRESERVED (NOT DELETED):
-- =====================================================
-- ✓ profiles - All user accounts and credentials
-- ✓ Supabase Storage - All uploaded PDF files remain in the bucket
-- =====================================================
