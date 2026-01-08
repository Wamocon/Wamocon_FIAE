-- ============================================================================
-- HAI.ai Migration 2: Create Embeddings Table
-- ============================================================================
-- Description: Creates the vector embeddings table for RAG-based search
-- Stores: Chunked content with 768-dimension vectors (Gemini embedding size)
-- ============================================================================

CREATE TABLE IF NOT EXISTS hai_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Source reference (which content this embedding is from)
    source_type TEXT NOT NULL CHECK (source_type IN ('enabler', 'course', 'document', 'quiz')),
    source_id UUID NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    
    -- Content and embedding
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL, -- SHA256 hash for deduplication
    embedding vector(768), -- Gemini embedding dimension
    
    -- Metadata for context (e.g., title, page number, etc.)
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate chunks for the same source
    UNIQUE(source_type, source_id, chunk_index)
);

-- Index for source lookups (find all embeddings for a specific enabler/course)
CREATE INDEX IF NOT EXISTS idx_hai_embeddings_source 
    ON hai_embeddings(source_type, source_id);

-- Index for vector similarity search using IVFFlat algorithm
-- lists = 100 is optimal for datasets up to ~100k vectors
CREATE INDEX IF NOT EXISTS idx_hai_embeddings_vector 
    ON hai_embeddings USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 100);

-- Index for deduplication checks (find existing content by hash)
CREATE INDEX IF NOT EXISTS idx_hai_embeddings_hash 
    ON hai_embeddings(content_hash);

-- Documentation
COMMENT ON TABLE hai_embeddings IS 'HAI.ai vector embeddings for RAG-based content search';
COMMENT ON COLUMN hai_embeddings.source_type IS 'Type of source: enabler, course, document, or quiz';
COMMENT ON COLUMN hai_embeddings.content_hash IS 'SHA256 hash of content for deduplication';
COMMENT ON COLUMN hai_embeddings.embedding IS '768-dimensional vector from Gemini embedding model';
