/**
 * HAI.ai Full Reindex Script — Gemini Paid Tier
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
 * Usage:
 *   npx tsx scripts/reindex-gemini.ts              # Fresh run (skips unchanged)
 *   npx tsx scripts/reindex-gemini.ts --force       # Re-embed everything
 *   npx tsx scripts/reindex-gemini.ts --purge       # Delete ALL embeddings first
 *   npx tsx scripts/reindex-gemini.ts --purge-stale  # Delete non-Gemini embeddings only
 *   npx tsx scripts/reindex-gemini.ts --dry-run     # Show what would be indexed
 *   npx tsx scripts/reindex-gemini.ts --pdfs-only   # Only index PDF documents
 */

import postgres from 'postgres';
import { createHash } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

// ============================================================================
// CONFIG
// ============================================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMS = parseInt(
  process.env.HAI_EMBEDDING_DIMENSIONS || '3072',
  10
);
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

// Paid tier: No rate limiting needed. Parallel requests supported.
const PARALLEL_EMBEDS = 5; // Send up to 5 parallel embedding requests
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const MAX_EMBED_CHARS = 4000;

// CLI flags
const IS_FORCE = process.argv.includes('--force');
const IS_PURGE = process.argv.includes('--purge');
const IS_PURGE_STALE = process.argv.includes('--purge-stale');
const IS_DRY_RUN = process.argv.includes('--dry-run');
const IS_PDFS_ONLY = process.argv.includes('--pdfs-only');

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
  chunks: { content: string; index: number }[]
): Promise<{ allMatch: boolean; existing: number }> {
  if (IS_FORCE) return { allMatch: false, existing: 0 };
  if (chunks.length === 0) return { allMatch: true, existing: 0 };

  // Get all existing chunks for this source
  const existing = await db`
    SELECT chunk_index, content_hash, metadata->>'embeddingModel' as model
    FROM hai_embeddings
    WHERE source_type = ${sourceType}
      AND source_id = ${sourceId}::uuid
  `;

  if (existing.length === 0) return { allMatch: false, existing: 0 };

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
    const ex = existingMap.get(chunk.index);
    if (ex && ex.hash === hash && ex.model === EMBEDDING_MODEL) {
      matchCount++;
    }
  }

  return {
    allMatch: matchCount === chunks.length && existing.length === chunks.length,
    existing: existing.length,
  };
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

async function upsertEmbedding(
  db: postgres.Sql,
  sourceType: string,
  sourceId: string,
  chunkIndex: number,
  content: string,
  embedding: number[],
  metadata: Record<string, unknown>
): Promise<void> {
  const contentHash = createHash('sha256').update(content).digest('hex');
  const embeddingStr = `[${embedding.join(',')}]`;
  const taggedMetadata = { ...metadata, embeddingModel: EMBEDDING_MODEL };

  await db`
    INSERT INTO hai_embeddings (
      id, source_type, source_id, chunk_index, content, content_hash, embedding, metadata
    ) VALUES (
      gen_random_uuid(),
      ${sourceType},
      ${sourceId}::uuid,
      ${chunkIndex},
      ${content},
      ${contentHash},
      ${embeddingStr}::vector,
      ${db.json(taggedMetadata)}
    )
    ON CONFLICT (source_type, source_id, chunk_index)
    DO UPDATE SET
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      embedding = EXCLUDED.embedding,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `;
}

// ============================================================================
// GENERIC SOURCE INDEXER (with DB-based skip detection)
// ============================================================================

async function indexSource(
  db: postgres.Sql,
  sourceType: string,
  sourceId: string,
  title: string,
  content: string,
  metadata: Record<string, unknown>
): Promise<{ success: boolean; chunks: number; skipped: boolean }> {
  const chunks = chunkText(content);
  if (chunks.length === 0) return { success: true, chunks: 0, skipped: true };

  // DB-based skip: check if all chunks already exist with matching hashes
  const { allMatch, existing } = await isSourceIndexed(
    db,
    sourceType,
    sourceId,
    chunks
  );

  if (allMatch) {
    return { success: true, chunks: existing, skipped: true };
  }

  if (IS_DRY_RUN) {
    info(
      `[DRY] Would index ${sourceType}/${title} → ${chunks.length} chunks (${existing} existing)`
    );
    return { success: true, chunks: chunks.length, skipped: false };
  }

  try {
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
        chunks[i].index,
        chunks[i].content,
        emb,
        { ...metadata, title }
      );
    }

    // Clean up stale chunks (if content was shortened)
    await db`
      DELETE FROM hai_embeddings
      WHERE source_type = ${sourceType}
        AND source_id = ${sourceId}::uuid
        AND chunk_index > ${chunks.length - 1}
    `;

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
    SELECT id, title, description
    FROM courses
    WHERE is_active = true
  `;

  let indexed = 0,
    skipped = 0,
    failed = 0;
  for (const row of rows) {
    const content = [
      `Kurs: ${row.title}`,
      row.description || 'Keine Beschreibung verfügbar.',
    ].join('\n\n');

    const result = await indexSource(db, 'course', row.id, row.title, content, {
      courseId: row.id,
    });

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
           c.title as course_title
    FROM enablers e
    LEFT JOIN courses c ON c.id = e.course_id
    WHERE e.is_active = true
  `;

  // Pre-load lernfeld mappings
  const lfMappings = await db`
    SELECT lm.enabler_id, lf.label, lf.title as lf_title
    FROM lernfeld_mappings lm
    JOIN lernfelder lf ON lf.id = lm.lernfeld_id
    WHERE lm.enabler_id IS NOT NULL
  `.catch(() => {
    warn('lernfeld_mappings not available — skipping LF enrichment');
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
    if (e.course_title) parts.push(`Kurs: ${e.course_title}`);
    if (e.description_text) parts.push(`Beschreibung: ${e.description_text}`);
    if (e.scenario_text) parts.push(`Szenario: ${e.scenario_text}`);
    if (e.hint_text) parts.push(`Hinweis: ${e.hint_text}`);
    if (e.scenarios && Array.isArray(e.scenarios)) {
      for (const s of e.scenarios) {
        if (s.text) parts.push(`Szenario: ${s.text}`);
        if (s.hint) parts.push(`Hinweis: ${s.hint}`);
      }
    }

    const lfs = enablerLfMap.get(e.id);
    if (lfs && lfs.length > 0) {
      const lfStr = lfs.map(l => `${l.label}: ${l.title}`).join(', ');
      parts.push(`Lernfelder: ${lfStr}`);
    }

    const content = parts.join('\n\n');
    if (content.length < 20) {
      skipped++;
      continue;
    }

    const metadata: Record<string, unknown> = {
      courseId: e.course_id,
      courseTitle: e.course_title,
      enablerTitle: e.title,
    };
    if (lfs) metadata.lernfelder = lfs.map(l => l.label);

    const result = await indexSource(
      db,
      'enabler',
      e.id,
      e.title,
      content,
      metadata
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
           c.title as course_title
    FROM use_cases uc
    LEFT JOIN courses c ON c.id = uc.course_id
    WHERE uc.is_active = true
  `;

  const lfMappings = await db`
    SELECT lm.use_case_id, lf.label, lf.title as lf_title
    FROM lernfeld_mappings lm
    JOIN lernfelder lf ON lf.id = lm.lernfeld_id
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
      metadata
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
      SELECT q.id, q.title, q.quiz_type,
             eql.enabler_id, eql.difficulty
      FROM quizzes q
      LEFT JOIN enabler_quiz_links eql ON eql.quiz_id = q.id
      WHERE q.is_active = true
    `;
  } catch {
    try {
      allQuizzes = await db`
        SELECT q.id, q.title, q.quiz_type,
               eq.enabler_id, NULL as difficulty
        FROM quizzes q
        LEFT JOIN enabler_quizzes eq ON eq.quiz_id = q.id
        WHERE q.is_active = true
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

    const parts: string[] = [];
    const typeLabel = quiz.quiz_type === 'GLOBAL' ? 'Global Quiz' : 'Quiz';
    const diffLabel = quiz.difficulty ? ` (${quiz.difficulty})` : '';
    parts.push(`${typeLabel}: ${quiz.title}${diffLabel}`);

    for (const q of questionsWithOptions) {
      parts.push(
        `\nFrage ${q.order_index ?? ''}: ${q.question_text} (${q.question_type})`
      );

      if (q.question_type === 'TEXT' && q.expected_answer) {
        parts.push(`  Erwartete Antwort: ${q.expected_answer}`);
      }

      if (q.options && Array.isArray(q.options)) {
        for (const opt of q.options) {
          if (!opt.text) continue;
          const marker = opt.correct ? '✓' : '✗';
          parts.push(`  ${marker} ${opt.text}`);
          if (opt.explanation) parts.push(`    Erklärung: ${opt.explanation}`);
        }
      }
    }

    const content = parts.filter(Boolean).join('\n');
    if (content.length < 20) {
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

    const result = await indexSource(
      db,
      'quiz',
      quiz.id,
      quiz.title,
      content,
      metadata
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
    lernfelder = await db`
      SELECT id, label, title, description
      FROM lernfelder
      ORDER BY label
    `;
  } catch {
    warn('lernfelder table not found — skipping');
    return { indexed: 0, skipped: 0, failed: 0, total: 0 };
  }

  if (lernfelder.length === 0) {
    warn('No Lernfelder found (table empty)');
    return { indexed: 0, skipped: 0, failed: 0, total: 0 };
  }

  const mappings = await db`
    SELECT lm.lernfeld_id,
           e.title as enabler_title,
           uc.title as use_case_title
    FROM lernfeld_mappings lm
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
      { lernfeldLabel: lfLabel }
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
    components = await db`
      SELECT tc.id, tc.code, tc.title, tc.description, tc.total_weeks, tc.total_hours,
             tc.training_year, tc.order_index
      FROM training_components tc
      ORDER BY tc.order_index
    `;
  } catch {
    warn('training_components table not found — skipping');
    return { indexed: 0, skipped: 0, failed: 0, total: 0 };
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
    parts.push(
      `Dauer: ${comp.total_weeks} Wochen / ${comp.total_hours} Stunden`
    );

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
      {
        componentCode: comp.code,
        trainingYear: comp.training_year,
        totalHours: comp.total_hours,
        useCaseCount: tucs.length,
      }
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
 * Extract text from a PDF URL
 */
async function extractPDFText(
  url: string
): Promise<{ text: string; pageCount: number } | null> {
  try {
    const pdfParse = require('pdf-parse/lib/pdf-parse');

    const response = await fetch(url);
    if (!response.ok) {
      warn(`Failed to fetch PDF: ${response.status} ${url}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
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
  log('📄 Indexing PDF Documents...');

  const docs = await db`
    SELECT cd.id, cd.title, cd.storage_url, cd.document_type,
           cd.enabler_id, cd.use_case_id, cd.course_id,
           cd.page_count, cd.is_indexed_by_hai,
           e.title as enabler_title,
           c.title as course_title,
           uc.title as use_case_title
    FROM content_documents cd
    LEFT JOIN enablers e ON e.id = cd.enabler_id
    LEFT JOIN courses c ON c.id = cd.course_id
    LEFT JOIN use_cases uc ON uc.id = cd.use_case_id
    ORDER BY cd.created_at
  `;

  if (docs.length === 0) {
    warn('No content_documents found');
    return { indexed: 0, skipped: 0, failed: 0, total: 0, pages: 0 };
  }

  log(`Found ${docs.length} PDF documents to process`);

  let indexed = 0,
    skipped = 0,
    failed = 0,
    totalPages = 0;

  for (let di = 0; di < docs.length; di++) {
    const doc = docs[di];
    const docLabel = `${doc.document_type} — ${doc.title}`;

    if (!doc.storage_url) {
      warn(`No storage URL for document: ${docLabel}`);
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

    // Build enriched content with document context
    const contextParts: string[] = [];
    if (doc.enabler_title) contextParts.push(`Enabler: ${doc.enabler_title}`);
    if (doc.course_title) contextParts.push(`Kurs: ${doc.course_title}`);
    if (doc.use_case_title)
      contextParts.push(`Use Case: ${doc.use_case_title}`);
    contextParts.push(`Dokumenttyp: ${doc.document_type}`);
    contextParts.push(`Dokument: ${doc.title}`);

    const fullContent = contextParts.join('\n') + '\n\n' + extraction.text;

    const metadata: Record<string, unknown> = {
      documentId: doc.id,
      documentTitle: doc.title,
      documentType: doc.document_type,
      pageCount: extraction.pageCount,
    };
    if (doc.enabler_id) metadata.enablerId = doc.enabler_id;
    if (doc.enabler_title) metadata.enablerTitle = doc.enabler_title;
    if (doc.course_id) metadata.courseId = doc.course_id;
    if (doc.course_title) metadata.courseTitle = doc.course_title;
    if (doc.use_case_id) metadata.useCaseId = doc.use_case_id;
    if (doc.use_case_title) metadata.useCaseTitle = doc.use_case_title;

    const result = await indexSource(
      db,
      'document',
      doc.id,
      doc.title,
      fullContent,
      metadata
    );

    if (result.skipped) {
      skipped++;
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'document',
        sourceId: doc.id,
        title: docLabel,
        status: 'skipped',
        chunks: result.chunks,
        pages: extraction.pageCount,
      });
    } else if (result.success) {
      indexed++;
      ok(
        `PDF: ${docLabel} (${result.chunks} chunks, ${extraction.pageCount} pages)`
      );
      addLogEntry({
        timestamp: new Date().toISOString(),
        sourceType: 'document',
        sourceId: doc.id,
        title: docLabel,
        status: 'indexed',
        chunks: result.chunks,
        pages: extraction.pageCount,
      });

      // Mark as indexed in content_documents table
      if (!IS_DRY_RUN) {
        await db`
          UPDATE content_documents 
          SET is_indexed_by_hai = true, 
              page_count = ${extraction.pageCount},
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
      log(`  PDF progress: ${di + 1}/${docs.length}...`);
    }
  }

  log(
    `PDFs done: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (${docs.length} docs, ${totalPages} pages total)`
  );
  return { indexed, skipped, failed, total: docs.length, pages: totalPages };
}

// ============================================================================
// PURGE FUNCTIONS
// ============================================================================

async function purgeAllEmbeddings(db: postgres.Sql) {
  log('🗑️  Purging ALL existing embeddings...');

  const [{ count }] = await db`SELECT COUNT(*) as count FROM hai_embeddings`;
  if (Number(count) === 0) {
    ok('No embeddings to purge (table is empty)');
    return;
  }

  const breakdown = await db`
    SELECT source_type, COUNT(*) as cnt
    FROM hai_embeddings
    GROUP BY source_type
    ORDER BY cnt DESC
  `;
  for (const row of breakdown) {
    info(`${row.source_type}: ${row.cnt} chunks`);
  }

  await db`DELETE FROM hai_embeddings`;
  ok(`Purged ${count} embedding chunks`);
}

async function purgeStaleEmbeddings(db: postgres.Sql) {
  log('🧹 Purging non-Gemini embeddings...');

  const [{ total_count }] = await db`
    SELECT COUNT(*) as total_count FROM hai_embeddings
  `;
  if (Number(total_count) === 0) {
    ok('No embeddings found — nothing to purge');
    return;
  }

  const modelBreakdown = await db`
    SELECT
      COALESCE(metadata->>'embeddingModel', '(untagged)') as model,
      COUNT(*) as cnt
    FROM hai_embeddings
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
    WHERE metadata->>'embeddingModel' IS NULL
       OR metadata->>'embeddingModel' != ${EMBEDDING_MODEL}
  `;
  const staleCount = Number(stale_count);

  if (staleCount === 0) {
    ok(
      `All ${total_count} embeddings are tagged with ${EMBEDDING_MODEL} — nothing to purge`
    );
    return;
  }

  await db`
    DELETE FROM hai_embeddings
    WHERE metadata->>'embeddingModel' IS NULL
       OR metadata->>'embeddingModel' != ${EMBEDDING_MODEL}
  `;
  ok(`Purged ${staleCount} non-Gemini embedding chunks`);
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
  if (IS_DRY_RUN)
    console.log(
      `${ANSI.yellow}  *** DRY RUN — no changes will be made ***${ANSI.reset}`
    );
  if (IS_FORCE)
    console.log(
      `${ANSI.yellow}  Force mode: re-embedding ALL content${ANSI.reset}`
    );
  if (IS_PURGE)
    console.log(
      `${ANSI.red}  Will purge all existing embeddings first${ANSI.reset}`
    );
  if (IS_PURGE_STALE)
    console.log(
      `${ANSI.yellow}  Will purge stale (pre-Gemini) embeddings only${ANSI.reset}`
    );
  if (IS_PDFS_ONLY)
    console.log(
      `${ANSI.cyan}  PDFs only mode — skipping non-PDF content${ANSI.reset}`
    );
  console.log(
    `${ANSI.dim}  Progress: DB-based (any machine can resume)${ANSI.reset}`
  );
  console.log();

  // 1. Verify API key
  if (!GEMINI_API_KEY) {
    fail('GEMINI_API_KEY not set. Add it to .env.local');
    process.exit(1);
  }
  ok('Gemini API key found');

  // 2. Test embedding generation
  if (!IS_DRY_RUN) {
    log('Testing Gemini embedding...');
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

  // 3. Connect to database (production = source data + embeddings target)
  const connStr =
    process.env.HAI_DB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;

  if (!connStr) {
    fail('HAI_DB_CONNECTION_STRING or DB_CONNECTION_STRING not set');
    process.exit(1);
  }

  const db = postgres(connStr, { ssl: 'require', max: 5 });
  ok('Connected to production DB (source + embeddings)');

  // Quick connection test
  try {
    const [{ now }] = await db`SELECT NOW() as now`;
    info(`DB time: ${now}`);

    const [{ count }] = await db`SELECT COUNT(*) as count FROM hai_embeddings`;
    info(`Existing embeddings: ${count}`);
  } catch (e: any) {
    fail(`DB connection failed: ${e.message}`);
    process.exit(1);
  }

  // 4. Purge if requested
  if (IS_PURGE && !IS_DRY_RUN) {
    await purgeAllEmbeddings(db);
  }
  if (IS_PURGE_STALE && !IS_DRY_RUN) {
    await purgeStaleEmbeddings(db);
  }

  // 5. Run indexers
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
