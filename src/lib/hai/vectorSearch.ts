/**
 * HAI.ai Vector Search Service
 *
 * Performs semantic similarity search using pgvector.
 * Finds relevant content chunks based on query embedding similarity.
 *
 * @module lib/hai/vectorSearch
 */

import { getEmbeddingProvider } from './providers';
import haiDb from '@/db/haiDb';
import { sql } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export interface SearchResult {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface SearchOptions {
  /** Maximum number of results to return */
  topK?: number;
  /** Minimum similarity threshold (0-1, higher = more similar) */
  minSimilarity?: number;
  /** Filter by source type */
  sourceType?:
    | 'enabler'
    | 'course'
    | 'document'
    | 'quiz'
    | 'trainee_schedule'
    | 'trainee_profile'
    | 'trainee_progress';
  /** Filter by specific source IDs */
  sourceIds?: string[];
  /** Filter by course ID (for enablers within a course) */
  courseId?: string;
  /** Filter by user ID (for personal embeddings — schedules, progress, etc.) */
  userId?: string;
}

export interface SearchContext {
  results: SearchResult[];
  query: string;
  totalResults: number;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Search for similar content using vector similarity
 *
 * @param query - The search query
 * @param options - Search options
 * @returns Array of similar content chunks with similarity scores
 */
export async function searchSimilar(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { topK = 5, minSimilarity = 0.3, sourceType, sourceIds } = options;

  const embeddingProvider = getEmbeddingProvider();
  if (!embeddingProvider.isInitialized()) {
    console.error('HAI.ai: Embedding provider not initialized for search');
    return [];
  }

  try {
    // Generate embedding for the query via provider
    const queryEmbedding = await embeddingProvider.generateEmbedding(query);
    const embeddingVector = JSON.stringify(queryEmbedding.embedding);

    // Build the SQL query with filters
    let whereClause = sql`1=1`;

    if (sourceType) {
      whereClause = sql`${whereClause} AND source_type = ${sourceType}`;
    }

    if (sourceIds && sourceIds.length > 0) {
      // Use parameterized ANY() instead of raw SQL IN() to prevent SQL injection
      whereClause = sql`${whereClause} AND source_id::text = ANY(${sourceIds})`;
    }

    if (options.courseId) {
      // Join with enablers table to filter by course
      // Note: This requires a join which the current simple query structure doesn't support directly
      // For now, we'll assuming a metadata field or subquery approach if possible,
      // BUT simpler approach for now: verify metadata.courseId if it exists, OR
      // Since we can't easily join in this simple execute block without changing the FROM clause,
      // we will skip this strict filter for now to avoid breaking the query,
      // but we SHOULD fix this properly.

      // BETTER FIX: Use the metadata column which usually contains courseId for enablers
      whereClause = sql`${whereClause} AND metadata->>'courseId' = ${options.courseId}`;
    }

    // User-aware filter: personal embeddings (trainee_schedule, trainee_profile, trainee_progress)
    // should only match their owner. Shared content (enablers, courses, docs) matches everyone.
    if (options.userId) {
      whereClause = sql`${whereClause} AND (
                metadata->>'userId' IS NULL 
                OR metadata->>'userId' = ${options.userId}
            )`;
    }

    // Execute vector similarity search
    const results = await haiDb.execute(sql`
      SELECT 
        id,
        source_type,
        source_id,
        chunk_index,
        content,
        metadata,
        1 - (embedding <=> ${embeddingVector}::vector) as similarity
      FROM hai_embeddings
      WHERE ${whereClause}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingVector}::vector
      LIMIT ${topK}
    `);

    // Filter by minimum similarity and format results
    return (results as any[])
      .filter(row => row.similarity >= minSimilarity)
      .map(row => ({
        id: row.id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        similarity: parseFloat(row.similarity.toFixed(4)),
        metadata: row.metadata || {},
      }));
  } catch (error) {
    console.error('HAI.ai: Error in vector search:', error);
    return [];
  }
}

/**
 * Search with context awareness (current enabler/course)
 *
 * Priority:
 * 1. Current context (if provided)
 * 2. Same course
 * 3. Global content
 */
export async function searchWithContext(
  query: string,
  context: {
    currentEnablerId?: string;
    currentCourseId?: string;
  },
  options: SearchOptions = {}
): Promise<SearchContext> {
  const topK = options.topK ?? 5;
  const results: SearchResult[] = [];

  try {
    // Step 1: Search in current enabler context first (highest priority)
    if (context.currentEnablerId) {
      const contextResults = await searchSimilar(query, {
        ...options,
        topK: Math.min(3, topK),
        sourceType: 'enabler',
        sourceIds: [context.currentEnablerId],
        userId: options.userId,
      });

      // Boost similarity for context results
      results.push(
        ...contextResults.map(r => ({
          ...r,
          similarity: Math.min(1, r.similarity + 0.1), // Boost by 0.1
          metadata: { ...r.metadata, isCurrentContext: true },
        }))
      );
    }

    // Step 2: Search in same course (if we need more results)
    if (results.length < topK && context.currentCourseId) {
      const courseResults = await searchSimilar(query, {
        ...options,
        topK: topK - results.length,
        sourceType: 'enabler',
        // Would need to filter by course - for now search all enablers
      });

      // Add non-duplicate results
      for (const r of courseResults) {
        if (!results.find(existing => existing.id === r.id)) {
          results.push(r);
        }
      }
    }

    // Step 3: Global search for remaining slots
    if (results.length < topK) {
      const globalResults = await searchSimilar(query, {
        ...options,
        topK: topK - results.length,
      });

      for (const r of globalResults) {
        if (!results.find(existing => existing.id === r.id)) {
          results.push(r);
        }
      }
    }

    // Sort by similarity
    results.sort((a, b) => b.similarity - a.similarity);

    return {
      results: results.slice(0, topK),
      query,
      totalResults: results.length,
    };
  } catch (error) {
    console.error('HAI.ai: Error in contextual search:', error);
    return {
      results: [],
      query,
      totalResults: 0,
    };
  }
}

/**
 * Find related content to a specific source
 */
export async function findRelatedContent(
  sourceType: string,
  sourceId: string,
  limit: number = 5
): Promise<SearchResult[]> {
  try {
    // Get the embeddings for this source
    const sourceEmbeddings = await haiDb.execute(sql`
      SELECT embedding, content
      FROM hai_embeddings
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid
      LIMIT 1
    `);

    if ((sourceEmbeddings as any[]).length === 0) {
      return [];
    }

    // Use the first chunk's embedding to find similar content
    const embedding = (sourceEmbeddings as any[])[0].embedding;

    const results = await haiDb.execute(sql`
      SELECT 
        id,
        source_type,
        source_id,
        chunk_index,
        content,
        metadata,
        1 - (embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
      FROM hai_embeddings
      WHERE source_id != ${sourceId}::uuid
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT ${limit}
    `);

    return (results as any[]).map(row => ({
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      similarity: parseFloat(row.similarity.toFixed(4)),
      metadata: row.metadata || {},
    }));
  } catch (error) {
    console.error('HAI.ai: Error finding related content:', error);
    return [];
  }
}

/**
 * Check if the embedding index is healthy
 */
export async function checkIndexHealth(): Promise<{
  healthy: boolean;
  totalEmbeddings: number;
  embeddingsWithVectors: number;
  lastIndexed: Date | null;
}> {
  try {
    const stats = await haiDb.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(embedding) as with_vectors,
        MAX(created_at) as last_indexed
      FROM hai_embeddings
    `);

    const row = (stats as any[])[0];
    const total = Number(row.total);
    const withVectors = Number(row.with_vectors);

    return {
      healthy: total > 0 && withVectors === total,
      totalEmbeddings: total,
      embeddingsWithVectors: withVectors,
      lastIndexed: row.last_indexed ? new Date(row.last_indexed) : null,
    };
  } catch (error) {
    console.error('HAI.ai: Error checking index health:', error);
    return {
      healthy: false,
      totalEmbeddings: 0,
      embeddingsWithVectors: 0,
      lastIndexed: null,
    };
  }
}
