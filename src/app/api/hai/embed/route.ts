/**
 * HAI.ai Embed API Route
 * 
 * Endpoint for indexing content for RAG search.
 * Trainer-only access for content management.
 * 
 * POST /api/hai/embed - Index content
 * GET /api/hai/embed - Get indexing status
 * DELETE /api/hai/embed - Remove embeddings
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import {
    profiles,
    enablers,
    courses,
    contentDocuments,
    haiEmbeddings
} from '@/db/migrations/schemas/schema';
import {
    indexContent,
    indexContentBatch,
    removeEmbeddings,
    getEmbeddingCount,
    getIndexedSources,
    SourceType
} from '@/lib/hai';
import { extractTextFromPDF } from '@/lib/hai/pdfExtractor';

// ============================================================================
// TYPES
// ============================================================================

interface IndexRequestBody {
    action: 'index_enabler' | 'index_course' | 'index_document' | 'index_all' | 'reindex';
    sourceType?: SourceType;
    sourceId?: string;
    forceReindex?: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Verify user is a trainer
 */
async function verifyTrainer(userId: string): Promise<boolean> {
    const user = await db
        .select({ role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

    return user.length > 0 && user[0].role === 'TRAINER';
}

/**
 * Index a single enabler
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
        return { success: false, error: 'Enabler not found', chunksIndexed: 0, chunksSkipped: 0 };
    }

    const e = enabler[0];

    // Combine all text content
    const contentParts: string[] = [];
    if (e.descriptionText) contentParts.push(e.descriptionText);
    if (e.scenarioText) contentParts.push(`Szenario: ${e.scenarioText}`);
    if (e.hintText) contentParts.push(`Hinweis: ${e.hintText}`);

    const content = contentParts.join('\n\n');

    if (!content.trim()) {
        return { success: true, message: 'No text content to index', chunksIndexed: 0, chunksSkipped: 0 };
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

    // Index the content
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
            fileName: contentDocuments.fileName
        })
        .from(contentDocuments)
        .where(eq(contentDocuments.enablerId, enablerId));

    // Aggregate stats from multiple PDF indexings + Enabler Text
    let totalIndexed = result.chunksIndexed;
    let totalSkipped = result.chunksSkipped;

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
                            mimeType: 'application/pdf'
                        },
                        forceReindex,
                    });
                    totalIndexed += docResult.chunksIndexed;
                    totalSkipped += docResult.chunksSkipped;
                }
            } catch (error) {
                console.error(`HAI.ai: Error indexing PDF ${doc.id}:`, error);
            }
        }
    }


    return { ...result, chunksIndexed: totalIndexed, chunksSkipped: totalSkipped };
}

/**
 * Index all content in the system
 */
async function indexAllContent(forceReindex: boolean = false) {
    const results = {
        enablersProcessed: 0,
        documentsProcessed: 0,
        totalChunksIndexed: 0,
        totalChunksSkipped: 0,
        errors: [] as string[],
    };

    // Get all active enablers
    const allEnablers = await db
        .select({ id: enablers.id })
        .from(enablers)
        .where(eq(enablers.isActive, true));

    for (const e of allEnablers) {
        try {
            const result = await indexEnabler(e.id, forceReindex);
            if (result.success) {
                results.enablersProcessed++;
                results.totalChunksIndexed += result.chunksIndexed;
                results.totalChunksSkipped += result.chunksSkipped;
            } else {
                // Check if error property exists
                const errorMsg = 'error' in result ? result.error : (result as any).message || 'Unknown error';
                results.errors.push(`Enabler ${e.id}: ${errorMsg}`);
            }
        } catch (error) {
            results.errors.push(`Enabler ${e.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Get all standalone documents
    const standaloneDocuments = await db
        .select({
            id: contentDocuments.id,
            title: contentDocuments.title,
            storageUrl: contentDocuments.storageUrl,
            fileName: contentDocuments.fileName
        })
        .from(contentDocuments)
        .where(sql`enabler_id IS NULL AND use_case_id IS NULL`);

    for (const doc of standaloneDocuments) {
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
                            mimeType: 'application/pdf'
                        }
                    });
                    results.documentsProcessed++;
                    results.totalChunksIndexed += result.chunksIndexed;
                    results.totalChunksSkipped += result.chunksSkipped;
                }
            } catch (error) {
                results.errors.push(`Document ${doc.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }

    return results;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * POST - Index content
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
                    return NextResponse.json({ error: 'sourceId required' }, { status: 400 });
                }
                const result = await indexEnabler(sourceId, forceReindex);
                return NextResponse.json({ success: true, result });
            }

            case 'index_all': {
                const result = await indexAllContent(forceReindex);
                return NextResponse.json({ success: true, result });
            }

            case 'reindex': {
                if (!sourceType || !sourceId) {
                    return NextResponse.json({ error: 'sourceType and sourceId required' }, { status: 400 });
                }

                // Remove existing embeddings
                await removeEmbeddings(sourceType, sourceId);

                // Re-index based on type
                if (sourceType === 'enabler') {
                    const result = await indexEnabler(sourceId, true);
                    return NextResponse.json({ success: true, result });
                }

                return NextResponse.json({ success: true, message: 'Embeddings removed' });
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
 * GET - Get indexing status
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');

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

        // Get embedding statistics
        const totalCount = await getEmbeddingCount();
        const indexedSources = await getIndexedSources();

        // Get counts by type
        const enablerCount = await getEmbeddingCount('enabler');
        const documentCount = await getEmbeddingCount('document');
        const courseCount = await getEmbeddingCount('course');

        return NextResponse.json({
            success: true,
            stats: {
                totalEmbeddings: totalCount,
                byType: {
                    enabler: enablerCount,
                    document: documentCount,
                    course: courseCount,
                },
                indexedSources: indexedSources.slice(0, 50), // Limit to 50 for response size
            },
        });
    } catch (error) {
        console.error('HAI.ai embed status error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
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
            message: success ? 'Embeddings erfolgreich gelöscht.' : 'Fehler beim Löschen.',
        });
    } catch (error) {
        console.error('HAI.ai delete embeddings error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}