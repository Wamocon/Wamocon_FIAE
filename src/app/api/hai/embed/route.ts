/**
 * HAI.ai Embed API Route
 *
 * Endpoint for indexing content for RAG search.
 * Trainer-only access for content management.
 *
 * ARCHITECTURE (Hybrid RAG + PageIndex):
 *   - VECTOR DB: Structured DB text only (courses, enablers, quizzes, lernfelder)
 *   - PageIndex: PDFs accessed at query time (no embedding needed)
 *   - Live SQL: Trainee data fetched at query time via dataContext.ts
 *
 * This dramatically reduces embedding count and avoids Gemini rate limits.
 *
 * POST /api/hai/embed - Index content or start background job
 * GET /api/hai/embed  - Get indexing status or poll job progress
 * DELETE /api/hai/embed - Remove embeddings
 */

import { NextRequest, NextResponse } from 'next/server';
import haiDb from '@/db/haiDb';
import { eq, sql } from 'drizzle-orm';
import {
  enablers,
  courses,
  quizzes,
  questions,
  options,
  lernfelderSchema,
  lernfeldMappings,
} from '@/db/migrations/schemas/schema';
import { verifyTrainer } from '@/lib/auth-helpers';
import {
  indexContent,
  removeEmbeddings,
  getEmbeddingCount,
  getIndexedSources,
  SourceType,
} from '@/lib/hai';
import {
  createReindexJob,
  getJobStatus,
  getLatestJob,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  markJobCancelled,
  updateJobProgress,
  isCancellationRequested,
  requestCancellation,
  type ReindexProgress,
} from '@/lib/hai/reindexJob';

// ============================================================================
// TYPES
// ============================================================================

interface IndexRequestBody {
  action: 'index_enabler' | 'index_all' | 'reindex' | 'cancel_job';
  sourceType?: SourceType;
  sourceId?: string;
  forceReindex?: boolean;
  jobId?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Index a single enabler (synchronous — used for individual enabler indexing).
 * Only indexes TEXT content from the database — PDFs are handled by PageIndex at query time.
 */
async function indexEnabler(enablerId: string, forceReindex: boolean = false) {
  // Get enabler details
  const enabler = await haiDb
    .select({
      id: enablers.id,
      title: enablers.title,
      descriptionText: enablers.descriptionText,
      courseId: enablers.courseId,
    })
    .from(enablers)
    .where(eq(enablers.id, enablerId))
    .limit(1);

  if (enabler.length === 0) {
    return {
      success: false,
      error: 'Enabler not found',
      chunksIndexed: 0,
      chunksSkipped: 0,
      chunksFailed: 0,
    };
  }

  const e = enabler[0];

  // Combine all text content (DB text only — no PDF extraction)
  const contentParts: string[] = [];
  if (e.descriptionText) contentParts.push(e.descriptionText);

  const content = contentParts.join('\n\n');

  if (!content.trim()) {
    return {
      success: true,
      message: 'No text content to index',
      chunksIndexed: 0,
      chunksSkipped: 0,
      chunksFailed: 0,
    };
  }

  // Get course title for metadata
  let courseTitle: string | undefined;
  if (e.courseId) {
    const course = await haiDb
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, e.courseId))
      .limit(1);
    courseTitle = course[0]?.title || undefined;
  }

  // Index the enabler text only
  const result = await indexContent({
    sourceType: 'enabler',
    sourceId: e.id,
    title: e.title,
    content,
    metadata: { courseId: e.courseId, courseTitle },
    forceReindex,
  });

  return {
    ...result,
    chunksIndexed: result.chunksIndexed,
    chunksSkipped: result.chunksSkipped,
    chunksFailed: result.chunksFailed,
  };
}

// ============================================================================
// BACKGROUND JOB: Index All Content
// ============================================================================

/**
 * Run the full reindex as a background job.
 * Called via setTimeout(0) so the HTTP response returns immediately.
 *
 * HYBRID ARCHITECTURE — Only indexes structured DB text:
 *   1. Courses (titles, metadata)
 *   2. Enablers (text content only — no PDFs)
 *   3. Quizzes (questions + answers for learning content)
 *   4. Lernfelder (learning field definitions + mappings)
 *
 * PDFs are handled by PageIndex at query time (no embedding needed).
 * Trainee data is handled by dataContext.ts at query time (live SQL).
 *
 * Progress is written to hai_reindex_jobs table and polled by the UI.
 */
async function runBackgroundReindex(
  jobId: string,
  forceReindex: boolean
): Promise<void> {
  const progress: ReindexProgress = {
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

  try {
    await markJobRunning(jobId);

    // --- Count total sources (DB text only) ---
    const allCourses = await haiDb
      .select({
        id: courses.id,
        title: courses.title,
        year: courses.year,
        chapter: courses.chapter,
      })
      .from(courses)
      .where(eq(courses.isActive, true));

    const allEnablers = await haiDb
      .select({ id: enablers.id, title: enablers.title })
      .from(enablers)
      .where(eq(enablers.isActive, true));

    const allQuizzes = await haiDb
      .select({ id: quizzes.id, title: quizzes.title })
      .from(quizzes)
      .where(eq(quizzes.isActive, true));

    // Lernfelder table may not exist on all environments — check first
    let allLernfelder: Array<{
      id: string;
      label: string;
      title: string;
      description: string | null;
    }> = [];
    try {
      const tableCheck = await haiDb.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'lernfelder_schema'
        ) as exists
      `);
      const tableExists =
        (tableCheck as any)?.[0]?.exists === true ||
        (tableCheck as any)?.rows?.[0]?.exists === true;
      if (tableExists) {
        allLernfelder = await haiDb
          .select({
            id: lernfelderSchema.id,
            label: lernfelderSchema.label,
            title: lernfelderSchema.title,
            description: lernfelderSchema.description,
          })
          .from(lernfelderSchema);
      } else {
        console.log(
          'HAI.ai: lernfelder_schema table not found — skipping lernfelder indexing'
        );
      }
    } catch (lfError) {
      console.warn(
        'HAI.ai: Failed to query lernfelder_schema (skipping):',
        lfError
      );
    }

    progress.totalSources =
      allCourses.length +
      allEnablers.length +
      allQuizzes.length +
      allLernfelder.length;
    await updateJobProgress(jobId, { totalSources: progress.totalSources });

    // ==========================================
    // 1. INDEX COURSES
    // ==========================================
    for (const course of allCourses) {
      if (await isCancellationRequested(jobId)) {
        await markJobCancelled(jobId, progress);
        return;
      }

      progress.currentSource = `Kurs: ${course.title}`;
      await updateJobProgress(jobId, { currentSource: progress.currentSource });

      try {
        const courseText = `# Kurs: ${course.title}\nJahr: ${course.year}\nKapitel: ${course.chapter}`;
        const result = await indexContent({
          sourceType: 'course',
          sourceId: course.id,
          title: course.title,
          content: courseText,
          metadata: {
            courseId: course.id,
            year: course.year,
            chapter: course.chapter,
          },
          forceReindex,
        });
        if (result.success || result.chunksIndexed > 0) {
          progress.totalChunksIndexed += result.chunksIndexed;
          progress.totalChunksSkipped += result.chunksSkipped;
        } else if (result.error) {
          progress.failedSources++;
          progress.errors.push(`Kurs "${course.title}": ${result.error}`);
        }
      } catch (error) {
        progress.failedSources++;
        progress.errors.push(
          `Kurs "${course.title}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      progress.processedSources++;
      await updateJobProgress(jobId, {
        processedSources: progress.processedSources,
        totalChunksIndexed: progress.totalChunksIndexed,
        totalChunksSkipped: progress.totalChunksSkipped,
        failedSources: progress.failedSources,
        errors: progress.errors,
      });
    }

    // ==========================================
    // 2. INDEX ENABLERS (text only — PDFs via PageIndex)
    // ==========================================
    for (const e of allEnablers) {
      if (await isCancellationRequested(jobId)) {
        await markJobCancelled(jobId, progress);
        return;
      }

      progress.currentSource = `Enabler: ${e.title}`;
      await updateJobProgress(jobId, { currentSource: progress.currentSource });

      try {
        const result = await indexEnabler(e.id, forceReindex);
        if (result.success) {
          progress.enablersProcessed++;
          progress.totalChunksIndexed += result.chunksIndexed;
          progress.totalChunksSkipped += result.chunksSkipped;
        } else {
          progress.failedSources++;
          const errorMsg =
            'error' in result
              ? result.error
              : (result as any).message || 'Unknown error';
          progress.errors.push(`Enabler "${e.title}": ${errorMsg}`);
        }
      } catch (error) {
        progress.failedSources++;
        progress.errors.push(
          `Enabler "${e.title}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      progress.processedSources++;
      await updateJobProgress(jobId, {
        processedSources: progress.processedSources,
        enablersProcessed: progress.enablersProcessed,
        totalChunksIndexed: progress.totalChunksIndexed,
        totalChunksSkipped: progress.totalChunksSkipped,
        failedSources: progress.failedSources,
        errors: progress.errors,
      });
    }

    // ==========================================
    // 3. INDEX QUIZZES (questions + answers)
    // ==========================================
    for (const quiz of allQuizzes) {
      if (await isCancellationRequested(jobId)) {
        await markJobCancelled(jobId, progress);
        return;
      }

      progress.currentSource = `Quiz: ${quiz.title}`;
      await updateJobProgress(jobId, { currentSource: progress.currentSource });

      try {
        // Fetch questions with their options
        const quizQuestions = await haiDb
          .select({
            id: questions.id,
            questionText: questions.questionText,
            questionType: questions.questionType,
            expectedAnswer: questions.expectedAnswer,
            orderIndex: questions.orderIndex,
          })
          .from(questions)
          .where(eq(questions.quizId, quiz.id))
          .orderBy(questions.orderIndex);

        if (quizQuestions.length > 0) {
          const contentParts: string[] = [`# Quiz: ${quiz.title}`, ``];

          for (const q of quizQuestions) {
            const qNum = (q.orderIndex ?? 0) + 1;
            contentParts.push(`## Frage ${qNum}: ${q.questionText}`);

            if (q.questionType === 'MCQ') {
              // Get options for MCQ questions
              const qOptions = await haiDb
                .select({
                  optionText: options.optionText,
                  isCorrect: options.isCorrect,
                  explanation: options.explanation,
                })
                .from(options)
                .where(eq(options.questionId, q.id));

              for (const opt of qOptions) {
                const marker = opt.isCorrect ? '✓' : '✗';
                contentParts.push(`  ${marker} ${opt.optionText}`);
                if (opt.explanation) {
                  contentParts.push(`    Erklärung: ${opt.explanation}`);
                }
              }
            } else if (q.expectedAnswer) {
              contentParts.push(`  Erwartete Antwort: ${q.expectedAnswer}`);
            }
            contentParts.push(``);
          }

          const quizContent = contentParts.join('\n');
          const result = await indexContent({
            sourceType: 'quiz' as SourceType,
            sourceId: quiz.id,
            title: quiz.title,
            content: quizContent,
            metadata: { quizId: quiz.id, questionCount: quizQuestions.length },
            forceReindex,
          });
          progress.totalChunksIndexed += result.chunksIndexed;
          progress.totalChunksSkipped += result.chunksSkipped;
          if (result.chunksFailed > 0) {
            progress.failedSources++;
            progress.errors.push(
              `Quiz "${quiz.title}": ${result.chunksFailed} chunk(s) failed`
            );
          }
        }
      } catch (error) {
        progress.failedSources++;
        progress.errors.push(
          `Quiz "${quiz.title}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      progress.processedSources++;
      await updateJobProgress(jobId, {
        processedSources: progress.processedSources,
        totalChunksIndexed: progress.totalChunksIndexed,
        totalChunksSkipped: progress.totalChunksSkipped,
        failedSources: progress.failedSources,
        errors: progress.errors,
      });
    }

    // ==========================================
    // 4. INDEX LERNFELDER (learning fields)
    // ==========================================
    for (const lf of allLernfelder) {
      if (await isCancellationRequested(jobId)) {
        await markJobCancelled(jobId, progress);
        return;
      }

      progress.currentSource = `Lernfeld: ${lf.label} - ${lf.title}`;
      await updateJobProgress(jobId, { currentSource: progress.currentSource });

      try {
        const contentParts: string[] = [
          `# Lernfeld ${lf.label}: ${lf.title}`,
          ``,
        ];
        if (lf.description) contentParts.push(lf.description);

        // Get mapped enablers and use cases
        const mappings = await haiDb
          .select({
            enablerId: lernfeldMappings.enablerId,
            useCaseId: lernfeldMappings.useCaseId,
          })
          .from(lernfeldMappings)
          .where(eq(lernfeldMappings.lernfeldId, lf.id));

        if (mappings.length > 0) {
          const enablerMappings = mappings.filter(m => m.enablerId);
          const useCaseMappings = mappings.filter(m => m.useCaseId);
          if (enablerMappings.length > 0) {
            contentParts.push(
              `\nVerknüpfte Enabler: ${enablerMappings.length}`
            );
          }
          if (useCaseMappings.length > 0) {
            contentParts.push(
              `Verknüpfte Use Cases: ${useCaseMappings.length}`
            );
          }
        }

        const lfContent = contentParts.join('\n');
        if (lfContent.trim().length > 10) {
          const result = await indexContent({
            sourceType: 'enabler' as SourceType,
            sourceId: lf.id,
            title: `Lernfeld ${lf.label}: ${lf.title}`,
            content: lfContent,
            metadata: {
              type: 'lernfeld',
              label: lf.label,
            },
            forceReindex,
          });
          progress.totalChunksIndexed += result.chunksIndexed;
          progress.totalChunksSkipped += result.chunksSkipped;
        }
      } catch (error) {
        progress.failedSources++;
        progress.errors.push(
          `Lernfeld "${lf.label}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      progress.processedSources++;
      await updateJobProgress(jobId, {
        processedSources: progress.processedSources,
        totalChunksIndexed: progress.totalChunksIndexed,
        totalChunksSkipped: progress.totalChunksSkipped,
        failedSources: progress.failedSources,
        errors: progress.errors,
      });
    }

    // --- Done ---
    progress.currentSource = null;
    await markJobCompleted(jobId, progress);

    console.log(
      `HAI.ai: Reindex job ${jobId} completed (Hybrid mode — DB text only). ` +
      `${allCourses.length} courses, ${progress.enablersProcessed} enablers, ` +
      `${allQuizzes.length} quizzes, ${allLernfelder.length} lernfelder, ` +
      `${progress.totalChunksIndexed} chunks indexed, ${progress.totalChunksSkipped} skipped, ` +
      `${progress.failedSources} failures. ` +
      `PDFs handled by PageIndex at query time.`
    );
  } catch (error) {
    progress.currentSource = null;
    const errorMsg =
      error instanceof Error ? error.message : 'Unknown fatal error';
    await markJobFailed(jobId, errorMsg, progress);
    console.error(`HAI.ai: Reindex job ${jobId} FAILED:`, error);
  }
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * POST - Index content or manage jobs
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert.' },
        { status: 401 }
      );
    }

    // Verify trainer access
    const isTrainer = await verifyTrainer(userId);
    if (!isTrainer) {
      return NextResponse.json(
        { error: 'Nur Trainer können Inhalte indexieren.' },
        { status: 403 }
      );
    }

    const body: IndexRequestBody = await req.json();
    const { action, sourceType, sourceId, forceReindex = false } = body;

    switch (action) {
      case 'index_enabler': {
        if (!sourceId) {
          return NextResponse.json(
            { error: 'sourceId required' },
            { status: 400 }
          );
        }
        const result = await indexEnabler(sourceId, forceReindex);
        return NextResponse.json({ success: true, result });
      }

      case 'index_all': {
        // Create background job and return immediately
        const { jobId, error } = await createReindexJob(forceReindex);
        if (error) {
          return NextResponse.json({ error }, { status: 409 });
        }

        // Start background processing (non-blocking)
        // Using setTimeout(0) to return the HTTP response immediately
        // The job runs in the Node.js event loop after the response is sent.
        setTimeout(() => {
          runBackgroundReindex(jobId, forceReindex).catch(err => {
            console.error(`HAI.ai: Background reindex fatal error:`, err);
            markJobFailed(jobId, err.message || 'Fatal background error', {
              totalSources: 0,
              processedSources: 0,
              totalChunksIndexed: 0,
              totalChunksSkipped: 0,
              failedSources: 0,
              errors: [err.message || 'Fatal error'],
              currentSource: null,
              enablersProcessed: 0,
              documentsProcessed: 0,
            });
          });
        }, 0);

        return NextResponse.json({
          success: true,
          jobId,
          message:
            'Reindex-Job gestartet. Überprüfen Sie den Fortschritt über GET /api/hai/embed?jobId=xxx',
        });
      }

      case 'reindex': {
        if (!sourceType || !sourceId) {
          return NextResponse.json(
            { error: 'sourceType and sourceId required' },
            { status: 400 }
          );
        }

        // For single-source reindex, use UPSERT (no pre-delete needed)
        if (sourceType === 'enabler') {
          const result = await indexEnabler(sourceId, true);
          return NextResponse.json({ success: true, result });
        }

        // For explicit removal (non-enabler)
        await removeEmbeddings(sourceType, sourceId);
        return NextResponse.json({
          success: true,
          message: 'Embeddings removed',
        });
      }

      case 'cancel_job': {
        const cancelled = await requestCancellation();
        return NextResponse.json({
          success: cancelled,
          message: cancelled
            ? 'Abbruch angefordert. Der Job wird beim nächsten Quellenwechsel gestoppt.'
            : 'Kein aktiver Job zum Abbrechen.',
        });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('HAI.ai embed error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten.' },
      { status: 500 }
    );
  }
}

/**
 * GET - Get indexing status or poll job progress
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const jobId = searchParams.get('jobId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Verify trainer access
    const isTrainer = await verifyTrainer(userId);
    if (!isTrainer) {
      return NextResponse.json(
        { error: 'Nur Trainer können den Indexstatus sehen.' },
        { status: 403 }
      );
    }

    // If jobId provided, return that job's status
    if (jobId) {
      const job = await getJobStatus(jobId);
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, job });
    }

    // Otherwise, return general stats + latest job
    const totalCount = await getEmbeddingCount();
    const indexedSources = await getIndexedSources();

    const enablerCount = await getEmbeddingCount('enabler');
    const courseCount = await getEmbeddingCount('course');
    const quizCount = await getEmbeddingCount('quiz' as SourceType);

    // Legacy counts (may still have old embeddings until cleaned up)
    const documentCount = await getEmbeddingCount('document');
    const useCaseCount = await getEmbeddingCount('use_case' as SourceType);

    const latestJob = await getLatestJob();

    return NextResponse.json({
      success: true,
      stats: {
        totalEmbeddings: totalCount,
        architecture: 'hybrid', // Indicates Hybrid RAG + PageIndex mode
        byType: {
          enabler: enablerCount,
          course: courseCount,
          quiz: quizCount,
          // Legacy (will be 0 after cleanup)
          document: documentCount,
          use_case: useCaseCount,
        },
        indexedSources: indexedSources.slice(0, 50),
        info: 'PDFs are now handled by PageIndex at query time. Trainee data is fetched live via dataContext.',
      },
      latestJob,
    });
  } catch (error) {
    console.error('HAI.ai embed status error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove embeddings
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const sourceType = searchParams.get('sourceType') as SourceType;
    const sourceId = searchParams.get('sourceId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 401 });
    }

    // Verify trainer access
    const isTrainer = await verifyTrainer(userId);
    if (!isTrainer) {
      return NextResponse.json(
        { error: 'Nur Trainer können Embeddings löschen.' },
        { status: 403 }
      );
    }

    if (!sourceType || !sourceId) {
      return NextResponse.json(
        { error: 'sourceType and sourceId required' },
        { status: 400 }
      );
    }

    const success = await removeEmbeddings(sourceType, sourceId);

    return NextResponse.json({
      success,
      message: success
        ? 'Embeddings erfolgreich gelöscht.'
        : 'Fehler beim Löschen.',
    });
  } catch (error) {
    console.error('HAI.ai delete embeddings error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
