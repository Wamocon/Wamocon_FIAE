-- Migration: Use Case PDF Support with PageIndex for HAI
-- Date: 2026-02-11
-- Description: Adds new document types for trainee/trainer PDFs, visibility control, and HAI PageIndex support
-- NOTE: This migration is split into two transactions because PostgreSQL requires 
-- new enum values to be committed before they can be used in UPDATE statements.

-- ============================================================================
-- TRANSACTION 1: Add enum values (must be committed first)
-- ============================================================================

-- Add new document types for role-based visibility
ALTER TYPE content_document_type ADD VALUE IF NOT EXISTS 'TRAINEE_QUESTION';
ALTER TYPE content_document_type ADD VALUE IF NOT EXISTS 'TRAINER_SOLUTION';

-- Create document_visibility enum
DO $$ BEGIN
    CREATE TYPE document_visibility AS ENUM ('ALL', 'TRAINEE_ONLY', 'TRAINER_ONLY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add 'use_case' to hai_source_type for embeddings (skip if not exists)
DO $$ BEGIN
    ALTER TYPE hai_source_type ADD VALUE IF NOT EXISTS 'use_case';
EXCEPTION
    WHEN undefined_object THEN null;
END $$;

-- Add 'use_case' to hai_context_type for chat sessions (skip if not exists)
DO $$ BEGIN
    ALTER TYPE hai_context_type ADD VALUE IF NOT EXISTS 'use_case';
EXCEPTION
    WHEN undefined_object THEN null;
END $$;

-- ============================================================================
-- TRANSACTION 2: Add columns and indexes (run after enum commit)
-- ============================================================================

-- Add visibility column for role-based access control
ALTER TABLE content_documents 
ADD COLUMN IF NOT EXISTS visibility document_visibility DEFAULT 'ALL';

-- Add page count for PageIndex support
ALTER TABLE content_documents 
ADD COLUMN IF NOT EXISTS page_count INTEGER;

-- Add HAI indexing status
ALTER TABLE content_documents 
ADD COLUMN IF NOT EXISTS is_indexed_by_hai BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index for role-based document queries
CREATE INDEX IF NOT EXISTS idx_content_documents_visibility 
ON content_documents(visibility);

-- Index for use case documents
CREATE INDEX IF NOT EXISTS idx_content_documents_use_case_id 
ON content_documents(use_case_id) 
WHERE use_case_id IS NOT NULL;

-- Index for HAI indexing status
CREATE INDEX IF NOT EXISTS idx_content_documents_hai_indexed 
ON content_documents(is_indexed_by_hai) 
WHERE is_indexed_by_hai = TRUE;

-- Composite index for HAI embeddings by source type and page metadata (skip if table not exists)
CREATE INDEX IF NOT EXISTS idx_hai_embeddings_use_case 
ON hai_embeddings(source_type, source_id) 
WHERE source_type = 'use_case';

-- ============================================================================
-- DATA MIGRATION
-- ============================================================================

-- Auto-set visibility based on document type
UPDATE content_documents 
SET visibility = 'TRAINER_ONLY' 
WHERE document_type = 'TRAINER_SOLUTION' AND visibility = 'ALL';

UPDATE content_documents 
SET visibility = 'ALL' 
WHERE document_type = 'TRAINEE_QUESTION' AND visibility IS NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN content_documents.visibility IS 'Role-based access: ALL (both roles), TRAINEE_ONLY, TRAINER_ONLY';
COMMENT ON COLUMN content_documents.page_count IS 'Total PDF pages for PageIndex citation support';
COMMENT ON COLUMN content_documents.is_indexed_by_hai IS 'True after HAI has processed and embedded this document';
