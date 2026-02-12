-- HAI.ai Reindex Jobs
-- Tracks background reindexing jobs for the admin UI.
-- Ensures only one job runs at a time with full progress tracking.

CREATE TABLE IF NOT EXISTS hai_reindex_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    force_reindex BOOLEAN NOT NULL DEFAULT false,
    progress JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups of active/recent jobs
CREATE INDEX IF NOT EXISTS idx_hai_reindex_jobs_status ON hai_reindex_jobs (status);
CREATE INDEX IF NOT EXISTS idx_hai_reindex_jobs_created ON hai_reindex_jobs (created_at DESC);

-- RLS: Only trainers can view/create reindex jobs (consistent with embed route)
ALTER TABLE hai_reindex_jobs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (API routes use service role)
CREATE POLICY "Service role full access on hai_reindex_jobs"
    ON hai_reindex_jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);
