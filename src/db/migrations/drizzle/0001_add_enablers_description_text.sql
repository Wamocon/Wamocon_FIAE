-- Add description_text column to enablers to support separate description and scenario
ALTER TABLE "enablers" ADD COLUMN IF NOT EXISTS "description_text" text;