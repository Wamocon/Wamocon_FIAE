-- Migration: Add extra fields to use_cases
-- User Request: year (1-3), training_stage (1-2), lernfelder (LF-1..LF-12, multi)

ALTER TABLE "use_cases" ADD COLUMN "year" integer;
ALTER TABLE "use_cases" ADD COLUMN "training_stage" integer;
ALTER TABLE "use_cases" ADD COLUMN "lernfelder" text[];
