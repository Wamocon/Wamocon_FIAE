ALTER TABLE "quiz_submissions"
  ADD COLUMN IF NOT EXISTS "trainer_feedback" text,
  ADD COLUMN IF NOT EXISTS "reviewed_by_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
