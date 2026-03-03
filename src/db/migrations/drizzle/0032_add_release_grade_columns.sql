-- Migration: Add 3-Column Grading System (Trainee / Trainer / Release Grade)
-- This adds release grade and trainee self-grade columns to support:
-- 1. Trainee self-grading on use case entries
-- 2. Final release grade after trainer-trainee discussion
-- 3. Release ratings for softskill evaluations

-- === ACTIVITY REPORT USE CASE ENTRIES ===
-- Add trainee self-grade (trainee rates their own performance per use case)
ALTER TABLE activity_report_use_case_entries
  ADD COLUMN IF NOT EXISTS trainee_grade performance_rating;

-- Add release grade (final grade after discussion between trainer and trainee)
ALTER TABLE activity_report_use_case_entries
  ADD COLUMN IF NOT EXISTS release_grade performance_rating;

-- Add release grade comment (reason for any change from trainer grade)
ALTER TABLE activity_report_use_case_entries
  ADD COLUMN IF NOT EXISTS release_grade_comment TEXT;

-- Add release metadata
ALTER TABLE activity_report_use_case_entries
  ADD COLUMN IF NOT EXISTS release_grade_at TIMESTAMP;

ALTER TABLE activity_report_use_case_entries
  ADD COLUMN IF NOT EXISTS release_grade_by UUID REFERENCES profiles(id);

-- === WEEKLY EVALUATIONS ===
-- Add release rating (final overall rating after discussion)
ALTER TABLE weekly_evaluations
  ADD COLUMN IF NOT EXISTS release_rating performance_rating;

-- Add release comment
ALTER TABLE weekly_evaluations
  ADD COLUMN IF NOT EXISTS release_comment TEXT;

-- Add release metadata
ALTER TABLE weekly_evaluations
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMP;

ALTER TABLE weekly_evaluations
  ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES profiles(id);

-- === WEEKLY SOFTSKILL RATINGS ===
-- Add release rating per softskill criterion
ALTER TABLE weekly_softskill_ratings
  ADD COLUMN IF NOT EXISTS release_rating performance_rating;

-- Add release comment per softskill
ALTER TABLE weekly_softskill_ratings
  ADD COLUMN IF NOT EXISTS release_comment TEXT;

-- === GRADE EDIT HISTORY (Audit Trail) ===
-- Track all grade changes for accountability
CREATE TABLE IF NOT EXISTS grade_edit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What was edited
  entity_type TEXT NOT NULL CHECK (entity_type IN ('USE_CASE_ENTRY', 'WEEKLY_EVALUATION', 'SOFTSKILL_RATING')),
  entity_id UUID NOT NULL,
  
  -- The field that changed
  field_name TEXT NOT NULL, -- e.g., 'trainerGrade', 'releaseGrade', 'trainerRating'
  
  -- Old and new values
  old_value TEXT,
  new_value TEXT,
  
  -- Who made the change
  changed_by UUID NOT NULL REFERENCES profiles(id),
  change_reason TEXT, -- Optional reason for the edit
  
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_grade_edit_history_entity 
  ON grade_edit_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_grade_edit_history_changed_by 
  ON grade_edit_history(changed_by);
