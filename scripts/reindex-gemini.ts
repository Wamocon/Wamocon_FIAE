/**
 * HAI.ai Full Reindex Script — Gemini Paid Tier
 *
 * PROTECTED. The default is a DRY RUN: it reads the sources, counts the chunks
 * per type, occupation (catalog) and visibility and writes nothing, no model
 * call is made. A real run needs --apply. Every run needs --target
 * preview|production|local, which is compared with the connection (host,
 * current_schema, role) before anything else happens. Production is refused
 * without --confirm-production and a suspended rollout gate. See
 * src/lib/hai/reindexArgs.ts.
 *
 * Indexes ALL DB content + PDFs using Gemini embeddings into hai_embeddings.
 * Uses PAID Gemini API (no rate limiting, parallel requests).
 *
 * KEY FEATURES:
 *   - DB-based progress: Checks hai_embeddings directly for existing content hashes.
 *     Any machine can resume — no local files needed.
 *   - PDF extraction: Indexes all content_documents (THEORY, TRAINER_SOLUTION, etc.)
 *     using pdf-parse for text extraction.
 *   - Content-hash deduplication: Skips sources whose content hasn't changed.
 *   - Job tracking: Records run in hai_reindex_jobs for admin visibility.
 *
 * Sources indexed:
 *   1. Courses          (title + description)
 *   2. Enablers         (title, description, scenario, lernfeld refs)
 *   3. Use Cases        (title, description, lernfeld refs)
 *   4. Quizzes          (title, questions + options with explanations)
 *   5. Lernfelder       (code, title, description, linked content)
 *   6. Training Components (IHK Rahmenplan: code, title, use cases)
 *   7. PDF Documents    (text extraction from content_documents)  ← NEW
 *
 * Usage (every call needs --target):
 *   npx tsx scripts/reindex-gemini.ts --target local                 # Dry run (default)
 *   npx tsx scripts/reindex-gemini.ts --target preview --apply       # Real run (skips unchanged)
 *   npx tsx scripts/reindex-gemini.ts --target preview --catalog KFBM --apply
 *                                                  # only the sources of one occupation
 *   ... --force        # Re-embed everything
 *   ... --catalog KFBM --purge --apply        # delete the chunks of ONE catalog first
 *   ... --catalog KFBM --purge-stale --apply  # delete its non-Gemini chunks only
 *   ... --pdfs-only    # Only index PDF documents
 *
 * Chunks carry training_catalog_id, visibility and organization_id (explicit,
 * see src/lib/hai/indexScope.ts). A quiz is split into questions ('all') and
 * answers ('trainer') BEFORE the size chunking, the hint of a scenario is its
 * own chunk (SCENARIO_HINT_VISIBILITY).
 */

import postgres from 'postgres';
import { createHash } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  buildTrainingComponentMetadata,
  componentDurationText,
} from '../src/lib/hai/componentMetadata';
import {
  ChunkPlan,
  checkTargetAgainstConnection,
  connectionHost,
  isLoopbackHost,
  parseReindexArgs,
} from '../src/lib/hai/reindexArgs';
import {
  CHUNK_INDEX_BLOCK,
  QUIZ_ANSWERS_VISIBILITY,
  QUIZ_QUESTIONS_VISIBILITY,
  SCENARIO_HINT_VISIBILITY,
  TRAINER_PART_CHUNK_OFFSET,
  planDocumentIndexing,
  type IndexScope,
} from '../src/lib/hai/indexScope';
import {
  DEFAULT_CHARS_PER_TOKEN,
  estimateTokens,
} from '../src/lib/hai/embeddingCost';
import {
  buildQuizTexts,
  type QuizQuestionInput,
} from '../src/lib/hai/quizIndexText';
import { parseContentReference } from '../src/lib/storage/contentPath';
import { cutAndNormalize } from '../src/lib/hai/providers/sokrates-embedding';
// The rollout gate is read from the environment of the process only, before
// dotenv: a value that sits in .env.local or .env must not open it silently
const SHELL_ROLLOUT_APPROVED = process.env.KFBM_ROLLOUT_APPROVED;
dotenv.config({ path: '.env.local' });
dotenv.config();

// ============================================================================
// CONFIG
// ============================================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// The model that embeds. Default: Gemini. HAI_REINDEX_PROVIDER=ollama embeds
// with qwen3-embedding on the Sokrates server (Ollama, reached through an SSH
// tunnel on this machine, no key): the vectors are cut to EMBEDDING_DIMS values
// and normalized. The vectors of two models cannot be compared, so the
// provider of the app (HAI_EMBEDDING_PROVIDER) has to match the index.
const REINDEX_PROVIDER =
  (process.env.HAI_REINDEX_PROVIDER || 'gemini').trim().toLowerCase() ===
  'ollama'
    ? 'ollama'
    : 'gemini';
const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
).replace(/\/+$/, '');
const OLLAMA_MODEL =
  process.env.HAI_OLLAMA_EMBEDDING_MODEL || 'qwen3-embedding:8b';
const EMBEDDING_DIMS = parseInt(
  process.env.HAI_EMBEDDING_DIMENSIONS || '3072',
  10
);
// The name that is written to the index (skip of unchanged rows, purge of
// rows of another model)
const EMBEDDING_MODEL =
  REINDEX_PROVIDER === 'ollama'
    ? `${OLLAMA_MODEL}@${EMBEDDING_DIMS}`
    : 'gemini-embedding-001';
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

// Paid tier: No rate limiting needed. Parallel requests supported.
const PARALLEL_EMBEDS = 5; // Send up to 5 parallel embedding requests
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const MAX_EMBED_CHARS = 4000;

// CLI flags (validated by parseReindexArgs before anything else happens)
const parsedArgs = parseReindexArgs(process.argv.slice(2));
if (!parsedArgs.ok) {
  console.error('Invalid arguments, nothing was done:');
  for (const error of parsedArgs.errors) console.error(`  - ${error}`);
  process.exit(2);
}
const OPTIONS = parsedArgs.options;
const IS_FORCE = OPTIONS.force;
const IS_PURGE = OPTIONS.purge;
const IS_PURGE_STALE = OPTIONS.purgeStale;
// The default is a dry run, a real run needs --apply
const IS_DRY_RUN = !OPTIONS.apply;
const IS_PDFS_ONLY = OPTIONS.pdfsOnly;

// Training catalog the run is limited to (resolved from --catalog after the
// connection is checked), null = all catalogs
let CATALOG_ID: string | null = null;

// Dry run: chunks per source type, catalog and visibility
const CATALOG_CODES = new Map<string, string>();
const PLAN_INVENTORY = new ChunkPlan(); // everything the index holds afterwards
const PLAN_CHANGES = new ChunkPlan(); // what a real run would embed now
const PLAN_RESCOPE = new ChunkPlan(); // chunks that only change their scope

// ============================================================================
// STYLING
// ============================================================================

const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// ============================================================================
// LOG COLLECTOR — tracks every indexed item for the log file
// ============================================================================

interface LogEntry {
  timestamp: string;
  sourceType: string;
  sourceId: string;
  title: string;
  status: 'indexed' | 'skipped' | 'failed';
  chunks: number;
  pages?: number;
  error?: string;
}

const _logEntries: LogEntry[] = [];
const _logMessages: string[] = []; // raw console lines for text log

function addLogEntry(entry: LogEntry) {
  _logEntries.push(entry);
}

function logMsg(msg: string) {
  _logMessages.push(msg);
}

function log(msg: string) {
  const line = `[reindex] ${msg}`;
  console.log(`${ANSI.cyan}[reindex]${ANSI.reset} ${msg}`);
  logMsg(line);
}
function ok(msg: string) {
  const line = `  ✓ ${msg}`;
  console.log(`${ANSI.green}  ✓${ANSI.reset} ${msg}`);
  logMsg(line);
}
function warn(msg: string) {
  const line = `  ⚠ ${msg}`;
  console.log(`${ANSI.yellow}  ⚠${ANSI.reset} ${msg}`);
  logMsg(line);
}
function fail(msg: string) {
  const line = `  ✗ ${msg}`;
  console.log(`${ANSI.red}  ✗${ANSI.reset} ${msg}`);
  logMsg(line);
}
function info(msg: string) {
  const line = `    ${msg}`;
  console.log(`${ANSI.dim}    ${msg}${ANSI.reset}`);
  logMsg(line);
}

// ============================================================================
// DB-BASED PROGRESS TRACKING
// ============================================================================

/**
 * Check if a source has ALL its chunks already indexed with matching content.
 * This replaces the old file-based progress tracking.
 *
 * Strategy:
 *   1. Chunk the content
 *   2. For each chunk, compute content_hash
 *   3. Query hai_embeddings for matching (source_type, source_id, chunk_index, content_hash)
 *   4. If ALL chunks match AND tagged with current model → skip
 *
 * Returns: { allMatch: true } if fully indexed, or { allMatch: false }
 */
async function isSourceIndexed(
  db: postgres.Sql,
  sourceType: string,
  sourceId: string,
  chunks: { content: string; index: number }[],
  scope: IndexScope,
  part: SourcePart
): Promise<{ allMatch: boolean; rescope: boolean; existing: number }> {
  if (IS_FORCE) return { allMatch: false, rescope: false, existing: 0 };
  if (chunks.length === 0)
    return { allMatch: true, rescope: false, existing: 0 };

  // Existing chunks of this part of the source (its block of chunk indexes)
  const existing = await db`
    SELECT chunk_index, content_hash, metadata->>'embeddingModel' as model,
           training_catalog_id::text as training_catalog_id, visibility,
           organization_id::text as organization_id
    FROM hai_embeddings
    WHERE source_type = ${sourceType}
      AND source_id = ${sourceId}::uuid
      AND chunk_index >= ${part.offset}
      AND chunk_index < ${part.staleBelow ?? 2147483647}
  `;

  if (existing.length === 0)
    return { allMatch: false, rescope: false, existing: 0 };

  // Build lookup: chunk_index → { content_hash, model }
  const existingMap = new Map<number, { hash: string; model: string }>();
  for (const row of existing) {
    existingMap.set(row.chunk_index, {
      hash: row.content_hash,
      model: row.model,
    });
  }

  // Check if all chunks match
  let matchCount = 0;
  for (const chunk of chunks) {
    const hash = createHash('sha256').update(chunk.content).digest('hex');
    const ex = existingMap.get(part.offset + chunk.index);
    if (ex && ex.hash === hash && ex.model === EMBEDDING_MODEL) {
      matchCount++;
    }
  }

  const allMatch =
    matchCount === chunks.length && existing.length === chunks.length;
  // same text, other occupation, audience or owner: update the columns only
  const rescope =
    allMatch &&
    existing.some(
      row =>
        row.training_catalog_id !== scope.trainingCatalogId ||
        row.visibility !== scope.visibility ||
        row.organization_id !== scope.organizationId
    );
  return { allMatch, rescope, existing: existing.length };
}

/**
 * Record a reindex job run in hai_reindex_jobs for admin visibility.
 */
async function recordReindexJob(
  db: postgres.Sql,
  status: 'completed' | 'failed',
  progress: Record<string, unknown>,
  error?: string,
  startedAt?: Date
) {
  await db`
    INSERT INTO hai_reindex_jobs (
      status, force_reindex, progress, error, started_at, completed_at
    ) VALUES (
      ${status},
      ${IS_FORCE},
      ${JSON.stringify({ ...progress, script: 'reindex-gemini.ts', model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS })}::jsonb,
      ${error || null},
      ${startedAt || new Date()},
      NOW()
    )
  `;
}

// ============================================================================
// GEMINI EMBEDDING (Paid Tier — No Rate Limiting)
// ============================================================================

let _totalApiCalls = 0;

function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_EMBED_CHARS) return text;
  return text.slice(0, MAX_EMBED_CHARS) + '…';
}

async function generateEmbedding(
  text: string,
  retries = MAX_RETRIES
): Promise<number[]> {
  _totalApiCalls++;

  if (REINDEX_PROVIDER === 'ollama') {
    return generateOllamaEmbedding(text, retries);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: truncateForEmbedding(text) }] },
        // 3072 is native for gemini-embedding-001, no outputDimensionality needed
        ...(EMBEDDING_DIMS !== 3072
          ? { outputDimensionality: EMBEDDING_DIMS }
          : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 429) {
      if (retries > 0) {
        const delay = RETRY_DELAY_MS * (MAX_RETRIES - retries + 1);
        warn(
          `Rate limited (429). Waiting ${delay / 1000}s... (${retries} retries left)`
        );
        await new Promise(r => setTimeout(r, delay));
        _totalApiCalls--;
        return generateEmbedding(text, retries - 1);
      }
      throw new Error('Gemini rate limit exceeded after retries');
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini embed failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    return data.embedding.values;
  } catch (e: any) {
    if (
      retries > 0 &&
      (e.name === 'TimeoutError' || e.message?.includes('fetch failed'))
    ) {
      warn(`Connection issue, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 2000));
      _totalApiCalls--;
      return generateEmbedding(text, retries - 1);
    }
    throw e;
  }
}

/**
 * One embedding through Ollama on the Sokrates server (HAI_REINDEX_PROVIDER=ollama).
 * The address has to be this machine (the SSH tunnel): the texts of the courses
 * never go anywhere else from here.
 */
async function generateOllamaEmbedding(
  text: string,
  retries: number
): Promise<number[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        input: truncateForEmbedding(text),
        truncate: true,
        options: { num_ctx: 2048 },
        keep_alive: '30m',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama embed failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    const first = data?.embeddings?.[0];
    if (!Array.isArray(first)) {
      throw new Error('Ollama embed: no embedding in the response');
    }
    return cutAndNormalize(first, EMBEDDING_DIMS);
  } catch (e: any) {
    if (
      retries > 0 &&
      (e.name === 'TimeoutError' || e.message?.includes('fetch failed'))
    ) {
      warn(`Connection issue, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 2000));
      _totalApiCalls--;
      return generateOllamaEmbedding(text, retries - 1);
    }
    throw e;
  }
}

/**
 * Generate embeddings for multiple texts in parallel (paid tier).
 */
async function generateEmbeddingsBatch(
  texts: string[]
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = [];

  // Process in batches of PARALLEL_EMBEDS
  for (let i = 0; i < texts.length; i += PARALLEL_EMBEDS) {
    const batch = texts.slice(i, i + PARALLEL_EMBEDS);
    const batchResults = await Promise.all(
      batch.map(async t => {
        try {
          return await generateEmbedding(t);
        } catch (e: any) {
          fail(`Embedding failed: ${e.message}`);
          return null;
        }
      })
    );
    results.push(...batchResults);
  }

  return results;
}

// ============================================================================
// CHUNKING
// ============================================================================

function chunkText(text: string): { content: string; index: number }[] {
  if (!text || text.trim().length === 0) return [];

  const paragraphs = text.split(/\n\n+/);
  const chunks: { content: string; index: number }[] = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if (
      currentChunk.length + para.length > CHUNK_SIZE &&
      currentChunk.length > 0
    ) {
      chunks.push({ content: currentChunk.trim(), index: chunkIndex++ });
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(CHUNK_OVERLAP / 5));
      currentChunk = overlapWords.join(' ') + '\n\n' + para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), index: chunkIndex });
  }

  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push({ content: text.trim(), index: 0 });
  }

  return chunks;
}

// ============================================================================
// UPSERT EMBEDDING (content-hash aware)
// ============================================================================

/**
 * One part of a source: its block of chunk indexes. A source with a trainer
 * only part (the hint of an enabler, the answers of a quiz) writes the public
 * part at 0 and the trainer part at TRAINER_PART_CHUNK_OFFSET, and every
 * cleanup of stale chunks stays inside the block of its part.
 */
interface SourcePart {
  /** first chunk index of the part */
  offset: number;
  /** end (exclusive) of the block, null = no upper bound (whole source) */
  staleBelow: number | null;
}

const WHOLE_SOURCE: SourcePart = { offset: 0, staleBelow: null };
const PUBLIC_PART: SourcePart = {
  offset: 0,
  staleBelow: TRAINER_PART_CHUNK_OFFSET,
};
const TRAINER_PART: SourcePart = {
  offset: TRAINER_PART_CHUNK_OFFSET,
  staleBelow: TRAINER_PART_CHUNK_OFFSET + CHUNK_INDEX_BLOCK,
};
// The use case rows of this script stay below 1000. The solution pages of
// src/lib/hai/ingestUseCase.ts are page * 1000 + n and are not touched here.
const USE_CASE_PART: SourcePart = { offset: 0, staleBelow: 1000 };

async function upsertEmbedding(
  db: postgres.Sql,
  sourceType: string,
  sourceId: string,
  chunkIndex: number,
  content: string,
  embedding: number[],
  metadata: Record<string, unknown>,
  scope: IndexScope
): Promise<void> {
  const contentHash = createHash('sha256').update(content).digest('hex');
  const embeddingStr = `[${embedding.join(',')}]`;
  const taggedMetadata = { ...metadata, embeddingModel: EMBEDDING_MODEL };

  await db`
    INSERT INTO hai_embeddings (
      id, source_type, source_id, chunk_index, content, content_hash, embedding, metadata,
      training_catalog_id, visibility, organization_id
    ) VALUES (
      gen_random_uuid(),
      ${sourceType},
      ${sourceId}::uuid,
      ${chunkIndex},
      ${content},
      ${contentHash},
      ${embeddingStr}::vector,
      ${db.json(taggedMetadata)},
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
  `;
}

// ============================================================================
// GENERIC SOURCE INDEXER (with DB-based skip detection)
// ============================================================================

type SourceResult = { success: boolean; chunks: number; skipped: boolean };

/**
 * Scope of content that belongs to the platform and may be shown to trainees:
 * the catalog of the source, visibility 'all', no organization.
 */
function platformScope(catalogId: string | null | undefined): IndexScope {
  return {
    trainingCatalogId: catalogId ? String(catalogId) : null,
    visibility: 'all',
    organizationId: null,
  };
}

function catalogLabel(scope: IndexScope): string | null {
  return scope.trainingCatalogId
    ? (CATALOG_CODES.get(scope.trainingCatalogId) ?? scope.trainingCatalogId)
    : null;
}

/** Result of a source that is written in two parts (public and trainer). */
function mergeResults(a: SourceResult, b: SourceResult): SourceResult {
  return {
    success: a.success && b.success,
    chunks: a.chunks + b.chunks,
    skipped: a.skipped && b.skipped,
  };
}

async function indexSource(
  db: postgres.Sql,
  sourceType: string,
  sourceId: string,
  title: string,
  content: string,
  metadata: Record<string, unknown>,
  scope: IndexScope,
  part: SourcePart = WHOLE_SOURCE,
  // Name of the source in the plan of a dry run (several kinds of source are
  // stored as 'document')
  planLabel?: string
): Promise<SourceResult> {
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    // An empty part removes what an earlier run wrote into its block
    if (part.staleBelow !== null && !IS_DRY_RUN) {
      await db`
        DELETE FROM hai_embeddings
        WHERE source_type = ${sourceType}
          AND source_id = ${sourceId}::uuid
          AND chunk_index >= ${part.offset}
          AND chunk_index < ${part.staleBelow}
      `;
    }
    return { success: true, chunks: 0, skipped: true };
  }

  if (part.staleBelow !== null && chunks.length >= CHUNK_INDEX_BLOCK) {
    fail(`${sourceType}/${title}: too many chunks for its block, not indexed`);
    return { success: false, chunks: 0, skipped: false };
  }

  // What goes to the model is the chunk, cut at MAX_EMBED_CHARS
  const measure = {
    chars: chunks.reduce(
      (sum, c) => sum + Math.min(c.content.length, MAX_EMBED_CHARS),
      0
    ),
  };
  PLAN_INVENTORY.add(
    planLabel ?? sourceType,
    catalogLabel(scope),
    scope.visibility,
    chunks.length,
    measure
  );

  // Never write a chunk without an occupation: the search shows it to nobody
  if (!scope.trainingCatalogId) {
    fail(`${sourceType}/${title}: no training catalog, not indexed`);
    return { success: false, chunks: 0, skipped: false };
  }

  // DB-based skip: check if all chunks already exist with matching hashes
  // and the same scope
  const { allMatch, rescope, existing } = await isSourceIndexed(
    db,
    sourceType,
    sourceId,
    chunks,
    scope,
    part
  );

  if (allMatch && !rescope) {
    return { success: true, chunks: existing, skipped: true };
  }

  // A rescope (same text, other scope) writes no new embedding and costs
  // nothing at the model, so it is counted apart from the changes that embed
  (allMatch ? PLAN_RESCOPE : PLAN_CHANGES).add(
    planLabel ?? sourceType,
    catalogLabel(scope),
    scope.visibility,
    chunks.length,
    measure
  );

  if (IS_DRY_RUN) {
    info(
      `[DRY] Would ${allMatch ? 'update the scope of' : 'index'} ${sourceType}/${title} → ${chunks.length} chunks, ${scope.visibility} (${existing} existing)`
    );
    return { success: true, chunks: chunks.length, skipped: false };
  }

  try {
    if (allMatch && rescope) {
      // Same text, other occupation, audience or owner: no new embedding
      await db`
        UPDATE hai_embeddings
        SET training_catalog_id = ${scope.trainingCatalogId}::uuid,
            visibility = ${scope.visibility},
            organization_id = ${scope.organizationId}::uuid,
            updated_at = NOW()
        WHERE source_type = ${sourceType}
          AND source_id = ${sourceId}::uuid
          AND chunk_index >= ${part.offset}
          AND chunk_index < ${part.staleBelow ?? 2147483647}
      `;
      return { success: true, chunks: chunks.length, skipped: false };
    }

    // Generate embeddings in parallel batches
    const texts = chunks.map(c => c.content);
    const embeddings = await generateEmbeddingsBatch(texts);

    // Upsert all chunks
    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i];
      if (!emb) {
        fail(`Null embedding for chunk ${i} of ${sourceType}/${title}`);
        continue;
      }
      await upsertEmbedding(
        db,
        sourceType,
        sourceId,
        part.offset + chunks[i].index,
        chunks[i].content,
        emb,
        { ...metadata, title },
        scope
      );
    }

    // Clean up stale chunks (if content was shortened), inside the block of
    // this part
    if (part.staleBelow === null) {
      await db`
        DELETE FROM hai_embeddings
        WHERE source_type = ${sourceType}
          AND source_id = ${sourceId}::uuid
          AND chunk_index > ${chunks.length - 1}
      `;
    } else {
      await db`
        DELETE FROM hai_embeddings
        WHERE source_type = ${sourceType}
          AND source_id = ${sourceId}::uuid
          AND chunk_index > ${part.offset + chunks.length - 1}
          AND chunk_index < ${part.staleBelow}
      `;
    }

    return { success: true, chunks: chunks.length, skipped: false };
  } catch (e: any) {
    fail(`${sourceType}/${title}: ${e.message}`);
    return { success: false, chunks: 0, skipped: false };
  }
}

// ============================================================================
// 1. INDEX COURSES
// ============================================================================

async function indexCourses(db: postgres.Sql) {
  log('📦 Indexing Courses...');
  const rows = await db`
    SELECT id, title, description, training_catalog_id
    FROM courses
    WHERE is_active = true
      AND (${CATALOG_ID}::uuid IS NULL OR training_catalog_id = ${CATALOG_ID}::uuid)
  `;

  let indexed = 0,
    skipped = 0,
    failed = 0;
  for (const row of rows) {
    const content = [
      `Kurs: ${row.title}`,
      row.description || 'Keine Beschreibung verfügbar.',
    ].join('\n\n');

    const result = await indexSource(
      db,
      'course',
      row.id,
      row.title,
      content,
      { courseId: row.id },
      platformScope(row.training_catalog_id)
    );

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'course',
        sourceId: row.id,
        title: row.title,
        status: 'skipped',
        chunks: result.chunks,
      });
    } else if (result.success) {
      indexed++;
      ok(`Course: ${row.title} (${result.chunks} chunks)`);
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'course',
        sourceId: row.id,
        title: row.title,
        status: 'indexed',
        chunks: result.chunks,
      });
    } else {
      failed++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'course',
        sourceId: row.id,
        title: row.title,
        status: 'failed',
        chunks: 0,
      });
    }
  }

  log(
    `Courses done: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (${rows.length} total)`
  );
  return { indexed, skipped, failed, total: rows.length };
}

// ============================================================================
// 2. INDEX ENABLERS (with Lernfeld & Course metadata)
// ============================================================================

async function indexEnablers(db: postgres.Sql) {
  log('🎯 Indexing Enablers...');

  const rows = await db`
    SELECT e.id, e.title, e.description_text,
           e.course_id, e.scenario_text, e.hint_text, e.scenarios,
           e.training_catalog_id,
           c.title as course_title
    FROM enablers e
    LEFT JOIN courses c ON c.id = e.course_id
    WHERE e.is_active = true
      AND (${CATALOG_ID}::uuid IS NULL OR e.training_catalog_id = ${CATALOG_ID}::uuid)
  `;

  // Pre-load lernfeld mappings
  const lfMappings = await db`
    SELECT lm.enabler_id, lf.code AS label, lf.title as lf_title
    FROM training_catalog_content_mappings lm
    JOIN training_catalog_learning_fields lf ON lf.id = lm.learning_field_id
    WHERE lm.enabler_id IS NOT NULL
  `.catch(() => {
    warn('learning field mappings not available — skipping LF enrichment');
    return [] as any[];
  });

  const enablerLfMap = new Map<string, { label: string; title: string }[]>();
  for (const m of lfMappings) {
    if (!enablerLfMap.has(m.enabler_id)) enablerLfMap.set(m.enabler_id, []);
    enablerLfMap.get(m.enabler_id)!.push({ label: m.label, title: m.lf_title });
  }

  let indexed = 0,
    skipped = 0,
    failed = 0;

  for (const e of rows) {
    const parts: string[] = [`Enabler: ${e.title}`];
    // The hint of a scenario is its own chunk (SCENARIO_HINT_VISIBILITY), not
    // part of the enabler text
    const hintParts: string[] = [];
    if (e.course_title) parts.push(`Kurs: ${e.course_title}`);
    if (e.description_text) parts.push(`Beschreibung: ${e.description_text}`);
    if (e.scenario_text) parts.push(`Szenario: ${e.scenario_text}`);
    if (e.hint_text) hintParts.push(`Hinweis: ${e.hint_text}`);
    if (e.scenarios && Array.isArray(e.scenarios)) {
      for (const s of e.scenarios) {
        if (s.text) parts.push(`Szenario: ${s.text}`);
        if (s.hint) hintParts.push(`Hinweis: ${s.hint}`);
      }
    }

    const lfs = enablerLfMap.get(e.id);
    if (lfs && lfs.length > 0) {
      const lfStr = lfs.map(l => `${l.label}: ${l.title}`).join(', ');
      parts.push(`Lernfelder: ${lfStr}`);
    }

    const content = parts.join('\n\n');
    const hintContent =
      hintParts.length > 0
        ? [`Enabler: ${e.title}`, ...hintParts].join('\n\n')
        : '';
    if (content.length < 20 && !hintContent) {
      skipped++;
      continue;
    }

    const metadata: Record<string, unknown> = {
      courseId: e.course_id,
      courseTitle: e.course_title,
      enablerTitle: e.title,
    };
    if (lfs) metadata.lernfelder = lfs.map(l => l.label);

    const scope = platformScope(e.training_catalog_id);
    let result = await indexSource(
      db,
      'enabler',
      e.id,
      e.title,
      content.length < 20 ? '' : content,
      metadata,
      scope,
      PUBLIC_PART
    );
    result = mergeResults(
      result,
      await indexSource(
        db,
        'enabler',
        e.id,
        e.title,
        hintContent,
        { ...metadata, contentPart: 'hint' },
        { ...scope, visibility: SCENARIO_HINT_VISIBILITY },
        TRAINER_PART
      )
    );

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'enabler',
        sourceId: e.id,
        title: e.title,
        status: 'skipped',
        chunks: result.chunks,
      });
    } else if (result.success) {
      indexed++;
      ok(`Enabler: ${e.title} (${result.chunks} chunks)`);
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'enabler',
        sourceId: e.id,
        title: e.title,
        status: 'indexed',
        chunks: result.chunks,
      });
    } else {
      failed++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'enabler',
        sourceId: e.id,
        title: e.title,
        status: 'failed',
        chunks: 0,
      });
    }
  }

  log(
    `Enablers done: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (${rows.length} total)`
  );
  return { indexed, skipped, failed, total: rows.length };
}

// ============================================================================
// 3. INDEX USE CASES (with Lernfeld & Course metadata)
// ============================================================================

async function indexUseCases(db: postgres.Sql) {
  log('📋 Indexing Use Cases...');

  const rows = await db`
    SELECT uc.id, uc.title, uc.description_text, uc.course_id,
           uc.lernfelder as lernfelder_codes, uc.year, uc.training_stage,
           uc.training_catalog_id,
           c.title as course_title
    FROM use_cases uc
    LEFT JOIN courses c ON c.id = uc.course_id
    WHERE uc.is_active = true
      AND (${CATALOG_ID}::uuid IS NULL OR uc.training_catalog_id = ${CATALOG_ID}::uuid)
  `;

  const lfMappings = await db`
    SELECT lm.use_case_id, lf.code AS label, lf.title as lf_title
    FROM training_catalog_content_mappings lm
    JOIN training_catalog_learning_fields lf ON lf.id = lm.learning_field_id
    WHERE lm.use_case_id IS NOT NULL
  `.catch(() => [] as any[]);

  const ucLfMap = new Map<string, { label: string; title: string }[]>();
  for (const m of lfMappings) {
    if (!ucLfMap.has(m.use_case_id)) ucLfMap.set(m.use_case_id, []);
    ucLfMap.get(m.use_case_id)!.push({ label: m.label, title: m.lf_title });
  }

  let indexed = 0,
    skipped = 0,
    failed = 0;

  for (const uc of rows) {
    const parts: string[] = [`Use Case: ${uc.title}`];
    if (uc.course_title) parts.push(`Kurs: ${uc.course_title}`);
    if (uc.description_text) parts.push(`Beschreibung: ${uc.description_text}`);
    if (uc.year) parts.push(`Ausbildungsjahr: ${uc.year}`);
    if (uc.training_stage)
      parts.push(`Ausbildungsabschnitt: ${uc.training_stage}`);

    const lfs = ucLfMap.get(uc.id);
    if (lfs && lfs.length > 0) {
      const lfStr = lfs.map(l => `${l.label}: ${l.title}`).join(', ');
      parts.push(`Lernfelder: ${lfStr}`);
    } else if (uc.lernfelder_codes && uc.lernfelder_codes.length > 0) {
      parts.push(`Lernfelder: ${uc.lernfelder_codes.join(', ')}`);
    }

    const content = parts.join('\n\n');
    if (content.length < 20) {
      skipped++;
      continue;
    }

    const metadata: Record<string, unknown> = {
      courseId: uc.course_id,
      courseTitle: uc.course_title,
      useCaseTitle: uc.title,
    };
    if (lfs) metadata.lernfelder = lfs.map(l => l.label);
    if (uc.year) metadata.year = uc.year;

    const result = await indexSource(
      db,
      'use_case',
      uc.id,
      uc.title,
      content,
      metadata,
      platformScope(uc.training_catalog_id),
      USE_CASE_PART
    );

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'use_case',
        sourceId: uc.id,
        title: uc.title,
        status: 'skipped',
        chunks: result.chunks,
      });
    } else if (result.success) {
      indexed++;
      ok(`Use Case: ${uc.title} (${result.chunks} chunks)`);
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'use_case',
        sourceId: uc.id,
        title: uc.title,
        status: 'indexed',
        chunks: result.chunks,
      });
    } else {
      failed++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'use_case',
        sourceId: uc.id,
        title: uc.title,
        status: 'failed',
        chunks: 0,
      });
    }
  }

  log(
    `Use Cases done: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (${rows.length} total)`
  );
  return { indexed, skipped, failed, total: rows.length };
}

// ============================================================================
// 4. INDEX QUIZZES (questions + options + explanations)
// ============================================================================

async function indexQuizzes(db: postgres.Sql) {
  log('❓ Indexing Quizzes...');

  let allQuizzes: any[];
  try {
    allQuizzes = await db`
      SELECT q.id, q.title, q.quiz_type, q.training_catalog_id,
             eql.enabler_id, eql.difficulty
      FROM quizzes q
      LEFT JOIN enabler_quiz_links eql ON eql.quiz_id = q.id
      WHERE q.is_active = true
        AND (${CATALOG_ID}::uuid IS NULL OR q.training_catalog_id = ${CATALOG_ID}::uuid)
    `;
  } catch {
    try {
      allQuizzes = await db`
        SELECT q.id, q.title, q.quiz_type, q.training_catalog_id,
               eq.enabler_id, NULL as difficulty
        FROM quizzes q
        LEFT JOIN enabler_quizzes eq ON eq.quiz_id = q.id
        WHERE q.is_active = true
          AND (${CATALOG_ID}::uuid IS NULL OR q.training_catalog_id = ${CATALOG_ID}::uuid)
      `;
    } catch {
      warn('Quizzes table not found, skipping');
      return { indexed: 0, skipped: 0, failed: 0, total: 0 };
    }
  }

  let indexed = 0,
    skipped = 0,
    failed = 0;

  for (let qi = 0; qi < allQuizzes.length; qi++) {
    const quiz = allQuizzes[qi];

    const questionsWithOptions = await db`
      SELECT 
        q.id, q.question_text, q.question_type, q.order_index, q.expected_answer,
        json_agg(json_build_object(
          'text', o.option_text,
          'correct', o.is_correct,
          'explanation', o.explanation
        ) ORDER BY o.id) as options
      FROM questions q
      LEFT JOIN options o ON o.question_id = q.id
      WHERE q.quiz_id = ${quiz.id}
      GROUP BY q.id, q.question_text, q.question_type, q.order_index, q.expected_answer
      ORDER BY q.order_index
    `;

    const typeLabel = quiz.quiz_type === 'GLOBAL' ? 'Global Quiz' : 'Quiz';
    const diffLabel = quiz.difficulty ? ` (${quiz.difficulty})` : '';
    const quizInput: QuizQuestionInput[] = questionsWithOptions.map(q => ({
      orderIndex: q.order_index,
      text: q.question_text,
      type: q.question_type,
      expectedAnswer:
        q.question_type === 'TEXT' && q.expected_answer
          ? q.expected_answer
          : null,
      options:
        q.question_type === 'MCQ' && Array.isArray(q.options)
          ? q.options.map((opt: any) => ({
              text: opt.text,
              isCorrect: opt.correct,
              explanation: opt.explanation,
            }))
          : [],
    }));

    // Questions and answers are separate texts BEFORE the size chunking:
    // every chunk of the questions is visible to trainees, every chunk of the
    // answers is trainer only, and no chunk of the questions carries a marker
    // of a correct option, an explanation or an expected answer
    const texts = buildQuizTexts(
      `${typeLabel}: ${quiz.title}${diffLabel}`,
      quizInput
    );
    if (texts.questions.length < 20) {
      skipped++;
      continue;
    }

    const metadata: Record<string, unknown> = {
      quizTitle: quiz.title,
      quizType: quiz.quiz_type,
      questionCount: questionsWithOptions.length,
    };
    if (quiz.enabler_id) metadata.enablerId = quiz.enabler_id;
    if (quiz.difficulty) metadata.difficulty = quiz.difficulty;

    const scope = platformScope(quiz.training_catalog_id);
    let result = await indexSource(
      db,
      'quiz',
      quiz.id,
      quiz.title,
      texts.questions,
      { ...metadata, contentPart: 'questions' },
      { ...scope, visibility: QUIZ_QUESTIONS_VISIBILITY },
      PUBLIC_PART
    );
    // a quiz without answer content clears the answers block of an old run
    result = mergeResults(
      result,
      await indexSource(
        db,
        'quiz',
        quiz.id,
        quiz.title,
        texts.answers ?? '',
        { ...metadata, contentPart: 'answers' },
        { ...scope, visibility: QUIZ_ANSWERS_VISIBILITY },
        TRAINER_PART
      )
    );

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'quiz',
        sourceId: quiz.id,
        title: quiz.title,
        status: 'skipped',
        chunks: result.chunks,
      });
    } else if (result.success) {
      indexed++;
      ok(`Quiz: ${quiz.title} (${result.chunks} chunks)`);
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'quiz',
        sourceId: quiz.id,
        title: quiz.title,
        status: 'indexed',
        chunks: result.chunks,
      });
    } else {
      failed++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'quiz',
        sourceId: quiz.id,
        title: quiz.title,
        status: 'failed',
        chunks: 0,
      });
    }

    if ((qi + 1) % 50 === 0) {
      log(`  Quiz progress: ${qi + 1}/${allQuizzes.length}...`);
    }
  }

  log(
    `Quizzes done: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (${allQuizzes.length} total)`
  );
  return { indexed, skipped, failed, total: allQuizzes.length };
}

// ============================================================================
// 5. INDEX LERNFELDER (IHK LF1–LF12)
// ============================================================================

async function indexLernfelder(db: postgres.Sql) {
  log('📚 Indexing Lernfelder...');

  let lernfelder: any[];
  try {
    // training_catalog_learning_fields of every occupation (not the FIAE-only
    // compatibility view); code is the label (LF-1)
    lernfelder = await db`
      SELECT lf.id, lf.code AS label, lf.title, lf.description,
             lf.training_catalog_id
      FROM training_catalog_learning_fields lf
      WHERE (${CATALOG_ID}::uuid IS NULL OR lf.training_catalog_id = ${CATALOG_ID}::uuid)
      ORDER BY lf.training_catalog_id, lf.order_index
    `;
  } catch {
    warn('training_catalog_learning_fields not found — skipping');
    return { indexed: 0, skipped: 0, failed: 0, total: 0 };
  }

  if (lernfelder.length === 0) {
    warn('No Lernfelder found (table empty)');
    return { indexed: 0, skipped: 0, failed: 0, total: 0 };
  }

  const mappings = await db`
    SELECT lm.learning_field_id AS lernfeld_id,
           e.title as enabler_title,
           uc.title as use_case_title
    FROM training_catalog_content_mappings lm
    LEFT JOIN enablers e ON e.id = lm.enabler_id
    LEFT JOIN use_cases uc ON uc.id = lm.use_case_id
  `.catch(() => [] as any[]);

  const lfContentMap = new Map<
    string,
    { enablers: string[]; useCases: string[] }
  >();
  for (const m of mappings) {
    if (!lfContentMap.has(m.lernfeld_id)) {
      lfContentMap.set(m.lernfeld_id, { enablers: [], useCases: [] });
    }
    const entry = lfContentMap.get(m.lernfeld_id)!;
    if (m.enabler_title) entry.enablers.push(m.enabler_title);
    if (m.use_case_title) entry.useCases.push(m.use_case_title);
  }

  let indexed = 0,
    skipped = 0,
    failed = 0;

  for (const lf of lernfelder) {
    const lfLabel = lf.label || '';
    const parts: string[] = [`Lernfeld ${lfLabel}: ${lf.title}`];
    if (lf.description) parts.push(lf.description);

    const links = lfContentMap.get(lf.id);
    if (links) {
      if (links.enablers.length > 0) {
        parts.push(`Zugehörige Enabler: ${links.enablers.join(', ')}`);
      }
      if (links.useCases.length > 0) {
        parts.push(`Zugehörige Use Cases: ${links.useCases.join(', ')}`);
      }
    }

    const content = parts.join('\n\n');

    const result = await indexSource(
      db,
      'document',
      lf.id,
      `${lfLabel}: ${lf.title}`,
      content,
      { lernfeldLabel: lfLabel },
      platformScope(lf.training_catalog_id),
      WHOLE_SOURCE,
      'document (lernfeld)'
    );

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'lernfeld',
        sourceId: lf.id,
        title: `${lfLabel}: ${lf.title}`,
        status: 'skipped',
        chunks: result.chunks,
      });
    } else if (result.success) {
      indexed++;
      ok(`${lfLabel}: ${lf.title} (${result.chunks} chunks)`);
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'lernfeld',
        sourceId: lf.id,
        title: `${lfLabel}: ${lf.title}`,
        status: 'indexed',
        chunks: result.chunks,
      });
    } else {
      failed++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'lernfeld',
        sourceId: lf.id,
        title: `${lfLabel}: ${lf.title}`,
        status: 'failed',
        chunks: 0,
      });
    }
  }

  log(
    `Lernfelder done: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (${lernfelder.length} total)`
  );
  return { indexed, skipped, failed, total: lernfelder.length };
}

// ============================================================================
// 6. INDEX TRAINING COMPONENTS (IHK Rahmenplan)
// ============================================================================

async function indexTrainingComponents(db: postgres.Sql) {
  log('🏗️  Indexing Training Components (Rahmenplan)...');

  let components: any[];
  try {
    // phase and kind (catalog columns) go into the metadata as componentPhase
    // and componentKind, see src/lib/hai/componentMetadata.ts
    components = await db`
      SELECT tc.id, tc.code, tc.title, tc.description, tc.total_weeks, tc.total_hours,
             tc.training_year, tc.order_index, tc.phase, tc.kind,
             tc.training_catalog_id
      FROM training_components tc
      WHERE (${CATALOG_ID}::uuid IS NULL OR tc.training_catalog_id = ${CATALOG_ID}::uuid)
      ORDER BY tc.order_index
    `;
  } catch {
    try {
      // A database without the catalog columns: index as before, without them
      components = await db`
        SELECT tc.id, tc.code, tc.title, tc.description, tc.total_weeks, tc.total_hours,
               tc.training_year, tc.order_index, tc.training_catalog_id
        FROM training_components tc
        WHERE (${CATALOG_ID}::uuid IS NULL OR tc.training_catalog_id = ${CATALOG_ID}::uuid)
        ORDER BY tc.order_index
      `;
    } catch {
      warn('training_components table not found — skipping');
      return { indexed: 0, skipped: 0, failed: 0, total: 0 };
    }
  }

  if (components.length === 0) {
    warn('No training components found');
    return { indexed: 0, skipped: 0, failed: 0, total: 0 };
  }

  const tUseCases = await db`
    SELECT tuc.id, tuc.component_id, tuc.letter, tuc.description, tuc.planned_hours
    FROM training_use_cases tuc
    ORDER BY tuc.order_index
  `.catch(() => [] as any[]);

  const compUseCaseMap = new Map<string, any[]>();
  for (const tuc of tUseCases) {
    if (!compUseCaseMap.has(tuc.component_id))
      compUseCaseMap.set(tuc.component_id, []);
    compUseCaseMap.get(tuc.component_id)!.push(tuc);
  }

  let indexed = 0,
    skipped = 0,
    failed = 0;

  for (const comp of components) {
    const parts: string[] = [
      `Ausbildungsrahmenplan – ${comp.code}: ${comp.title}`,
    ];
    if (comp.description) parts.push(comp.description);
    if (comp.training_year)
      parts.push(`Ausbildungsjahr: ${comp.training_year}`);
    // no "0 Stunden" or "0 Wochen" where a value is missing
    const duration = componentDurationText(comp.total_weeks, comp.total_hours);
    if (duration) parts.push(duration);

    const tucs = compUseCaseMap.get(comp.id) || [];
    if (tucs.length > 0) {
      parts.push('\nTeilaufgaben:');
      for (const tuc of tucs) {
        parts.push(
          `  ${tuc.letter}) ${tuc.description} (${tuc.planned_hours}h)`
        );
      }
    }

    const content = parts.join('\n');

    const result = await indexSource(
      db,
      'document',
      comp.id,
      `${comp.code}: ${comp.title}`,
      content,
      buildTrainingComponentMetadata(comp, tucs.length),
      platformScope(comp.training_catalog_id),
      WHOLE_SOURCE,
      'document (training_component)'
    );

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'training_component',
        sourceId: comp.id,
        title: `${comp.code}: ${comp.title}`,
        status: 'skipped',
        chunks: result.chunks,
      });
    } else if (result.success) {
      indexed++;
      ok(`${comp.code}: ${comp.title} (${result.chunks} chunks)`);
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'training_component',
        sourceId: comp.id,
        title: `${comp.code}: ${comp.title}`,
        status: 'indexed',
        chunks: result.chunks,
      });
    } else {
      failed++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'training_component',
        sourceId: comp.id,
        title: `${comp.code}: ${comp.title}`,
        status: 'failed',
        chunks: 0,
      });
    }
  }

  log(
    `Training Components done: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (${components.length} total)`
  );
  return { indexed, skipped, failed, total: components.length };
}

// ============================================================================
// 7. INDEX PDF DOCUMENTS (NEW — text extraction from content_documents)
// ============================================================================

/**
 * Clean extracted PDF text
 */
function cleanPDFText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^[\s]*\d+[\s]*$/gm, '')
    .replace(/Seite \d+ von \d+/gi, '')
    .replace(/Page \d+ of \d+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\s*©.*$/gm, '')
    .replace(/^\s*www\..*$/gm, '')
    .trim();
}

/**
 * The bytes of the file of a document row. A file of the bucket content is read
 * with the secret key straight from the storage, which works for a public and
 * for a private bucket (the bucket becomes private at the go-live). Without the
 * key, or for any other address, the stored address is fetched as before.
 * The key is read from the environment only and never logged.
 */
async function readPdfBytes(url: string): Promise<Buffer | null> {
  const ref = parseContentReference(url);
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (ref.kind === 'content' && key && base) {
    const response = await fetch(
      `${new URL(base).origin}/storage/v1/object/content/${ref.path}`,
      {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
        redirect: 'error',
      }
    );
    if (!response.ok) {
      warn(`Failed to read PDF from the storage: ${response.status} ${ref.path}`);
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const response = await fetch(url);
  if (!response.ok) {
    warn(`Failed to fetch PDF: ${response.status} ${url}`);
    return null;
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Extract text from a PDF URL
 */
async function extractPDFText(
  url: string
): Promise<{ text: string; pageCount: number } | null> {
  try {
    const pdfParse = require('pdf-parse/lib/pdf-parse');

    const buffer = await readPdfBytes(url);
    if (!buffer) return null;
    const data = await pdfParse(buffer);

    const cleaned = cleanPDFText(data.text || '');
    return {
      text: cleaned,
      pageCount: data.numpages || 1,
    };
  } catch (e: any) {
    warn(`PDF extraction failed: ${e.message} (${url})`);
    return null;
  }
}

async function indexPDFDocuments(db: postgres.Sql) {
  log('📄 Indexing PDF Documents and text rows...');

  const docs = await db`
    SELECT cd.id, cd.title, cd.storage_url, cd.document_type,
           cd.enabler_id, cd.use_case_id, cd.course_id,
           cd.page_count, cd.is_indexed_by_hai,
           cd.organization_id, cd.visibility,
           cd.description, cd.mime_type,
           e.title as enabler_title,
           c.title as course_title,
           uc.title as use_case_title,
           e.training_catalog_id as enabler_catalog_id,
           uc.training_catalog_id as use_case_catalog_id,
           c.training_catalog_id as course_catalog_id
    FROM content_documents cd
    LEFT JOIN enablers e ON e.id = cd.enabler_id
    LEFT JOIN courses c ON c.id = cd.course_id
    LEFT JOIN use_cases uc ON uc.id = cd.use_case_id
    WHERE (
      ${CATALOG_ID}::uuid IS NULL
      OR COALESCE(e.training_catalog_id, uc.training_catalog_id, c.training_catalog_id) = ${CATALOG_ID}::uuid
    )
    ORDER BY cd.created_at
  `;

  if (docs.length === 0) {
    warn('No content_documents found');
    return { indexed: 0, skipped: 0, failed: 0, total: 0, pages: 0 };
  }

  log(`Found ${docs.length} documents to process`);

  let indexed = 0,
    skipped = 0,
    failed = 0,
    totalPages = 0;
  // Why a document was not indexed (reason of planDocumentIndexing → count)
  const skippedByReason = new Map<string, number>();

  for (let di = 0; di < docs.length; di++) {
    const doc = docs[di];
    const docLabel = `${doc.document_type} — ${doc.title}`;

    // One rule for the whole decision (src/lib/hai/indexScope.ts): what the
    // row is (a PDF file or a text row), whether it is read at all, and for
    // whom its chunks are. The occupation is the one of its enabler, use case
    // or course. A solution or a trainer-only row is trainer level in every
    // form (file or text). A private reference (the model solutions of the private
    // bucket) is never fetched.
    const plan = planDocumentIndexing({
      documentType: doc.document_type,
      visibility: doc.visibility,
      storageUrl: doc.storage_url,
      mimeType: doc.mime_type,
      description: doc.description,
      organizationId: doc.organization_id ? String(doc.organization_id) : null,
      enablerCatalogId: doc.enabler_catalog_id
        ? String(doc.enabler_catalog_id)
        : null,
      useCaseCatalogId: doc.use_case_catalog_id
        ? String(doc.use_case_catalog_id)
        : null,
      courseCatalogId: doc.course_catalog_id
        ? String(doc.course_catalog_id)
        : null,
    });
    if (plan.kind === 'skip') {
      warn(`Document not indexed (${plan.reason}): ${docLabel}`);
      skippedByReason.set(
        plan.reason,
        (skippedByReason.get(plan.reason) ?? 0) + 1
      );
      // A row that is no longer indexable (retyped to a solution, moved to a
      // private reference, text shortened, no catalog) must not keep the chunks
      // an earlier run wrote with its old scope
      if (!IS_DRY_RUN) {
        await db`
          DELETE FROM hai_embeddings
          WHERE source_type = 'document'
            AND source_id = ${doc.id}::uuid
        `.catch((e: any) => warn(`Old chunks not removed: ${e.message}`));
      }
      skipped++;
      continue;
    }
    const scope = plan.scope;

    // Context of the document, for both forms
    const contextParts: string[] = [];
    if (doc.enabler_title) contextParts.push(`Enabler: ${doc.enabler_title}`);
    if (doc.course_title) contextParts.push(`Kurs: ${doc.course_title}`);
    if (doc.use_case_title)
      contextParts.push(`Use Case: ${doc.use_case_title}`);
    contextParts.push(`Dokumenttyp: ${doc.document_type}`);
    contextParts.push(`Dokument: ${doc.title}`);

    const metadata: Record<string, unknown> = {
      documentId: doc.id,
      documentTitle: doc.title,
      documentType: doc.document_type,
    };
    if (doc.enabler_id) metadata.enablerId = doc.enabler_id;
    if (doc.enabler_title) metadata.enablerTitle = doc.enabler_title;
    if (doc.course_id) metadata.courseId = doc.course_id;
    if (doc.course_title) metadata.courseTitle = doc.course_title;
    if (doc.use_case_id) metadata.useCaseId = doc.use_case_id;
    if (doc.use_case_title) metadata.useCaseTitle = doc.use_case_title;

    let result: SourceResult;
    let pageCount = 0;

    if (plan.kind === 'text') {
      // A text row of the import: the text is the description, nothing is
      // fetched, a dry run counts its chunks like any other text source
      const fullContent =
        contextParts.join('\n') + '\n\n' + String(doc.description).trim();
      result = await indexSource(
        db,
        'document',
        doc.id,
        doc.title,
        fullContent,
        { ...metadata, contentFormat: 'text' },
        scope,
        WHOLE_SOURCE,
        'document (text row)'
      );
    } else {
      // A dry run does not download the PDF: it counts the file and its pages
      if (IS_DRY_RUN) {
        const measure = {
          unit: 'files' as const,
          pages: Number(doc.page_count ?? 0),
        };
        PLAN_INVENTORY.add(
          'document (PDF files, not chunks)',
          catalogLabel(scope),
          scope.visibility,
          1,
          measure
        );
        // Upper bound: a real run reads every PDF and embeds what changed or
        // what another model tagged, a dry run cannot know that without the file
        PLAN_CHANGES.add(
          'document (PDF files, not chunks)',
          catalogLabel(scope),
          scope.visibility,
          1,
          measure
        );
        skipped++;
        continue;
      }

      // Extract PDF text
      const extraction = await extractPDFText(doc.storage_url);
      if (!extraction || extraction.text.length < 20) {
        warn(`No usable text from PDF: ${docLabel}`);
        skipped++;
        continue;
      }

      totalPages += extraction.pageCount;
      pageCount = extraction.pageCount;
      metadata.pageCount = extraction.pageCount;

      const fullContent = contextParts.join('\n') + '\n\n' + extraction.text;
      result = await indexSource(
        db,
        'document',
        doc.id,
        doc.title,
        fullContent,
        metadata,
        scope,
        WHOLE_SOURCE,
        'document (PDF)'
      );
    }

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'document',
        sourceId: doc.id,
        title: docLabel,
        status: 'skipped',
        chunks: result.chunks,
        pages: pageCount,
      });
    } else if (result.success) {
      indexed++;
      ok(
        `${plan.kind === 'text' ? 'Text row' : 'PDF'}: ${docLabel} (${result.chunks} chunks${pageCount ? `, ${pageCount} pages` : ''})`
      );
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'document',
        sourceId: doc.id,
        title: docLabel,
        status: 'indexed',
        chunks: result.chunks,
        pages: pageCount,
      });

      // Mark as indexed in content_documents table
      if (!IS_DRY_RUN) {
        await db`
          UPDATE content_documents
          SET is_indexed_by_hai = true,
              page_count = ${pageCount > 0 ? pageCount : (doc.page_count ?? null)},
              updated_at = NOW()
          WHERE id = ${doc.id}
        `.catch(() => {
          /* non-fatal */
        });
      }
    } else {
      failed++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'document',
        sourceId: doc.id,
        title: docLabel,
        status: 'failed',
        chunks: 0,
        pages: 0,
      });
    }

    if ((di + 1) % 20 === 0) {
      log(`  Document progress: ${di + 1}/${docs.length}...`);
    }
  }

  if (skippedByReason.size > 0) {
    info(
      `documents skipped by reason: ${[...skippedByReason]
        .map(([reason, count]) => `${reason} ${count}`)
        .join(', ')}`
    );
  }
  log(
    `Documents done: ${indexed} indexed, ${skipped} unchanged or skipped, ${failed} failed (${docs.length} docs, ${totalPages} pages total)`
  );
  return { indexed, skipped, failed, total: docs.length, pages: totalPages };
}

// ============================================================================
// PURGE FUNCTIONS
// ============================================================================

/**
 * Delete the chunks of ONE catalog (--purge needs --catalog, checked by
 * parseReindexArgs). A dry run only counts them.
 */
async function purgeAllEmbeddings(db: postgres.Sql) {
  log(
    `🗑️  Purging the embeddings of catalog ${OPTIONS.catalogCode}${IS_DRY_RUN ? ' (dry run, count only)' : ''}...`
  );
  if (!CATALOG_ID) {
    fail('--purge without a resolved catalog, nothing was deleted');
    return;
  }

  const [{ count }] = await db`
    SELECT COUNT(*) as count FROM hai_embeddings
    WHERE training_catalog_id = ${CATALOG_ID}::uuid
      AND (source_type IN ('course', 'enabler', 'quiz', 'document')
        OR (source_type = 'use_case' AND chunk_index < 1000))
  `;
  if (Number(count) === 0) {
    ok('No embeddings to purge for this catalog');
    return;
  }

  const breakdown = await db`
    SELECT source_type, visibility, COUNT(*) as cnt
    FROM hai_embeddings
    WHERE training_catalog_id = ${CATALOG_ID}::uuid
      AND (source_type IN ('course', 'enabler', 'quiz', 'document')
        OR (source_type = 'use_case' AND chunk_index < 1000))
    GROUP BY source_type, visibility
    ORDER BY cnt DESC
  `;
  for (const row of breakdown) {
    info(`${row.source_type} (${row.visibility}): ${row.cnt} chunks`);
  }

  if (IS_DRY_RUN) {
    info(`[DRY] Would purge ${count} embedding chunks`);
    return;
  }
  await db`
    DELETE FROM hai_embeddings
    WHERE training_catalog_id = ${CATALOG_ID}::uuid
      AND (source_type IN ('course', 'enabler', 'quiz', 'document')
        OR (source_type = 'use_case' AND chunk_index < 1000))
  `;
  ok(`Purged ${count} embedding chunks`);
}

async function purgeStaleEmbeddings(db: postgres.Sql) {
  log(
    `🧹 Purging non-Gemini embeddings of catalog ${OPTIONS.catalogCode}${IS_DRY_RUN ? ' (dry run, count only)' : ''}...`
  );
  if (!CATALOG_ID) {
    fail('--purge-stale without a resolved catalog, nothing was deleted');
    return;
  }

  const [{ total_count }] = await db`
    SELECT COUNT(*) as total_count FROM hai_embeddings
    WHERE training_catalog_id = ${CATALOG_ID}::uuid
      AND (source_type IN ('course', 'enabler', 'quiz', 'document')
        OR (source_type = 'use_case' AND chunk_index < 1000))
  `;
  if (Number(total_count) === 0) {
    ok('No embeddings found for this catalog — nothing to purge');
    return;
  }

  const modelBreakdown = await db`
    SELECT
      COALESCE(metadata->>'embeddingModel', '(untagged)') as model,
      COUNT(*) as cnt
    FROM hai_embeddings
    WHERE training_catalog_id = ${CATALOG_ID}::uuid
      AND (source_type IN ('course', 'enabler', 'quiz', 'document')
        OR (source_type = 'use_case' AND chunk_index < 1000))
    GROUP BY COALESCE(metadata->>'embeddingModel', '(untagged)')
    ORDER BY cnt DESC
  `;
  info('Current embedding model distribution:');
  for (const row of modelBreakdown) {
    const marker = row.model === EMBEDDING_MODEL ? ' ✓ (keep)' : ' ✗ (purge)';
    info(`  ${row.model}: ${row.cnt} chunks${marker}`);
  }

  const [{ stale_count }] = await db`
    SELECT COUNT(*) as stale_count FROM hai_embeddings
    WHERE training_catalog_id = ${CATALOG_ID}::uuid
      AND (source_type IN ('course', 'enabler', 'quiz', 'document')
        OR (source_type = 'use_case' AND chunk_index < 1000))
      AND (metadata->>'embeddingModel' IS NULL
        OR metadata->>'embeddingModel' != ${EMBEDDING_MODEL})
  `;
  const staleCount = Number(stale_count);

  if (staleCount === 0) {
    ok(
      `All ${total_count} embeddings are tagged with ${EMBEDDING_MODEL} — nothing to purge`
    );
    return;
  }

  if (IS_DRY_RUN) {
    info(`[DRY] Would purge ${staleCount} non-Gemini embedding chunks`);
    return;
  }
  await db`
    DELETE FROM hai_embeddings
    WHERE training_catalog_id = ${CATALOG_ID}::uuid
      AND (source_type IN ('course', 'enabler', 'quiz', 'document')
        OR (source_type = 'use_case' AND chunk_index < 1000))
      AND (metadata->>'embeddingModel' IS NULL
        OR metadata->>'embeddingModel' != ${EMBEDDING_MODEL})
  `;
  ok(`Purged ${staleCount} non-Gemini embedding chunks`);
}

function printPlan(title: string, plan: ChunkPlan) {
  console.log(`  ${title}`);
  if (plan.rows().length === 0) {
    console.log('    (nothing)');
    return;
  }
  console.log(
    `    ${'source type'.padEnd(36)}${'catalog'.padEnd(14)}${'visibility'.padEnd(12)}${'count'.padEnd(10)}${'chars'.padEnd(12)}est. tokens (${DEFAULT_CHARS_PER_TOKEN} chars each)`
  );
  for (const row of plan.rows()) {
    const count = row.unit === 'files' ? `${row.chunks} files` : row.chunks;
    // pages of files that are not read, characters of chunks that are
    const measure =
      row.unit === 'files'
        ? `${row.pages} pages`.padEnd(12) + '-'
        : String(row.chars).padEnd(12) + estimateTokens(row.chars);
    console.log(
      `    ${row.sourceType.padEnd(36)}${row.catalog.padEnd(14)}${row.visibility.padEnd(12)}${String(count).padEnd(10)}${measure}`
    );
  }
  const chars = plan
    .rows()
    .reduce((sum, row) => sum + (row.unit === 'chunks' ? row.chars : 0), 0);
  console.log(
    `    ${'total chunks'.padEnd(62)}${String(plan.total()).padEnd(10)}${String(chars).padEnd(12)}${estimateTokens(chars)}`
  );
  if (plan.totalFiles() > 0) {
    console.log(
      `    ${'files not read (no chunks counted)'.padEnd(62)}${plan.totalFiles()}`
    );
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(
    `\n${ANSI.bold}${ANSI.cyan}═══════════════════════════════════════════════════${ANSI.reset}`
  );
  console.log(
    `${ANSI.bold}  HAI.ai Full Reindex — ${EMBEDDING_MODEL} (${EMBEDDING_DIMS}d) — Paid Tier${ANSI.reset}`
  );
  console.log(
    `${ANSI.cyan}═══════════════════════════════════════════════════${ANSI.reset}`
  );
  console.log(
    `${ANSI.dim}  Target: ${OPTIONS.target}  Catalog: ${OPTIONS.catalogCode ?? 'all'}${ANSI.reset}`
  );
  if (IS_DRY_RUN)
    console.log(
      `${ANSI.yellow}  *** DRY RUN — no changes, no model call (add --apply for a real run) ***${ANSI.reset}`
    );
  if (IS_FORCE)
    console.log(
      `${ANSI.yellow}  Force mode: re-embedding ALL content${ANSI.reset}`
    );
  if (IS_PURGE)
    console.log(
      `${ANSI.red}  Will purge the existing embeddings of the catalog first${ANSI.reset}`
    );
  if (IS_PURGE_STALE)
    console.log(
      `${ANSI.yellow}  Will purge stale (pre-Gemini) embeddings of the catalog only${ANSI.reset}`
    );
  if (IS_PDFS_ONLY)
    console.log(
      `${ANSI.cyan}  PDFs only mode — skipping non-PDF content${ANSI.reset}`
    );
  console.log(
    `${ANSI.dim}  Progress: DB-based (any machine can resume)${ANSI.reset}`
  );
  console.log();

  // 1. Connect to the database (source data + embeddings target)
  const connStr =
    process.env.HAI_DB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;

  if (!connStr) {
    fail('HAI_DB_CONNECTION_STRING or DB_CONNECTION_STRING not set');
    process.exit(1);
  }

  const host = connectionHost(connStr);
  const db = postgres(connStr, {
    ssl: isLoopbackHost(host) ? false : 'require',
    max: 5,
  });

  // 2. The declared target must fit the connection BEFORE anything else
  //    happens (no count, no model call, no write)
  try {
    const [facts] = await db`
      SELECT current_schema() AS current_schema, current_user AS current_role
    `;
    const problems = checkTargetAgainstConnection(
      OPTIONS,
      {
        host,
        currentSchema: facts.current_schema,
        currentUser: facts.current_role,
      },
      { KFBM_ROLLOUT_APPROVED: SHELL_ROLLOUT_APPROVED }
    );
    if (problems.length > 0) {
      for (const problem of problems) fail(problem);
      fail('The target does not fit the connection. Nothing was done.');
      await db.end();
      process.exit(1);
    }
    ok(
      `Target ${OPTIONS.target} fits the connection (schema ${facts.current_schema}, role ${facts.current_role})`
    );
  } catch (e: any) {
    fail(`DB connection failed: ${e.message}`);
    process.exit(1);
  }

  // 3. The scope columns must exist (migration 20261027000100)
  try {
    const columns = await db`
      SELECT a.attname
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('hai_embeddings')
        AND a.attname IN ('training_catalog_id', 'visibility', 'organization_id')
        AND NOT a.attisdropped
    `;
    if (columns.length !== 3) {
      fail(
        'hai_embeddings has no training_catalog_id, visibility and organization_id yet (migration 20261027000100). Nothing was done.'
      );
      await db.end();
      process.exit(1);
    }
  } catch (e: any) {
    fail(`Column check failed: ${e.message}`);
    process.exit(1);
  }

  // 4. Catalogs (labels for the report) and the catalog of --catalog
  try {
    const catalogs = await db`SELECT id, code FROM training_catalogs`;
    for (const row of catalogs) CATALOG_CODES.set(String(row.id), row.code);
    if (OPTIONS.catalogCode) {
      const match = catalogs.find(
        row => String(row.code).toUpperCase() === OPTIONS.catalogCode
      );
      if (!match) {
        fail(
          `Catalog ${OPTIONS.catalogCode} does not exist. Nothing was done.`
        );
        await db.end();
        process.exit(1);
      }
      CATALOG_ID = String(match.id);
      ok(`Limited to catalog ${match.code}`);
    }
  } catch (e: any) {
    fail(`Catalog lookup failed: ${e.message}`);
    process.exit(1);
  }

  // 5. A real run needs the API key and a working model call. A dry run makes
  //    no model call at all.
  if (!IS_DRY_RUN) {
    if (REINDEX_PROVIDER === 'ollama') {
      let host = '';
      try {
        host = new URL(OLLAMA_BASE_URL).hostname;
      } catch {
        // an unreadable address is refused below
      }
      if (host !== 'localhost' && host !== '127.0.0.1') {
        fail(
          'OLLAMA_BASE_URL has to be this machine (localhost, the SSH tunnel to the Sokrates server). Nothing was done.'
        );
        await db.end();
        process.exit(1);
      }
      ok(`Embeddings by ${OLLAMA_MODEL} through ${OLLAMA_BASE_URL}`);
    } else if (!GEMINI_API_KEY) {
      fail('GEMINI_API_KEY not set. Add it to .env.local');
      await db.end();
      process.exit(1);
    } else {
      ok('Gemini API key found');
    }
    log(`Testing ${REINDEX_PROVIDER} embedding...`);
    try {
      const testEmb = await generateEmbedding(
        'Test embedding für HAI.ai Reindex'
      );
      ok(`Test OK: ${testEmb.length} dimensions`);
      if (testEmb.length !== EMBEDDING_DIMS) {
        warn(
          `Expected ${EMBEDDING_DIMS} dims but got ${testEmb.length} — check HAI_EMBEDDING_DIMENSIONS`
        );
      }
    } catch (e: any) {
      fail(`Gemini test failed: ${e.message}`);
      process.exit(1);
    }
  }

  try {
    const [{ now }] = await db`SELECT NOW() as now`;
    info(`DB time: ${now}`);

    const [{ count }] = await db`SELECT COUNT(*) as count FROM hai_embeddings`;
    info(`Existing embeddings: ${count}`);
  } catch (e: any) {
    fail(`DB connection failed: ${e.message}`);
    process.exit(1);
  }

  // 6. Purge if requested (of the catalog only; a dry run only counts)
  if (IS_PURGE) {
    await purgeAllEmbeddings(db);
  }
  if (IS_PURGE_STALE) {
    await purgeStaleEmbeddings(db);
  }

  // 7. Run indexers
  const startTime = Date.now();
  const startDate = new Date();

  type IndexResult = {
    indexed: number;
    skipped: number;
    failed: number;
    total: number;
    pages?: number;
  };
  const results: Record<string, IndexResult> = {};

  if (!IS_PDFS_ONLY) {
    results.courses = await indexCourses(db);
    results.enablers = await indexEnablers(db);
    results.useCases = await indexUseCases(db);
    results.quizzes = await indexQuizzes(db);
    results.lernfelder = await indexLernfelder(db);
    results.trainingComponents = await indexTrainingComponents(db);
  }

  results.pdfs = await indexPDFDocuments(db);

  // 6. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalIndexed = Object.values(results).reduce(
    (s, r) => s + r.indexed,
    0
  );
  const totalSkipped = Object.values(results).reduce(
    (s, r) => s + r.skipped,
    0
  );
  const totalFailed = Object.values(results).reduce((s, r) => s + r.failed, 0);
  const totalSources = Object.values(results).reduce((s, r) => s + r.total, 0);

  // DB stats
  let dbChunks = 0;
  let typeBreakdown: any[] = [];
  if (!IS_DRY_RUN) {
    const [{ count }] = await db`SELECT COUNT(*) as count FROM hai_embeddings`;
    dbChunks = Number(count);
    typeBreakdown = await db`
      SELECT source_type, COUNT(*) as cnt
      FROM hai_embeddings
      GROUP BY source_type
      ORDER BY cnt DESC
    `;
  }

  // Record job in DB for admin visibility
  if (!IS_DRY_RUN) {
    await recordReindexJob(
      db,
      totalFailed === 0 ? 'completed' : 'failed',
      {
        results,
        totalIndexed,
        totalSkipped,
        totalFailed,
        totalSources,
        dbChunks,
        apiCalls: _totalApiCalls,
        elapsedSeconds: parseFloat(elapsed),
        target: OPTIONS.target,
        catalog: OPTIONS.catalogCode,
      },
      totalFailed > 0 ? `${totalFailed} sources failed` : undefined,
      startDate
    ).catch(e => warn(`Failed to record job: ${e.message}`));
  }

  console.log(
    `\n${ANSI.bold}${ANSI.cyan}═══════════════════════════════════════════════════${ANSI.reset}`
  );
  console.log(
    `${ANSI.bold}  REINDEX ${IS_DRY_RUN ? '(DRY RUN) ' : ''}COMPLETE${ANSI.reset}`
  );
  console.log(
    `${ANSI.cyan}═══════════════════════════════════════════════════${ANSI.reset}`
  );
  console.log(`  Time:          ${elapsed}s`);
  console.log(`  Model:         ${EMBEDDING_MODEL} (${EMBEDDING_DIMS} dims)`);
  console.log(`  API calls:     ${_totalApiCalls}`);
  console.log(`  Target:        ${OPTIONS.target}`);
  console.log(`  Catalog:       ${OPTIONS.catalogCode ?? 'all'}`);
  console.log(`  Progress:      DB-based (cross-machine safe)`);
  console.log(`  Sources:       ${totalSources} total`);

  if (!IS_PDFS_ONLY) {
    console.log(
      `    Courses:     ${results.courses.total} (${results.courses.indexed} new, ${results.courses.skipped} unchanged)`
    );
    console.log(
      `    Enablers:    ${results.enablers.total} (${results.enablers.indexed} new, ${results.enablers.skipped} unchanged)`
    );
    console.log(
      `    Use Cases:   ${results.useCases.total} (${results.useCases.indexed} new, ${results.useCases.skipped} unchanged)`
    );
    console.log(
      `    Quizzes:     ${results.quizzes.total} (${results.quizzes.indexed} new, ${results.quizzes.skipped} unchanged)`
    );
    console.log(
      `    Lernfelder:  ${results.lernfelder.total} (${results.lernfelder.indexed} new, ${results.lernfelder.skipped} unchanged)`
    );
    console.log(
      `    Rahmenplan:  ${results.trainingComponents.total} (${results.trainingComponents.indexed} new, ${results.trainingComponents.skipped} unchanged)`
    );
  }
  console.log(
    `    PDFs:        ${results.pdfs.total} (${results.pdfs.indexed} new, ${results.pdfs.skipped} unchanged, ${results.pdfs.pages || 0} pages)`
  );
  console.log(
    `  Indexed:       ${ANSI.green}${totalIndexed}${ANSI.reset} sources`
  );
  console.log(
    `  Unchanged:     ${totalSkipped} sources (content hash match → skipped)`
  );
  console.log(
    `  Failed:        ${totalFailed > 0 ? ANSI.red : ANSI.green}${totalFailed}${ANSI.reset} sources`
  );
  if (IS_DRY_RUN) {
    console.log();
    printPlan(
      'Chunks the index holds after a real run (type, catalog, visibility):',
      PLAN_INVENTORY
    );
    console.log();
    printPlan('Of those, chunks a real run would embed now:', PLAN_CHANGES);
    console.log();
    printPlan(
      'Chunks with the same text that only change their scope (no embedding, no cost):',
      PLAN_RESCOPE
    );
    console.log();
    console.log(
      '  Cost estimate from the log of this run (no model call, no network):'
    );
    console.log(
      '    npx tsx scripts/hai-embedding-cost.ts --inventory logs/reindex-<time>.json [--runs 2]'
    );
    console.log(
      '  PDF files are priced from their pages: replace assumed numbers by measured ones.'
    );
  }
  if (!IS_DRY_RUN) {
    console.log(`  DB Chunks:     ${dbChunks} embeddings total`);
    if (typeBreakdown.length > 0) {
      console.log(`  By Type:`);
      for (const row of typeBreakdown) {
        console.log(`    ${row.source_type}: ${row.cnt} chunks`);
      }
    }
  }
  console.log();

  if (totalFailed > 0) {
    warn(
      `${totalFailed} sources failed. Re-run to retry (DB-based progress auto-skips completed):\n    npx tsx scripts/reindex-gemini.ts`
    );
  } else {
    ok('All sources indexed successfully.');
  }

  // ====================================================================
  // WRITE LOG FILE
  // ====================================================================
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const logFileName = `reindex-${ts}.json`;
  const logFilePath = path.join(logsDir, logFileName);

  const logData = {
    runAt: new Date().toISOString(),
    mode: IS_DRY_RUN ? 'dry-run' : IS_FORCE ? 'force' : 'incremental',
    target: OPTIONS.target,
    catalog: OPTIONS.catalogCode,
    plan: IS_DRY_RUN
      ? {
          inventory: PLAN_INVENTORY.rows(),
          changes: PLAN_CHANGES.rows(),
          rescope: PLAN_RESCOPE.rows(),
        }
      : undefined,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMS,
    elapsedSeconds: parseFloat(elapsed),
    apiCalls: _totalApiCalls,
    summary: {
      totalSources,
      totalIndexed,
      totalSkipped,
      totalFailed,
      dbChunks,
    },
    results,
    typeBreakdown: typeBreakdown.map((r: any) => ({
      sourceType: r.source_type,
      chunks: Number(r.cnt),
    })),
    entries: _logEntries,
  };

  writeFileSync(logFilePath, JSON.stringify(logData, null, 2), 'utf-8');
  ok(`Log saved → ${logFilePath}`);

  // Also write a human-readable text log
  const textLogPath = path.join(logsDir, `reindex-${ts}.log`);
  writeFileSync(textLogPath, _logMessages.join('\n') + '\n', 'utf-8');
  ok(`Text log saved → ${textLogPath}`);

  await db.end();
  process.exit(0);
}

main().catch(e => {
  fail(`Fatal error: ${e.message}`);
  console.error(e);
  process.exit(1);
});
