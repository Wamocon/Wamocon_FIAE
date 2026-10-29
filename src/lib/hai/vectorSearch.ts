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
import { sql, type SQL } from 'drizzle-orm';
import { LEARNING_TECHNIQUE_SOURCE_TYPE } from './indexScope';
import { searchMayUseTrainerSolutions } from './trainerSolutions';
import {
  filterSearchResultsForTrainingScope,
  type HaiTrainingScope,
} from './trainingScope';

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

/** Who asks: trainees never get trainer-only chunks (solutions, quiz answers). */
export type HaiAudience = 'trainee' | 'trainer';

/**
 * Access filter of every search. The pipeline builds it from the session and
 * the database (resolveRetrievalAccess), never from client input. It is part of
 * the SQL WHERE clause, so it applies before LIMIT.
 */
export interface SearchScope {
  /** Catalogs (occupations) the caller may read. Empty: no result (fail closed). */
  catalogIds: string[];
  /** Only 'trainer' sees chunks with visibility 'trainer'. */
  audience: HaiAudience;
  /** Organization of the caller: own and platform content (NULL) only. */
  organizationId?: string | null;
  /**
   * The caller. Personal rows (trainee_*) match only their owner; without a
   * user id no personal row matches.
   */
  userId?: string | null;
  /**
   * Chunks of the model solutions of the private bucket (metadata.trainerSolution)
   * are returned only to the trainer audience AND only when this is true. It is
   * set by resolveRetrievalAccess (role from the database, switch
   * HAI_TRAINER_SOLUTIONS), never from a request. Default: excluded.
   */
  includeTrainerSolutions?: boolean;
}

export interface SearchOptions extends SearchScope {
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
    | 'learning_technique'
    | 'trainee_schedule'
    | 'trainee_profile'
    | 'trainee_progress';
  /** Filter by specific source IDs */
  sourceIds?: string[];
  /** Filter by course ID (for enablers within a course) */
  courseId?: string;
  /**
   * Duration-aware content scope of a trainee. It filters after the SQL query,
   * so more candidates are fetched (CANDIDATE_FACTOR) and cut to topK after.
   */
  trainingScope?: HaiTrainingScope;
}

export interface SearchContext {
  results: SearchResult[];
  query: string;
  totalResults: number;
}

// ============================================================================
// ACCESS FILTER
// ============================================================================

/** Places a question about learning reserves for learning technique cards */
export const LEARNING_TECHNIQUE_SLOTS = 3;

/** Candidates fetched per wanted result when the training scope post filters */
const CANDIDATE_FACTOR = 3;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a UUID (ids are cast with ::uuid, a bad one must not throw). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * SQL condition of the access scope, or null if the caller has no usable
 * catalog (the search then returns nothing).
 *
 *  - catalog: training_catalog_id must be one of the caller's catalogs; rows
 *    without a catalog match nobody, except the platform knowledge of the
 *    source type learning_technique (no occupation, visibility 'all')
 *  - audience: everyone but 'trainer' sees only visibility 'all'
 *  - organization: own organization or platform content (NULL)
 *  - personal rows (trainee_* rows, rows with metadata.userId) match only
 *    their owner
 */
export function buildScopeCondition(scope: SearchScope): SQL | null {
  const catalogIds = [...new Set((scope.catalogIds ?? []).filter(isUuid))];
  if (catalogIds.length === 0) return null;

  // Platform knowledge (learning technique cards) has no occupation. It is
  // matched by its source type, only for rows without occupation and owner
  // (the audience rule below still applies), and only for a caller who has a
  // catalog scope at all (the early return above). It opens no content of any
  // occupation. The source type is a trusted constant, written as a literal so
  // the numbering of the bound parameters stays as it was.
  const platformSourceType = sql.raw(`'${LEARNING_TECHNIQUE_SOURCE_TYPE}'`);
  const parts: SQL[] = [
    sql`(training_catalog_id IN (${sql.join(
      catalogIds.map(id => sql`${id}::uuid`),
      sql`, `
    )}) OR (source_type = ${platformSourceType} AND training_catalog_id IS NULL AND organization_id IS NULL))`,
  ];
  if (scope.audience !== 'trainer') {
    parts.push(sql`visibility = 'all'`);
  }
  // Model solutions of the private bucket: trainer audience with the explicit
  // permission only. Excluded by their marker (in addition to visibility, which
  // is 'trainer' for them), so a mislabelled row cannot reach a trainee.
  if (!searchMayUseTrainerSolutions(scope)) {
    parts.push(sql`COALESCE(metadata->>'trainerSolution', '') <> 'true'`);
  }
  parts.push(
    isUuid(scope.organizationId)
      ? sql`(organization_id IS NULL OR organization_id = ${scope.organizationId}::uuid)`
      : sql`organization_id IS NULL`
  );
  // A personal row is a trainee_* row or any row with an owner. A trainee_* row
  // without an owner matches nobody.
  parts.push(
    scope.userId
      ? sql`((source_type NOT LIKE 'trainee\\_%' AND metadata->>'userId' IS NULL) OR metadata->>'userId' = ${scope.userId})`
      : sql`(source_type NOT LIKE 'trainee\\_%' AND metadata->>'userId' IS NULL)`
  );
  return sql.join(parts, sql` AND `);
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Search for similar content using vector similarity.
 *
 * @param query - The search query text
 * @param options - Search options
 * @param precomputedEmbedding - Optional pre-computed embedding vector (avoids redundant API calls)
 * @returns Array of similar content chunks with similarity scores
 */
export async function searchSimilar(
  query: string,
  options: SearchOptions,
  precomputedEmbedding?: string
): Promise<SearchResult[]> {
  const { topK = 5, minSimilarity = 0.3, sourceType, sourceIds } = options;

  // Fail closed: without a catalog scope nothing is returned, and no query
  // embedding is paid for.
  const scopeCondition = buildScopeCondition(options);
  if (!scopeCondition) return [];

  try {
    // Use pre-computed embedding if available, otherwise generate one
    let embeddingVector: string;
    if (precomputedEmbedding) {
      embeddingVector = precomputedEmbedding;
    } else {
      const embeddingProvider = getEmbeddingProvider();
      if (!embeddingProvider.isInitialized()) {
        console.error('HAI.ai: Embedding provider not initialized for search');
        return [];
      }
      const queryEmbedding = await embeddingProvider.generateEmbedding(query);
      embeddingVector = JSON.stringify(queryEmbedding.embedding);
    }

    // Build the SQL query with filters. The scope (catalog, audience,
    // organization, owner of personal rows) always comes first.
    let whereClause = scopeCondition;

    if (sourceType) {
      whereClause = sql`${whereClause} AND source_type = ${sourceType}`;
    }

    if (sourceIds && sourceIds.length > 0) {
      // Bound parameters, compared as text so a malformed id never raises
      whereClause = sql`${whereClause} AND source_id::text IN (${sql.join(
        sourceIds.map(id => sql`${id}`),
        sql`, `
      )})`;
    }

    if (options.courseId) {
      // Enabler chunks carry the course in their metadata
      whereClause = sql`${whereClause} AND metadata->>'courseId' = ${options.courseId}`;
    }

    // The training scope is a post filter: fetch more candidates, cut later
    const candidateLimit = options.trainingScope?.applies
      ? topK * CANDIDATE_FACTOR
      : topK;

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
      LIMIT ${candidateLimit}
    `);

    // Filter by minimum similarity and format results
    const mapped = (results as any[])
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

    return filterSearchResultsForTrainingScope(
      mapped,
      options.trainingScope
    ).slice(0, topK);
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
    /**
     * The question is about learning and memorizing: reserve up to
     * LEARNING_TECHNIQUE_SLOTS places for learning technique cards, found with
     * the same query embedding (no extra embedding call).
     */
    includeLearningTechniques?: boolean;
  },
  options: SearchOptions
): Promise<SearchContext> {
  const requestedTopK = options.topK ?? 5;
  const results: SearchResult[] = [];

  // Fail closed: no catalog scope, no result, no embedding call
  if (!buildScopeCondition(options)) {
    return { results: [], query, totalResults: 0 };
  }

  try {
    // Pre-compute the query embedding ONCE to avoid redundant Gemini API calls.
    // searchWithContext makes up to 3 searchSimilar calls — without this cache,
    // each call would generate a separate embedding (3x API cost per query).
    const embeddingProvider = getEmbeddingProvider();
    if (!embeddingProvider.isInitialized()) {
      console.error('HAI.ai: Embedding provider not initialized for search');
      return { results: [], query, totalResults: 0 };
    }
    const queryEmbedding = await embeddingProvider.generateEmbedding(query);
    const cachedEmbeddingVector = JSON.stringify(queryEmbedding.embedding);

    // Step 0: learning technique cards for a question about learning. They
    // come first, the other steps share the remaining places.
    const cardResults =
      context.includeLearningTechniques && requestedTopK > 0
        ? await searchSimilar(
            query,
            {
              ...options,
              topK: Math.min(LEARNING_TECHNIQUE_SLOTS, requestedTopK),
              sourceType: 'learning_technique',
              sourceIds: undefined,
              courseId: undefined,
            },
            cachedEmbeddingVector
          )
        : [];
    const topK = requestedTopK - cardResults.length;
    // A card of step 0 must not come back from a later step
    const reserved = new Set(cardResults.map(r => r.id));

    // Step 1: Search in current enabler context first (highest priority)
    if (context.currentEnablerId && topK > 0) {
      const contextResults = await searchSimilar(query, {
        ...options,
        topK: Math.min(3, topK),
        sourceType: 'enabler',
        sourceIds: [context.currentEnablerId],
        userId: options.userId,
      }, cachedEmbeddingVector);

      // Mark as current context (no artificial boost — trust semantic similarity)
      results.push(
        ...contextResults.map(r => ({
          ...r,
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
        courseId: context.currentCourseId,
      }, cachedEmbeddingVector);

      // Add non-duplicate results
      for (const r of courseResults) {
        if (!reserved.has(r.id) && !results.find(e => e.id === r.id)) {
          results.push(r);
        }
      }
    }

    // Step 3: Global search for remaining slots
    if (results.length < topK) {
      const globalResults = await searchSimilar(query, {
        ...options,
        topK: topK - results.length,
      }, cachedEmbeddingVector);

      for (const r of globalResults) {
        if (!reserved.has(r.id) && !results.find(e => e.id === r.id)) {
          results.push(r);
        }
      }
    }

    // Sort by similarity
    results.sort((a, b) => b.similarity - a.similarity);

    return {
      results: [...cardResults, ...results.slice(0, topK)],
      query,
      totalResults: cardResults.length + results.length,
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
  scope: SearchScope,
  limit: number = 5
): Promise<SearchResult[]> {
  // Same access scope as the search: neither the source chunk nor the related
  // chunks may come from outside the caller's scope.
  const scopeCondition = buildScopeCondition(scope);
  if (!scopeCondition) return [];

  try {
    // Get the embeddings for this source
    const sourceEmbeddings = await haiDb.execute(sql`
      SELECT embedding, content
      FROM hai_embeddings
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid
        AND ${scopeCondition}
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
        AND ${scopeCondition}
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
