-- Migration: Support text-answer quiz questions

-- 1) Enum for question type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'question_type') THEN
    CREATE TYPE question_type AS ENUM ('MCQ','TEXT');
  END IF;
END $$;

-- 2) Alter questions: add question_type and expected_answer
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS question_type question_type NOT NULL DEFAULT 'MCQ';
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS expected_answer text;

-- 3) Alter quiz_submission_answers: allow text answers
ALTER TABLE quiz_submission_answers
  ADD COLUMN IF NOT EXISTS text_answer text;

-- Make selected_option_id nullable to support TEXT answers
ALTER TABLE quiz_submission_answers
  ALTER COLUMN selected_option_id DROP NOT NULL;
