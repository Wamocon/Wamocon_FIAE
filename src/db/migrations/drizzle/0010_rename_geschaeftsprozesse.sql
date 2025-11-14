-- Rename Geschäftsprozesse-related tables and columns to ASCII-safe identifiers
-- This preserves existing data while avoiding issues with non-ASCII in hosted environments.

-- Tables
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Geschäftsprozesse') THEN
    EXECUTE 'ALTER TABLE "Geschäftsprozesse" RENAME TO geschaeftsprozesse';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='geschäftsprozesse_submissions') THEN
    EXECUTE 'ALTER TABLE "geschäftsprozesse_submissions" RENAME TO geschaeftsprozesse_submissions';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='geschäftsprozesse_submission_links') THEN
    EXECUTE 'ALTER TABLE "geschäftsprozesse_submission_links" RENAME TO geschaeftsprozesse_submission_links';
  END IF;
END $$;

-- Columns
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='geschaeftsprozesse_submissions' AND column_name='geschäftsprozesse_id'
  ) THEN
    EXECUTE 'ALTER TABLE geschaeftsprozesse_submissions RENAME COLUMN "geschäftsprozesse_id" TO geschaeftsprozesse_id';
  END IF;
END $$;

-- Indexes (drop old if exist, create new if missing)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_Geschäftsprozesse_course') THEN
    EXECUTE 'DROP INDEX IF EXISTS "idx_Geschäftsprozesse_course"';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_geschaeftsprozesse_course ON geschaeftsprozesse(course_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_geschäftsprozesse_sub_trainee') THEN
    EXECUTE 'DROP INDEX IF EXISTS "idx_geschäftsprozesse_sub_trainee"';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_geschaeftsprozesse_sub_trainee ON geschaeftsprozesse_submissions(trainee_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_geschäftsprozesse_sub_gp') THEN
    EXECUTE 'DROP INDEX IF EXISTS "idx_geschäftsprozesse_sub_gp"';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_geschaeftsprozesse_sub_gp ON geschaeftsprozesse_submissions(geschaeftsprozesse_id);
