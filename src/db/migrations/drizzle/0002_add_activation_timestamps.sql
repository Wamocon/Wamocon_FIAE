-- Add activated_at to enablers and use_cases to track when countdown starts
ALTER TABLE enablers ADD COLUMN IF NOT EXISTS activated_at timestamp;
ALTER TABLE use_cases ADD COLUMN IF NOT EXISTS activated_at timestamp;
