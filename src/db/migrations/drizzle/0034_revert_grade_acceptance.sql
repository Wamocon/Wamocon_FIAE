-- Migration 0034: Revert Grade Acceptance Workflow
-- Removes the accept/dispute workflow introduced in 0033.
-- Per business requirement: trainee self-grades are practice only,
-- trainer grade is final, Release Grade happens in Arbeitszeugnis (annual).
-- No grades shown on Tätigkeitsnachweis PDF.

-- Step 1: Drop grade acceptance columns from activity_reports
ALTER TABLE activity_reports
  DROP COLUMN IF EXISTS grade_status,
  DROP COLUMN IF EXISTS grade_dispute_comment,
  DROP COLUMN IF EXISTS grade_accepted_at,
  DROP COLUMN IF EXISTS grade_accepted_by,
  DROP COLUMN IF EXISTS grade_disputed_at;

-- Step 2: Drop the index created in 0033
DROP INDEX IF EXISTS idx_activity_reports_grade_status;

-- Step 3: Drop the enum type (safe - no longer referenced)
DROP TYPE IF EXISTS grade_acceptance_status;
