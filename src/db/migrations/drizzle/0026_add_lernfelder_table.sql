-- Migration: Add lernfelder table
-- User Request: Create independent lernfelder with title, description, label (LF-1..12).

DROP TABLE IF EXISTS "lernfelder" CASCADE;
CREATE TABLE "lernfelder" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "description" text,
  "label" text NOT NULL, -- 'LF-1' to 'LF-12'
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);
