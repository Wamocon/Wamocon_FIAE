-- Migration: Add content_documents table for PDF flipbook viewer
-- This table stores PDF documents linked to enablers, use cases, or courses

-- Create the document type enum
DO $$ BEGIN
    CREATE TYPE "content_document_type" AS ENUM ('THEORY', 'EXERCISE', 'REFERENCE', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the content_documents table
CREATE TABLE IF NOT EXISTS "content_documents" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "enabler_id" uuid REFERENCES "enablers"("id") ON DELETE CASCADE,
    "use_case_id" uuid REFERENCES "use_cases"("id") ON DELETE CASCADE,
    "course_id" uuid REFERENCES "courses"("id") ON DELETE CASCADE,
    "title" text NOT NULL,
    "description" text,
    "document_type" "content_document_type" DEFAULT 'THEORY',
    "file_name" text NOT NULL,
    "file_size" integer,
    "mime_type" text DEFAULT 'application/pdf',
    "storage_url" text NOT NULL,
    "storage_path" text,
    "order_index" integer DEFAULT 0,
    "uploaded_by_id" uuid REFERENCES "profiles"("id"),
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now()
);

-- Add index for faster lookups by enabler
CREATE INDEX IF NOT EXISTS "idx_content_documents_enabler" ON "content_documents" ("enabler_id");
CREATE INDEX IF NOT EXISTS "idx_content_documents_use_case" ON "content_documents" ("use_case_id");
CREATE INDEX IF NOT EXISTS "idx_content_documents_course" ON "content_documents" ("course_id");
