/**
 * HAI.ai Embed API Route
 *
 * Endpoint for indexing content for RAG search.
 * Trainer-only access for content management.
 *
 * CHANGES (Phase 0C — Bulletproof Reindex):
 *   - index_all now runs as a background job (non-blocking)
 *   - GET supports job status polling via ?jobId=xxx
 *   - Progress is tracked in hai_reindex_jobs table
 *   - Cancellation support via POST { action: 'cancel_job' }
 *
 * POST /api/hai/embed - Index content or start background job
 * GET /api/hai/embed  - Get indexing status or poll job progress
 * DELETE /api/hai/embed - Remove embeddings
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, sql } from 'drizzle-orm';
import {
  enablers,
  courses,
  contentDocuments,
} from '@/db/migrations/schemas/schema';
import { verifyTrainer } from '@/lib/auth-helpers';
import {
  indexContent,
  removeEmbeddings,
  getEmbeddingCount,
  getIndexedSources,
  SourceType,
} from '@/lib/hai';
import { extractTextFromPDF } from '@/lib/hai/pdfExtractor';
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
 */
async function indexEnabler(enablerId: string, forceReindex: boolean = false) {
  // Get enabler details
  const enabler = await db
    .select({
      id: enablers.id,
      title: enablers.title,
      descriptionText: enablers.descriptionText,
      scenarioText: enablers.scenarioText,
      hintText: enablers.hintText,
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

  // Combine all text content
  const contentParts: string[] = [];
  if (e.descriptionText) contentParts.push(e.descriptionText);
  if (e.scenarioText) contentParts.push(`Szenario: ${e.scenarioText}`);
  if (e.hintText) contentParts.push(`Hinweis: ${e.hintText}`);

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
    const course = await db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, e.courseId))
      .limit(1);
    courseTitle = course[0]?.title || undefined;
  }

  // Index the enabler text
  const result = await indexContent({
    sourceType: 'enabler',
    sourceId: e.id,
    title: e.title,
    content,
    metadata: { courseId: e.courseId, courseTitle },
    forceReindex,
  });

  // Also index associated PDFs
  const documents = await db
    .select({
      id: contentDocuments.id,
      title: contentDocuments.title,
      storageUrl: contentDocuments.storageUrl,
      fileName: contentDocuments.fileName,
    })
    .from(contentDocuments)
    .where(eq(contentDocuments.enablerId, enablerId));

  let totalIndexed = result.chunksIndexed;
  let totalSkipped = result.chunksSkipped;
  let totalFailed = result.chunksFailed;

  for (const doc of documents) {
    if (doc.storageUrl) {
      try {
        const pdfResult = await extractTextFromPDF(doc.storageUrl);
        if (pdfResult.success && pdfResult.text) {
          const docResult = await indexContent({
            sourceType: 'document',
            sourceId: doc.id,
            title: doc.title || doc.fileName || 'PDF Document',
            content: pdfResult.text,
            metadata: {
              enablerId,
              enablerTitle: e.title,
              courseId: e.courseId,
              ...pdfResult.metadata,
              fileName: doc.fileName,
              storageUrl: doc.storageUrl,
              mimeType: 'application/pdf',
            },
            forceReindex,
          });
          totalIndexed += docResult.chunksIndexed;
          totalSkipped += docResult.chunksSkipped;
          totalFailed += docResult.chunksFailed;
        }
      } catch (error) {
        console.error(`HAI.ai: Error indexing PDF ${doc.id}:`, error);
        totalFailed++;
      }
    }
  }

  return {
    ...result,
    chunksIndexed: totalIndexed,
    chunksSkipped: totalSkipped,
    chunksFailed: totalFailed,
  };
}

// ============================================================================
// BACKGROUND JOB: Index All Content
// ============================================================================

/**
 * Run the full reindex as a background job.
 * Called via setTimeout(0) so the HTTP response returns immediately.
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

    // --- Count total sources ---
    const allEnablers = await db
      .select({ id: enablers.id, title: enablers.title })
      .from(enablers)
      .where(eq(enablers.isActive, true));

    const standaloneDocuments = await db
      .select({
        id: contentDocuments.id,
        title: contentDocuments.title,
        storageUrl: contentDocuments.storageUrl,
        fileName: contentDocuments.fileName,
      })
      .from(contentDocuments)
      .where(sql`enabler_id IS NULL AND use_case_id IS NULL`);

    progress.totalSources = allEnablers.length + standaloneDocuments.length;
    await updateJobProgress(jobId, { totalSources: progress.totalSources });

    // --- Process Enablers ---
    for (const e of allEnablers) {
      if (isCancellationRequested()) {
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

    // --- Process Standalone Documents ---
    for (const doc of standaloneDocuments) {
      if (isCancellationRequested()) {
        await markJobCancelled(jobId, progress);
        return;
      }

      const docName = doc.title || doc.fileName || doc.id;
      progress.currentSource = `Dokument: ${docName}`;
      await updateJobProgress(jobId, { currentSource: progress.currentSource });

      if (doc.storageUrl) {
        try {
          const pdfResult = await extractTextFromPDF(doc.storageUrl);
          if (pdfResult.success && pdfResult.text) {
            const result = await indexContent({
              sourceType: 'document',
              sourceId: doc.id,
              title: doc.title || doc.fileName || 'PDF Document',
              content: pdfResult.text,
              forceReindex,
              metadata: {
                ...pdfResult.metadata,
                fileName: doc.fileName,
                storageUrl: doc.storageUrl,
                mimeType: 'application/pdf',
              },
            });
            progress.documentsProcessed++;
            progress.totalChunksIndexed += result.chunksIndexed;
            progress.totalChunksSkipped += result.chunksSkipped;
          }
        } catch (error) {
          progress.failedSources++;
          progress.errors.push(
            `Dokument "${docName}": ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      progress.processedSources++;
      await updateJobProgress(jobId, {
        processedSources: progress.processedSources,
        documentsProcessed: progress.documentsProcessed,
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
      `HAI.ai: Reindex job ${jobId} completed. ` +
        `${progress.enablersProcessed} enablers, ${progress.documentsProcessed} docs, ` +
        `${progress.totalChunksIndexed} chunks indexed, ${progress.totalChunksSkipped} skipped, ` +
        `${progress.failedSources} failures.`
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
        const cancelled = requestCancellation();
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
    const documentCount = await getEmbeddingCount('document');
    const courseCount = await getEmbeddingCount('course');

    const latestJob = await getLatestJob();

    return NextResponse.json({
      success: true,
      stats: {
        totalEmbeddings: totalCount,
        byType: {
          enabler: enablerCount,
          document: documentCount,
          course: courseCount,
        },
        indexedSources: indexedSources.slice(0, 50),
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
