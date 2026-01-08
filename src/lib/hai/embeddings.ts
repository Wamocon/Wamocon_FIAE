/**
 * HAI.ai Embedding Service
 * 
 * Generates and stores vector embeddings for content indexing.
 * Handles deduplication, batch processing, and database storage.
 * 
 * @module lib/hai/embeddings
 */

import { createHash } from 'crypto';
import { haiClient } from './client';
import { chunkDocument, TextChunk } from './chunker';
import db from '@/db';
import { haiEmbeddings } from '@/db/migrations/schemas/schema';
import { eq, and, sql } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export type SourceType = 'enabler' | 'course' | 'document' | 'quiz';

export interface IndexContentOptions {
    sourceType: SourceType;
    sourceId: string;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
    forceReindex?: boolean;
}

export interface IndexResult {
    success: boolean;
    chunksIndexed: number;
    chunksSkipped: number;
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
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate SHA256 hash of content for deduplication
 */
function generateContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Check if embedding already exists with same content hash
 */
async function embeddingExists(
    sourceType: SourceType,
    sourceId: string,
    chunkIndex: number,
    contentHash: string
): Promise<boolean> {
    try {
        const existing = await db
            .select({ contentHash: haiEmbeddings.contentHash })
            .from(haiEmbeddings)
            .where(
                and(
                    eq(haiEmbeddings.sourceType, sourceType),
                    eq(haiEmbeddings.sourceId, sourceId),
                    eq(haiEmbeddings.chunkIndex, chunkIndex)
                )
            )
            .limit(1);

        return existing.length > 0 && existing[0].contentHash === contentHash;
    } catch (error) {
        console.error('HAI.ai: Error checking existing embedding:', error);
        return false;
    }
}

/**
 * Delete existing embeddings for a source (for re-indexing)
 */
async function deleteExistingEmbeddings(sourceType: SourceType, sourceId: string): Promise<void> {
    try {
        await db
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

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Index content by generating embeddings and storing them
 * 
 * @param options - Content to index
 * @returns Result of the indexing operation
 */
export async function indexContent(options: IndexContentOptions): Promise<IndexResult> {
    const { sourceType, sourceId, title, content, metadata = {}, forceReindex = false } = options;

    if (!haiClient.isInitialized()) {
        return {
            success: false,
            chunksIndexed: 0,
            chunksSkipped: 0,
            error: 'HAI.ai client not initialized. Check GEMINI_API_KEY.',
        };
    }

    try {
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
                error: 'No content to index (empty after processing)',
            };
        }

        // Delete existing if force reindex
        if (forceReindex) {
            await deleteExistingEmbeddings(sourceType, sourceId);
        }

        let indexed = 0;
        let skipped = 0;

        // Process each chunk
        for (const chunk of chunks) {
            const contentHash = generateContentHash(chunk.content);

            // Check if already indexed with same content
            if (!forceReindex && await embeddingExists(sourceType, sourceId, chunk.index, contentHash)) {
                skipped++;
                continue;
            }

            // Generate embedding
            const embeddingResult = await haiClient.generateEmbedding(chunk.content);

            // Store in database using raw SQL for vector type
            await db.execute(sql`
        INSERT INTO hai_embeddings (
          source_type,
          source_id,
          chunk_index,
          content,
          content_hash,
          embedding,
          metadata
        ) VALUES (
          ${sourceType},
          ${sourceId}::uuid,
          ${chunk.index},
          ${chunk.content},
          ${contentHash},
          ${JSON.stringify(embeddingResult.embedding)}::vector,
          ${JSON.stringify({ ...metadata, title, chunkMetadata: chunk.metadata })}::jsonb
        )
        ON CONFLICT (source_type, source_id, chunk_index)
        DO UPDATE SET
          content = EXCLUDED.content,
          content_hash = EXCLUDED.content_hash,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);

            indexed++;

            // Small delay to respect rate limits
            if (indexed % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return {
            success: true,
            chunksIndexed: indexed,
            chunksSkipped: skipped,
        };
    } catch (error) {
        console.error('HAI.ai: Error indexing content:', error);
        return {
            success: false,
            chunksIndexed: 0,
            chunksSkipped: 0,
            error: error instanceof Error ? error.message : 'Unknown error during indexing',
        };
    }
}

/**
 * Index multiple contents in batch
 */
export async function indexContentBatch(
    items: IndexContentOptions[]
): Promise<{ total: number; successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    for (const item of items) {
        const result = await indexContent(item);
        if (result.success && result.chunksIndexed > 0) {
            successful++;
        } else if (!result.success) {
            failed++;
        }

        // Delay between items
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return { total: items.length, successful, failed };
}

/**
 * Remove all embeddings for a specific source
 */
export async function removeEmbeddings(sourceType: SourceType, sourceId: string): Promise<boolean> {
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
export async function getEmbeddingCount(sourceType?: SourceType, sourceId?: string): Promise<number> {
    try {
        let query = db.select({ count: sql<number>`count(*)` }).from(haiEmbeddings);

        if (sourceType && sourceId) {
            query = query.where(
                and(
                    eq(haiEmbeddings.sourceType, sourceType),
                    eq(haiEmbeddings.sourceId, sourceId)
                )
            ) as typeof query;
        } else if (sourceType) {
            query = query.where(eq(haiEmbeddings.sourceType, sourceType)) as typeof query;
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
export async function getIndexedSources(): Promise<{
    sourceType: string;
    sourceId: string;
    chunkCount: number;
    lastUpdated: Date | null;
}[]> {
    try {
        const results = await db.execute(sql`
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
