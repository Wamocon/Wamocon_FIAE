-- Add attempt_number columns
ALTER TABLE "enabler_submissions"
  ADD COLUMN IF NOT EXISTS "attempt_number" integer;

ALTER TABLE "use_case_submissions"
  ADD COLUMN IF NOT EXISTS "attempt_number" integer;

ALTER TABLE "quiz_submissions"
  ADD COLUMN IF NOT EXISTS "attempt_number" integer;

-- Backfill attempt numbers using row_number over partitions
WITH ranked_enabler AS (
  SELECT id, row_number() OVER (PARTITION BY trainee_id, enabler_id ORDER BY submitted_at ASC) AS rn
  FROM enabler_submissions
)
UPDATE enabler_submissions e
SET attempt_number = r.rn
FROM ranked_enabler r
WHERE e.id = r.id AND e.attempt_number IS NULL;

WITH ranked_use_case AS (
  SELECT id, row_number() OVER (PARTITION BY trainee_id, use_case_id ORDER BY submitted_at ASC) AS rn
  FROM use_case_submissions
)
UPDATE use_case_submissions u
SET attempt_number = r.rn
FROM ranked_use_case r
WHERE u.id = r.id AND u.attempt_number IS NULL;

WITH ranked_quiz AS (
  SELECT id, row_number() OVER (PARTITION BY trainee_id, quiz_id ORDER BY submitted_at ASC) AS rn
  FROM quiz_submissions
)
UPDATE quiz_submissions q
SET attempt_number = r.rn
FROM ranked_quiz r
WHERE q.id = r.id AND q.attempt_number IS NULL;
