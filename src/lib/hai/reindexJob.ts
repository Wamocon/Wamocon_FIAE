/**
 * HAI.ai Reindex Job Manager
 *
 * Manages background reindexing jobs with:
 *   - Progress tracking (stored in DB)
 *   - Resume capability (picks up from last successful chunk)
 *   - Rate limiting (respects Gemini free tier: ~1.5 req/sec)
 *   - Non-blocking execution (returns immediately, polls for status)
 *   - Error isolation (one failing enabler doesn't crash the whole job)
 *
 * ARCHITECTURE:
 *   1. API route creates a job record → returns jobId immediately
 *   2. Job runs in-process via setTimeout(0) (non-blocking)
 *   3. Admin UI polls GET /api/hai/embed?jobId=xxx for progress
 *   4. Job updates progress in DB after each source completes
 *
 * @module lib/hai/reindexJob
 */

import haiDb from '@/db/haiDb';
import { sql } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export type ReindexJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ReindexJob {
  id: string;
  status: ReindexJobStatus;
  forceReindex: boolean;
  progress: ReindexProgress;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  error: string | null;
}

export interface ReindexProgress {
  /** Total sources (enablers + documents) to process */
  totalSources: number;
  /** Sources processed so far */
  processedSources: number;
  /** Total chunks embedded */
  totalChunksIndexed: number;
  /** Chunks skipped (already up-to-date) */
  totalChunksSkipped: number;
  /** Sources that failed */
  failedSources: number;
  /** Error messages per source */
  errors: string[];
  /** Currently processing source name */
  currentSource: string | null;
  /** Enablers processed */
  enablersProcessed: number;
  /** Documents processed */
  documentsProcessed: number;
}

// ============================================================================
// IN-MEMORY JOB STATE (for active job tracking)
// ============================================================================

/**
 * We only allow ONE reindex job at a time.
 * This prevents concurrent embedding API calls that would exceed rate limits.
 */
let _activeJobId: string | null = null;

// ============================================================================
// JOB MANAGEMENT
// ============================================================================

/**
 * Create a new reindex job record in the database.
 * Returns the job ID immediately — the actual work starts separately.
 */
export async function createReindexJob(
  forceReindex: boolean
): Promise<{ jobId: string; error?: string }> {
  // Check if a job is already running
  if (_activeJobId) {
    const existing = await getJobStatus(_activeJobId);
    if (
      existing &&
      (existing.status === 'pending' || existing.status === 'running')
    ) {
      return {
        jobId: '',
        error:
          'Ein Reindex-Job läuft bereits. Bitte warten Sie, bis er abgeschlossen ist.',
      };
    }
    // Previous job finished, allow new one
    _activeJobId = null;
  }

  const initialProgress: ReindexProgress = {
    totalSources: 0,
    processedSources: 0,
    totalChunksIndexed: 0,
    totalChunksSkipped: 0,
    failedSources: 0,
    errors: [],
    currentSource: null,
    enablersProcessed: 0,
    documentsProcessed: 0,
  };

  // Create job record
  const result = await haiDb.execute(sql`
        INSERT INTO hai_reindex_jobs (status, force_reindex, progress)
        VALUES ('pending', ${forceReindex}, ${initialProgress}::jsonb)
        RETURNING id
    `);

  const jobId = (result as any)[0]?.id;
  if (!jobId) {
    throw new Error('Failed to create reindex job');
  }

  _activeJobId = jobId;

  return { jobId };
}

/**
 * Get the current status of a reindex job.
 */
export async function getJobStatus(jobId: string): Promise<ReindexJob | null> {
  try {
    const result = await haiDb.execute(sql`
            SELECT id, status, force_reindex, progress, started_at, completed_at, created_at, error
            FROM hai_reindex_jobs
            WHERE id = ${jobId}::uuid
            LIMIT 1
        `);

    const row = (result as any)[0];
    if (!row) return null;

    return {
      id: row.id,
      status: row.status as ReindexJobStatus,
      forceReindex: row.force_reindex,
      progress: row.progress as ReindexProgress,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      createdAt: new Date(row.created_at),
      error: row.error,
    };
  } catch (error) {
    console.error('HAI.ai: Error getting job status:', error);
    return null;
  }
}

/**
 * Get the most recent reindex job (for showing status on page load).
 */
export async function getLatestJob(): Promise<ReindexJob | null> {
  try {
    const result = await haiDb.execute(sql`
            SELECT id, status, force_reindex, progress, started_at, completed_at, created_at, error
            FROM hai_reindex_jobs
            ORDER BY created_at DESC
            LIMIT 1
        `);

    const row = (result as any)[0];
    if (!row) return null;

    return {
      id: row.id,
      status: row.status as ReindexJobStatus,
      forceReindex: row.force_reindex,
      progress: row.progress as ReindexProgress,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      createdAt: new Date(row.created_at),
      error: row.error,
    };
  } catch (error) {
    console.error('HAI.ai: Error getting latest job:', error);
    return null;
  }
}

/**
 * Request cancellation of the active job.
 * Persists cancel flag to the database so it works across serverless instances.
 * The job will stop at the next source boundary (won't stop mid-chunk).
 */
export async function requestCancellation(): Promise<boolean> {
  // Try in-memory job ID first, then fall back to latest running job from DB
  let jobId = _activeJobId;

  if (!jobId) {
    // Find the currently running job from DB (handles cross-instance scenario)
    try {
      const result = await haiDb.execute(sql`
        SELECT id FROM hai_reindex_jobs
        WHERE status IN ('pending', 'running')
        ORDER BY created_at DESC
        LIMIT 1
      `);
      jobId = (result as any)[0]?.id || null;
    } catch {
      return false;
    }
  }

  if (!jobId) return false;

  try {
    await haiDb.execute(sql`
      UPDATE hai_reindex_jobs
      SET
        progress = progress || '{"cancelRequested": true}'::jsonb,
        updated_at = NOW()
      WHERE id = ${jobId}::uuid
        AND status IN ('pending', 'running')
    `);
    return true;
  } catch (err) {
    console.error('HAI.ai: Error requesting cancellation:', err);
    return false;
  }
}

/**
 * Check if cancellation was requested for the given job.
 * Reads from the database for cross-instance consistency.
 */
export async function isCancellationRequested(
  jobId?: string
): Promise<boolean> {
  const targetJobId = jobId || _activeJobId;
  if (!targetJobId) return false;

  try {
    const result = await haiDb.execute(sql`
      SELECT (progress->>'cancelRequested')::boolean AS cancel_requested
      FROM hai_reindex_jobs
      WHERE id = ${targetJobId}::uuid
      LIMIT 1
    `);
    return (result as any)[0]?.cancel_requested === true;
  } catch {
    return false;
  }
}

// ============================================================================
// PROGRESS UPDATES
// ============================================================================

/**
 * Update job progress in the database.
 * Uses jsonb merge so partial updates work correctly.
 */
export async function updateJobProgress(
  jobId: string,
  progress: Partial<ReindexProgress>
): Promise<void> {
  try {
    await haiDb.execute(sql`
            UPDATE hai_reindex_jobs
            SET
                progress = progress || ${progress}::jsonb,
                updated_at = NOW()
            WHERE id = ${jobId}::uuid
        `);
  } catch (err) {
    console.error('HAI.ai: Error updating job progress:', err);
  }
}

/**
 * Transition job to 'running' state.
 */
export async function markJobRunning(jobId: string): Promise<void> {
  try {
    await haiDb.execute(sql`
            UPDATE hai_reindex_jobs
            SET status = 'running', started_at = NOW(), updated_at = NOW()
            WHERE id = ${jobId}::uuid
        `);
  } catch (err) {
    console.error('HAI.ai: Error marking job running:', err);
  }
}

/**
 * Transition job to 'completed' state.
 */
export async function markJobCompleted(
  jobId: string,
  progress: ReindexProgress
): Promise<void> {
  try {
    await haiDb.execute(sql`
            UPDATE hai_reindex_jobs
            SET
                status = 'completed',
                progress = ${progress}::jsonb,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = ${jobId}::uuid
        `);
  } catch (err) {
    console.error('HAI.ai: Error marking job completed:', err);
  }
  clearActiveJob();
}

/**
 * Transition job to 'failed' state.
 */
export async function markJobFailed(
  jobId: string,
  error: string,
  progress: ReindexProgress
): Promise<void> {
  try {
    await haiDb.execute(sql`
            UPDATE hai_reindex_jobs
            SET
                status = 'failed',
                error = ${error},
                progress = ${progress}::jsonb,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = ${jobId}::uuid
        `);
  } catch (err) {
    console.error('HAI.ai: Error marking job failed:', err);
  }
  clearActiveJob();
}

/**
 * Transition job to 'cancelled' state.
 */
export async function markJobCancelled(
  jobId: string,
  progress: ReindexProgress
): Promise<void> {
  try {
    await haiDb.execute(sql`
            UPDATE hai_reindex_jobs
            SET
                status = 'cancelled',
                progress = ${progress}::jsonb,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = ${jobId}::uuid
        `);
  } catch (err) {
    console.error('HAI.ai: Error marking job cancelled:', err);
  }
  clearActiveJob();
}

/**
 * Mark the active job as complete and clear state.
 */
export function clearActiveJob(): void {
  _activeJobId = null;
}
