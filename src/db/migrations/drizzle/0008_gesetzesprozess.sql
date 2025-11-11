-- Migration: Add Gesetzesprozess (legislative process) content & submission tables
-- Mirrors use_cases and use_case_submissions structure.

CREATE TABLE IF NOT EXISTS gesetzesprozesse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description_text text NOT NULL,
  order_index integer NOT NULL,
  duration_value integer,
  duration_unit duration_unit,
  is_active boolean DEFAULT false,
  activated_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS gesetzesprozess_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gesetzesprozess_id uuid NOT NULL REFERENCES gesetzesprozesse(id) ON DELETE CASCADE,
  submission_text text,
  status review_status DEFAULT 'PENDING',
  trainer_feedback text,
  reviewed_by_id uuid REFERENCES profiles(id),
  reviewed_at timestamp,
  submitted_at timestamp DEFAULT now() NOT NULL,
  attempt_number integer
);

CREATE TABLE IF NOT EXISTS gesetzesprozess_submission_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES gesetzesprozess_submissions(id) ON DELETE CASCADE,
  url text NOT NULL,
  description text
);

-- Basic indexes (optional for performance)
CREATE INDEX IF NOT EXISTS idx_gesetzesprozesse_course ON gesetzesprozesse(course_id);
CREATE INDEX IF NOT EXISTS idx_gesetzesprozess_sub_trainee ON gesetzesprozess_submissions(trainee_id);
CREATE INDEX IF NOT EXISTS idx_gesetzesprozess_sub_gp ON gesetzesprozess_submissions(gesetzesprozess_id);
