-- Migration 0033: Grade Acceptance Workflow
-- Replaces the confusing 3-column grade system (trainee/trainer/release) with a 
-- proper Beurteilungsgespräch (evaluation discussion) workflow.
--
-- New flow:
-- 1. Trainee submits report with MANDATORY self-grades (traineeGrade)
-- 2. Trainer grades → gradeStatus = 'PENDING_ACCEPTANCE'
-- 3. Trainee accepts or disputes → 'ACCEPTED' or 'DISPUTED'
-- 4. If disputed: trainer adjusts and re-sends → 'PENDING_ACCEPTANCE'
-- 5. Cycle until trainee accepts → grades are FINAL
--
-- The trainerGrade IS the final grade once accepted. No separate releaseGrade needed.

-- Step 1: Create the grade acceptance status enum
DO $$ BEGIN
  CREATE TYPE grade_acceptance_status AS ENUM (
    'NOT_GRADED',
    'PENDING_ACCEPTANCE',
    'DISPUTED',
    'ACCEPTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Add grade acceptance columns to activity_reports
ALTER TABLE activity_reports
  ADD COLUMN IF NOT EXISTS grade_status grade_acceptance_status DEFAULT 'NOT_GRADED',
  ADD COLUMN IF NOT EXISTS grade_dispute_comment text,
  ADD COLUMN IF NOT EXISTS grade_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS grade_accepted_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS grade_disputed_at timestamptz;

-- Step 3: Backwards compatibility - migrate existing graded data
-- For entries where releaseGrade exists but differs from trainerGrade,
-- copy releaseGrade → trainerGrade (since releaseGrade was the "final" grade)
UPDATE activity_report_use_case_entries 
SET trainer_grade = release_grade 
WHERE release_grade IS NOT NULL 
  AND (trainer_grade IS NULL OR trainer_grade != release_grade);

-- Same for weekly evaluations
UPDATE weekly_evaluations 
SET trainer_rating = release_rating 
WHERE release_rating IS NOT NULL 
  AND (trainer_rating IS NULL OR trainer_rating != release_rating);

-- Same for weekly softskill ratings
UPDATE weekly_softskill_ratings 
SET trainer_rating = release_rating 
WHERE release_rating IS NOT NULL 
  AND (trainer_rating IS NULL OR trainer_rating != release_rating);

-- Step 4: Set gradeStatus = ACCEPTED for all approved reports that already have grades
UPDATE activity_reports 
SET grade_status = 'ACCEPTED',
    grade_accepted_at = COALESCE(trainer_signed_at, reviewed_at, NOW())
WHERE status = 'APPROVED' 
  AND id IN (
    SELECT DISTINCT report_id 
    FROM activity_report_use_case_entries 
    WHERE trainer_grade IS NOT NULL
  );

-- Step 5: Create index for efficient grade status queries
CREATE INDEX IF NOT EXISTS idx_activity_reports_grade_status 
  ON activity_reports(grade_status) 
  WHERE grade_status IS NOT NULL;
