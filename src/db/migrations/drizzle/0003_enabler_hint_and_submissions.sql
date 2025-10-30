-- Add hint text to enablers for scenario help
ALTER TABLE enablers ADD COLUMN IF NOT EXISTS hint_text text;

-- Create enabler_submissions table for trainee solutions
CREATE TABLE IF NOT EXISTS enabler_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enabler_id uuid NOT NULL REFERENCES enablers(id) ON DELETE CASCADE,
  solution_text text,
  status review_status DEFAULT 'PENDING',
  trainer_feedback text,
  reviewed_by_id uuid REFERENCES profiles(id),
  reviewed_at timestamp,
  submitted_at timestamp DEFAULT now()
);
