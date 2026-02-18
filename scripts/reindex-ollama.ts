/**
 * Standalone Reindex Script (Ollama)
 *
 * Directly indexes all DB content using Ollama embeddings.
 * No auth needed — runs as a standalone script.
 *
 * Usage: npx tsx scripts/reindex-ollama.ts
 */

import postgres from 'postgres';
import { createHash } from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

// ============================================================================
// CONFIG
// ============================================================================

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL =
  process.env.HAI_OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const EMBEDDING_DIMS = parseInt(
  process.env.HAI_EMBEDDING_DIMENSIONS || '768',
  10
);
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(msg: string) {
  console.log(`${ANSI.cyan}[reindex]${ANSI.reset} ${msg}`);
}

function ok(msg: string) {
  console.log(`${ANSI.green}✓${ANSI.reset} ${msg}`);
}

function warn(msg: string) {
  console.log(`${ANSI.yellow}⚠${ANSI.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${ANSI.red}✗${ANSI.reset} ${msg}`);
}

// ============================================================================
// OLLAMA EMBEDDING
// ============================================================================

// nomic-embed-text has 8192 token context; German ≈ 2.5 chars/token → safe limit 4000 chars
const MAX_EMBED_CHARS = 4000;

function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_EMBED_CHARS) return text;
  return text.slice(0, MAX_EMBED_CHARS) + '…';
}

async function generateEmbeddingsBatch(
  texts: string[],
  retries = 3
): Promise<number[][]> {
  try {
    // Truncate any text that exceeds model context window
    const safetexts = texts.map(t => truncateForEmbedding(t));
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, input: safetexts }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama batch embed failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    return data.embeddings;
  } catch (e: any) {
    if (
      retries > 0 &&
      (e.message?.includes('fetch failed') ||
        e.message?.includes('ECONNRESET') ||
        e.name === 'TimeoutError')
    ) {
      const delay = (4 - retries) * 2000;
      warn(
        `  Ollama connection issue, retrying in ${delay}ms... (${retries} left)`
      );
      await new Promise(r => setTimeout(r, delay));
      return generateEmbeddingsBatch(texts, retries - 1);
    }
    throw e;
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const result = await generateEmbeddingsBatch([text]);
  return result[0];
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
// UPSERT EMBEDDING
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
      ${JSON.stringify(metadata)}::jsonb
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
// INDEX FUNCTIONS
// ============================================================================

async function indexSource(
  db: postgres.Sql,
  sourceType: string,
  sourceId: string,
  title: string,
  content: string,
  metadata: Record<string, unknown>
): Promise<{ success: boolean; chunks: number }> {
  const chunks = chunkText(content);
  if (chunks.length === 0) return { success: true, chunks: 0 };

  try {
    const texts = chunks.map(c => c.content);
    const embeddings = await generateEmbeddingsBatch(texts);

    for (let i = 0; i < chunks.length; i++) {
      await upsertEmbedding(
        db,
        sourceType,
        sourceId,
        chunks[i].index,
        chunks[i].content,
        embeddings[i],
        { ...metadata, title }
      );
    }

    // Clean up stale chunks
    await db`
      DELETE FROM hai_embeddings
      WHERE source_type = ${sourceType}
        AND source_id = ${sourceId}::uuid
        AND chunk_index > ${chunks.length - 1}
    `;

    return { success: true, chunks: chunks.length };
  } catch (e: any) {
    fail(`  ${sourceType}/${title}: ${e.message}`);
    return { success: false, chunks: 0 };
  }
}

async function indexCourses(db: postgres.Sql) {
  log('Indexing courses...');
  const allCourses = await db`
    SELECT id, title, description FROM courses WHERE is_active = true
  `;

  let indexed = 0,
    failed = 0;
  for (const course of allCourses) {
    const content = `Kurs: ${course.title}\n\n${course.description || 'Keine Beschreibung verfügbar.'}`;
    const result = await indexSource(
      db,
      'course',
      course.id,
      course.title,
      content,
      { courseId: course.id }
    );
    if (result.success) indexed++;
    else failed++;
  }
  ok(
    `  Courses: ${indexed} indexed, ${failed} failed (${allCourses.length} total)`
  );
  return { indexed, failed, total: allCourses.length };
}

async function indexEnablers(db: postgres.Sql) {
  log('Indexing enablers (text only, PDFs via PageIndex)...');
  const allEnablers = await db`
    SELECT id, title, description_text, scenario_text, course_id 
    FROM enablers WHERE is_active = true
  `;

  let indexed = 0,
    failed = 0,
    skipped = 0;
  for (const e of allEnablers) {
    const parts: string[] = [`Enabler: ${e.title}`];
    if (e.description_text) parts.push(`Beschreibung: ${e.description_text}`);
    if (e.scenario_text) parts.push(`Szenario: ${e.scenario_text}`);
    const content = parts.join('\n\n');

    if (content.length < 20) {
      skipped++;
      continue;
    }

    const result = await indexSource(db, 'enabler', e.id, e.title, content, {
      courseId: e.course_id,
      enablerTitle: e.title,
    });
    if (result.success) indexed++;
    else failed++;
  }
  ok(
    `  Enablers: ${indexed} indexed, ${skipped} skipped, ${failed} failed (${allEnablers.length} total)`
  );
  return { indexed, failed, total: allEnablers.length };
}

async function indexQuizzes(db: postgres.Sql) {
  log('Indexing quizzes with questions & answers...');
  const allQuizzes = await db`
    SELECT q.id, q.title, q.quiz_type,
           eql.enabler_id
    FROM quizzes q
    LEFT JOIN enabler_quiz_links eql ON eql.quiz_id = q.id
    WHERE q.is_active = true
  `;

  let indexed = 0,
    failed = 0;
  for (let qi = 0; qi < allQuizzes.length; qi++) {
    const quiz = allQuizzes[qi];

    const questionsWithOptions = await db`
      SELECT 
        q.id, q.question_text, q.question_type, q.order_index,
        json_agg(json_build_object(
          'text', o.option_text,
          'correct', o.is_correct,
          'explanation', o.explanation
        )) as options
      FROM questions q
      LEFT JOIN options o ON o.question_id = q.id
      WHERE q.quiz_id = ${quiz.id}
      GROUP BY q.id, q.question_text, q.question_type, q.order_index
      ORDER BY q.order_index
    `;

    const parts: string[] = [
      `Quiz: ${quiz.title} (${quiz.quiz_type || 'standard'})`,
    ];

    for (const q of questionsWithOptions) {
      parts.push(
        `\nFrage ${q.order_index}: ${q.question_text} (${q.question_type})`
      );
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
    if (content.length < 20) continue;

    const result = await indexSource(db, 'quiz', quiz.id, quiz.title, content, {
      enablerId: quiz.enabler_id,
      quizTitle: quiz.title,
      questionCount: questionsWithOptions.length,
    });
    if (result.success) indexed++;
    else failed++;

    if ((qi + 1) % 50 === 0 || qi === allQuizzes.length - 1) {
      log(`  Progress: ${qi + 1}/${allQuizzes.length} quizzes...`);
    }
  }
  ok(
    `  Quizzes: ${indexed} indexed, ${failed} failed (${allQuizzes.length} total)`
  );
  return { indexed, failed, total: allQuizzes.length };
}

async function indexLernfelder(db: postgres.Sql) {
  log('Checking Lernfelder...');
  try {
    // Check if table exists first
    const tableCheck = await db`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'lernfelder_schema'
      ) as exists
    `;
    if (!tableCheck[0]?.exists) {
      warn('  lernfelder_schema table does not exist on this DB');
      return { indexed: 0, failed: 0, total: 0 };
    }

    const lernfelder =
      await db`SELECT id, title, description FROM lernfelder_schema`;
    if (lernfelder.length === 0) {
      warn('  No Lernfelder found in DB (table empty)');
      return { indexed: 0, failed: 0, total: 0 };
    }

    let indexed = 0,
      failed = 0;
    for (const lf of lernfelder) {
      const content = `Lernfeld: ${lf.title}\n\n${lf.description || ''}`;
      const result = await indexSource(
        db,
        'document',
        lf.id,
        lf.title,
        content,
        {}
      );
      if (result.success) indexed++;
      else failed++;
    }
    ok(`  Lernfelder: ${indexed} indexed, ${failed} failed`);
    return { indexed, failed, total: lernfelder.length };
  } catch (e: any) {
    warn(`  Lernfelder skipped: ${e.message}`);
    return { indexed: 0, failed: 0, total: 0 };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(
    `\n${ANSI.bold}${ANSI.cyan}═══════════════════════════════════════════${ANSI.reset}`
  );
  console.log(
    `${ANSI.bold}  HAI.ai Reindex — Ollama ${OLLAMA_MODEL}${ANSI.reset}`
  );
  console.log(
    `${ANSI.cyan}═══════════════════════════════════════════${ANSI.reset}\n`
  );

  // 1. Verify Ollama
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    const data = await res.json();
    const models = (data.models || []).map((m: any) => m.name);
    ok(`Ollama running. Models: ${models.join(', ')}`);
    if (!models.some((n: string) => n.startsWith(OLLAMA_MODEL))) {
      fail(
        `Model "${OLLAMA_MODEL}" not found. Run: ollama pull ${OLLAMA_MODEL}`
      );
      process.exit(1);
    }
  } catch (e: any) {
    fail(`Cannot connect to Ollama at ${OLLAMA_BASE_URL}: ${e.message}`);
    fail('Start Ollama with: ollama serve');
    process.exit(1);
  }

  // 2. Test embedding
  log('Testing embedding generation...');
  const testEmb = await generateEmbedding('Test embedding für HAI.ai');
  ok(`Test embedding: ${testEmb.length} dimensions`);

  // 3. Connect to DB
  const connStr =
    process.env.HAI_DB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
  if (!connStr) {
    fail(
      'No DB connection string. Set HAI_DB_CONNECTION_STRING or DB_CONNECTION_STRING'
    );
    process.exit(1);
  }

  const db = postgres(connStr, { ssl: 'require', max: 3 });
  log('Connected to DB');

  const startTime = Date.now();

  // 4. Run indexing
  const courseResult = await indexCourses(db);
  const enablerResult = await indexEnablers(db);
  const quizResult = await indexQuizzes(db);
  const lernfeldResult = await indexLernfelder(db);

  // 5. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalIndexed =
    courseResult.indexed +
    enablerResult.indexed +
    quizResult.indexed +
    lernfeldResult.indexed;
  const totalFailed =
    courseResult.failed +
    enablerResult.failed +
    quizResult.failed +
    lernfeldResult.failed;

  const [{ count }] = await db`SELECT COUNT(*) as count FROM hai_embeddings`;
  const typeBreakdown = await db`
    SELECT source_type, COUNT(*) as cnt FROM hai_embeddings GROUP BY source_type ORDER BY cnt DESC
  `;

  console.log(
    `\n${ANSI.bold}${ANSI.cyan}═══════════════════════════════════════════${ANSI.reset}`
  );
  console.log(`${ANSI.bold}  REINDEX COMPLETE${ANSI.reset}`);
  console.log(
    `${ANSI.cyan}═══════════════════════════════════════════${ANSI.reset}`
  );
  console.log(`  Time:        ${elapsed}s`);
  console.log(`  Model:       ${OLLAMA_MODEL} (${testEmb.length} dims)`);
  console.log(
    `  Indexed:     ${ANSI.green}${totalIndexed}${ANSI.reset} sources`
  );
  console.log(
    `  Failed:      ${totalFailed > 0 ? ANSI.red : ANSI.green}${totalFailed}${ANSI.reset} sources`
  );
  console.log(`  DB Chunks:   ${count} embeddings total`);
  console.log(`  By Type:`);
  for (const row of typeBreakdown) {
    console.log(`    ${row.source_type}: ${row.cnt} chunks`);
  }
  console.log(
    `  Sources:     Courses=${courseResult.indexed}/${courseResult.total}, Enablers=${enablerResult.indexed}/${enablerResult.total}, Quizzes=${quizResult.indexed}/${quizResult.total}, Lernfelder=${lernfeldResult.indexed}/${lernfeldResult.total}`
  );
  console.log();

  await db.end();
  process.exit(0);
}

main().catch(e => {
  fail(`Fatal error: ${e.message}`);
  console.error(e);
  process.exit(1);
});
