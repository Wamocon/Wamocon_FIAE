/**
 * HAI.ai Embedding Service
 *
 * Generates and stores vector embeddings for content indexing.
 * Handles deduplication, batch processing, rate limiting, and database storage.
 *
 * CHANGES (Phase 0C — Bulletproof Reindex):
 *   - Rate limiting: 1 request per 700ms (safe for Gemini free tier 1.67 req/s)
 *   - UPSERT-only: No more delete-before-insert (ON CONFLICT DO UPDATE)
 *   - Progress callbacks: Report progress to background job manager
 *   - Error isolation: One failing chunk doesn't crash the batch
 *   - Uses provider layer instead of direct haiClient for embeddings
 *
 * @module lib/hai/embeddings
 */

import { createHash } from 'crypto';
import { getEmbeddingProvider } from './providers';
import { chunkDocument } from './chunker';
import {
  chunkIndexRange,
  scopeProblem,
  type HaiVisibility,
} from './indexScope';
import haiDb from '@/db/haiDb';
import { haiEmbeddings } from '@/db/migrations/schemas/schema';
import { eq, and, sql } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export type SourceType =
  | 'enabler'
  | 'course'
  | 'document'
  | 'quiz'
  | 'use_case'
  | 'trainee_schedule'
  | 'trainee_profile'
  | 'trainee_progress';

export interface IndexContentOptions {
  sourceType: SourceType;
  sourceId: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  forceReindex?: boolean;
  /**
   * Scope of the chunks, always set by the caller (no default): the
   * occupation (training catalog) of the source, who may see the chunks and
   * the owning organization (null = platform content). A call without a
   * complete scope writes nothing: a chunk without an occupation is visible to
   * nobody.
   */
  trainingCatalogId: string | null;
  visibility: HaiVisibility;
  organizationId: string | null;
  /**
   * First chunk index of this part of the source (default 0). A source with a
   * trainer-only part (quiz answers) writes that part at
   * TRAINER_PART_CHUNK_OFFSET, see indexScope.ts. Stale chunks are only
   * removed inside the block of this part.
   */
  chunkIndexOffset?: number;
}

/** PageIndex-aware indexing options for use cases */
export interface IndexUseCaseOptions {
  sourceType: 'use_case';
  sourceId: string; // use_case.id
  documentId: string; // content_documents.id
  title: string; // Use case title
  pageNumber: number; // Page number for citation
  pageContent: string; // Text content of the page
  metadata?: {
    useCaseTitle?: string;
    documentTitle?: string;
    totalPages?: number;
    documentType?: string;
  };
  forceReindex?: boolean;
}

export interface IndexResult {
  success: boolean;
  chunksIndexed: number;
  chunksSkipped: number;
  chunksFailed: number;
  error?: string;
}

export interface EmbeddingRecord {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

// ============================================================================
// RATE LIMITER
// ============================================================================

/**
 * Simple token-bucket rate limiter for embedding API calls.
 *
 * Gemini paid tier: No rate limiting needed (high RPM).
 * Gemini free tier: ~100 RPM (1.67 req/s) → 100ms safety margin.
 * Ollama (local): No rate limiting needed — runs on your machine.
 */
const EMBEDDING_RATE_LIMIT_MS = 100; // ms between embedding calls (minimal for paid tier)
let _lastEmbeddingCall = 0;

/**
 * Check if the current embedding provider is local (no rate limiting needed)
 */
function isLocalProvider(): boolean {
  const provider = (
    process.env.HAI_EMBEDDING_PROVIDER || 'gemini'
  ).toLowerCase();
  return provider === 'ollama';
}

async function rateLimitedWait(): Promise<void> {
  // Skip rate limiting for local providers (Ollama)
  if (isLocalProvider()) return;

  const now = Date.now();
  const elapsed = now - _lastEmbeddingCall;
  if (elapsed < EMBEDDING_RATE_LIMIT_MS) {
    await new Promise(resolve =>
      setTimeout(resolve, EMBEDDING_RATE_LIMIT_MS - elapsed)
    );
  }
  _lastEmbeddingCall = Date.now();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate SHA256 hash of content for deduplication
 */
function generateContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

interface ChunkScope {
  trainingCatalogId: string | null;
  visibility: HaiVisibility;
  organizationId: string | null;
}

/**
 * State of a stored chunk compared with what the writer wants to store:
 *  - 'unchanged': same content and same scope, nothing to do
 *  - 'rescope': same content, other scope; only the scope columns are updated
 *    (no embedding call)
 *  - 'missing': no such chunk or other content; embed and upsert
 */
type ChunkState = 'unchanged' | 'rescope' | 'missing';

async function chunkState(
  sourceType: SourceType,
  sourceId: string,
  chunkIndex: number,
  contentHash: string,
  scope: ChunkScope
): Promise<ChunkState> {
  try {
    const existing = await haiDb
      .select({
        contentHash: haiEmbeddings.contentHash,
        trainingCatalogId: haiEmbeddings.trainingCatalogId,
        visibility: haiEmbeddings.visibility,
        organizationId: haiEmbeddings.organizationId,
      })
      .from(haiEmbeddings)
      .where(
        and(
          eq(haiEmbeddings.sourceType, sourceType),
          eq(haiEmbeddings.sourceId, sourceId),
          eq(haiEmbeddings.chunkIndex, chunkIndex)
        )
      )
      .limit(1);

    if (existing.length === 0 || existing[0].contentHash !== contentHash) {
      return 'missing';
    }
    const row = existing[0];
    return row.trainingCatalogId === scope.trainingCatalogId &&
      row.visibility === scope.visibility &&
      row.organizationId === scope.organizationId
      ? 'unchanged'
      : 'rescope';
  } catch (error) {
    console.error('HAI.ai: Error checking existing embedding:', error);
    return 'missing';
  }
}

/** Update the scope columns of a chunk whose content did not change. */
async function updateChunkScope(
  sourceType: SourceType,
  sourceId: string,
  chunkIndex: number,
  scope: ChunkScope
): Promise<void> {
  await haiDb.execute(sql`
            UPDATE hai_embeddings
            SET training_catalog_id = ${scope.trainingCatalogId}::uuid,
                visibility = ${scope.visibility},
                organization_id = ${scope.organizationId}::uuid,
                updated_at = NOW()
            WHERE source_type = ${sourceType}
              AND source_id = ${sourceId}::uuid
              AND chunk_index = ${chunkIndex}
        `);
}

/**
 * Delete existing embeddings for a source.
 * Used ONLY for explicit delete requests, NOT for reindexing.
 * Reindexing uses UPSERT instead (safe, no data loss on failure).
 */
async function deleteExistingEmbeddings(
  sourceType: SourceType,
  sourceId: string
): Promise<void> {
  try {
    await haiDb
      .delete(haiEmbeddings)
      .where(
        and(
          eq(haiEmbeddings.sourceType, sourceType),
          eq(haiEmbeddings.sourceId, sourceId)
        )
      );
  } catch (error) {
    console.error('HAI.ai: Error deleting existing embeddings:', error);
    throw error;
  }
}

/**
 * Clean up stale chunks after reindexing.
 * If the content now has fewer chunks than before, remove the extras. Only the
 * block of this part of the source is touched (the trainer part of a source
 * lives in its own block, see indexScope.ts).
 */
async function removeStaleChunks(
  sourceType: SourceType,
  sourceId: string,
  maxChunkIndex: number,
  offset: number
): Promise<void> {
  try {
    await haiDb.execute(sql`
            DELETE FROM hai_embeddings
            WHERE source_type = ${sourceType}
              AND source_id = ${sourceId}::uuid
              AND chunk_index > ${offset + maxChunkIndex}
              AND chunk_index < ${chunkIndexRange(offset).to}
        `);
  } catch (error) {
    console.error('HAI.ai: Error removing stale chunks:', error);
    // Non-fatal — stale chunks just waste space, don't break anything
  }
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Index content by generating embeddings and storing them.
 *
 * KEY IMPROVEMENTS (Phase 0C):
 *   - Uses UPSERT (ON CONFLICT DO UPDATE) — never deletes before re-embedding
 *   - Rate-limited embedding calls (700ms between calls)
 *   - Error isolation per chunk (one failure doesn't crash the batch)
 *   - Cleans up stale chunks after successful reindex
 *   - Uses provider layer for embeddings (with retry on 429/503)
 *
 * @param options - Content to index
 * @param cancellationCheck - Optional callback to check if job was cancelled
 * @returns Result of the indexing operation
 */
export async function indexContent(
  options: IndexContentOptions,
  cancellationCheck?: () => boolean
): Promise<IndexResult> {
  const {
    sourceType,
    sourceId,
    title,
    content,
    metadata = {},
    forceReindex = false,
    chunkIndexOffset = 0,
  } = options;
  const scope: ChunkScope = {
    trainingCatalogId: options.trainingCatalogId,
    visibility: options.visibility,
    organizationId: options.organizationId,
  };

  // No complete scope, no write (fail closed, nothing is embedded)
  const problem = scopeProblem(scope);
  if (problem) {
    return {
      success: false,
      chunksIndexed: 0,
      chunksSkipped: 0,
      chunksFailed: 0,
      error: `Index scope incomplete for ${sourceType}/${sourceId}: ${problem}`,
    };
  }

  try {
    const provider = getEmbeddingProvider();
    if (!provider.isInitialized()) {
      return {
        success: false,
        chunksIndexed: 0,
        chunksSkipped: 0,
        chunksFailed: 0,
        error:
          'HAI.ai embedding provider not initialized. Check GEMINI_API_KEY.',
      };
    }

    // Split content into chunks
    const chunks = chunkDocument(content, title, {
      maxChunkSize: 500,
      overlap: 50,
      preserveParagraphs: true,
      preserveSentences: true,
    });

    if (chunks.length === 0) {
      return {
        success: true,
        chunksIndexed: 0,
        chunksSkipped: 0,
        chunksFailed: 0,
        error: 'No content to index (empty after processing)',
      };
    }

    let indexed = 0;
    let skipped = 0;
    let failed = 0;

    // Process each chunk with rate limiting
    for (const chunk of chunks) {
      // Check for cancellation between chunks
      if (cancellationCheck?.()) {
        return {
          success: false,
          chunksIndexed: indexed,
          chunksSkipped: skipped,
          chunksFailed: failed,
          error: 'Job cancelled by user',
        };
      }

      const contentHash = generateContentHash(chunk.content);
      const chunkIndex = chunkIndexOffset + chunk.index;

      // Check if already indexed with same content (skip unchanged chunks)
      if (!forceReindex) {
        const state = await chunkState(
          sourceType,
          sourceId,
          chunkIndex,
          contentHash,
          scope
        );
        if (state === 'rescope') {
          // Same text, other occupation, audience or owner: no new embedding
          try {
            await updateChunkScope(sourceType, sourceId, chunkIndex, scope);
            skipped++;
          } catch (scopeError) {
            failed++;
            console.error(
              `HAI.ai: Failed to update the scope of chunk ${chunkIndex} for ${sourceType}/${sourceId}:`,
              scopeError instanceof Error ? scopeError.message : scopeError
            );
          }
          continue;
        }
        if (state === 'unchanged') {
          skipped++;
          continue;
        }
      }

      try {
        // Rate limit before calling embedding API
        await rateLimitedWait();

        // Generate embedding via provider (has built-in retry for 429/503)
        const embeddingResult = await provider.generateEmbedding(chunk.content);

        // UPSERT into database (safe — no data loss on partial failure)
        // Include embeddingModel in metadata so we can track which provider created each embedding
        const embeddingMetadata = {
          ...metadata,
          title,
          chunkMetadata: chunk.metadata,
          embeddingModel:
            provider.name === 'gemini' ? 'gemini-embedding-001' : `ollama`,
        };
        await haiDb.execute(sql`
                    INSERT INTO hai_embeddings (
                        source_type,
                        source_id,
                        chunk_index,
                        content,
                        content_hash,
                        embedding,
                        metadata,
                        training_catalog_id,
                        visibility,
                        organization_id
                    ) VALUES (
                        ${sourceType},
                        ${sourceId}::uuid,
                        ${chunkIndex},
                        ${chunk.content},
                        ${contentHash},
                        ${JSON.stringify(embeddingResult.embedding)}::vector,
                        ${JSON.stringify(embeddingMetadata)}::jsonb,
                        ${scope.trainingCatalogId}::uuid,
                        ${scope.visibility},
                        ${scope.organizationId}::uuid
                    )
                    ON CONFLICT (source_type, source_id, chunk_index)
                    DO UPDATE SET
                        content = EXCLUDED.content,
                        content_hash = EXCLUDED.content_hash,
                        embedding = EXCLUDED.embedding,
                        metadata = EXCLUDED.metadata,
                        training_catalog_id = EXCLUDED.training_catalog_id,
                        visibility = EXCLUDED.visibility,
                        organization_id = EXCLUDED.organization_id,
                        updated_at = NOW()
                `);

        indexed++;
      } catch (chunkError) {
        // Error isolation: log and continue, don't crash the whole batch
        failed++;
        console.error(
          `HAI.ai: Failed to embed chunk ${chunkIndex} for ${sourceType}/${sourceId}:`,
          chunkError instanceof Error ? chunkError.message : chunkError
        );
      }
    }

    // Clean up stale chunks (e.g., if content was shortened)
    if (indexed > 0 || skipped > 0) {
      await removeStaleChunks(
        sourceType,
        sourceId,
        chunks.length - 1,
        chunkIndexOffset
      );
    }

    return {
      success: failed === 0,
      chunksIndexed: indexed,
      chunksSkipped: skipped,
      chunksFailed: failed,
      error: failed > 0 ? `${failed} chunk(s) failed to embed` : undefined,
    };
  } catch (error) {
    console.error('HAI.ai: Error indexing content:', error);
    return {
      success: false,
      chunksIndexed: 0,
      chunksSkipped: 0,
      chunksFailed: 0,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error during indexing',
    };
  }
}

/**
 * Index multiple contents in batch.
 * Rate limiting is handled per-chunk inside indexContent().
 */
export async function indexContentBatch(
  items: IndexContentOptions[],
  cancellationCheck?: () => boolean
): Promise<{ total: number; successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;

  for (const item of items) {
    if (cancellationCheck?.()) break;

    const result = await indexContent(item, cancellationCheck);
    if (result.success && result.chunksIndexed > 0) {
      successful++;
    } else if (!result.success) {
      failed++;
    }

    // Small delay between sources (in addition to per-chunk rate limiting)
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return { total: items.length, successful, failed };
}

/**
 * Remove the chunks of one part of a source (the block of chunk indexes that
 * starts at `offset`), for example the answers of a quiz that has none any
 * more.
 */
export async function removeChunkPart(
  sourceType: SourceType,
  sourceId: string,
  offset: number
): Promise<void> {
  const range = chunkIndexRange(offset);
  await haiDb.execute(sql`
            DELETE FROM hai_embeddings
            WHERE source_type = ${sourceType}
              AND source_id = ${sourceId}::uuid
              AND chunk_index >= ${range.from}
              AND chunk_index < ${range.to}
        `);
}

/**
 * Remove all embeddings for a specific source.
 * Used for explicit deletion (not reindexing).
 */
export async function removeEmbeddings(
  sourceType: SourceType,
  sourceId: string
): Promise<boolean> {
  try {
    await deleteExistingEmbeddings(sourceType, sourceId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get embedding count for a source
 */
export async function getEmbeddingCount(
  sourceType?: SourceType,
  sourceId?: string
): Promise<number> {
  try {
    let query = haiDb
      .select({ count: sql<number>`count(*)` })
      .from(haiEmbeddings);

    if (sourceType && sourceId) {
      query = query.where(
        and(
          eq(haiEmbeddings.sourceType, sourceType),
          eq(haiEmbeddings.sourceId, sourceId)
        )
      ) as typeof query;
    } else if (sourceType) {
      query = query.where(
        eq(haiEmbeddings.sourceType, sourceType)
      ) as typeof query;
    }

    const result = await query;
    return Number(result[0]?.count || 0);
  } catch {
    return 0;
  }
}

/**
 * Get all indexed sources (for admin view)
 */
export async function getIndexedSources(): Promise<
  {
    sourceType: string;
    sourceId: string;
    chunkCount: number;
    lastUpdated: Date | null;
  }[]
> {
  try {
    const results = await haiDb.execute(sql`
            SELECT
                source_type,
                source_id,
                COUNT(*) as chunk_count,
                MAX(updated_at) as last_updated
            FROM hai_embeddings
            GROUP BY source_type, source_id
            ORDER BY last_updated DESC
        `);

    return (results as any[]).map(row => ({
      sourceType: row.source_type,
      sourceId: row.source_id,
      chunkCount: Number(row.chunk_count),
      lastUpdated: row.last_updated ? new Date(row.last_updated) : null,
    }));
  } catch (error) {
    console.error('HAI.ai: Error fetching indexed sources:', error);
    return [];
  }
}
