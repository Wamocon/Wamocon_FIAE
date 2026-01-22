-- ============================================================================
-- HAI.ai Migration 1: Enable pgvector Extension
-- ============================================================================
-- Description: Enables the pgvector extension for vector similarity search
-- Required for: Embedding storage and semantic search functionality
-- Compatibility: PostgreSQL 15+ with pgvector extension installed
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        RAISE EXCEPTION 'pgvector extension failed to install';
    END IF;
END $$;
