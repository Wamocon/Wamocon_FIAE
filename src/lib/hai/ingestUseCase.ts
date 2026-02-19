/**
 * HAI.ai Use Case Ingestion Service
 *
 * Processes Use Case PDFs (TRAINER_SOLUTION documents) for HAI learning.
 * Uses PageIndex strategy: embeds each page separately for deterministic citations.
 *
 * Key Features:
 * - Per-page extraction from Trainer PDFs
 * - Page-level embeddings with metadata
 * - Enables HAI to cite "Page X" in responses
 * - Only processes TRAINER_SOLUTION documents (contains answers)
 *
 * @module lib/hai/ingestUseCase
 */

import { createHash } from 'crypto';
import { getEmbeddingProvider } from './providers';
import { extractTextByPage, PerPageExtractionResult } from './pdfExtractor';
import { chunkDocument } from './chunker';
import haiDb from '@/db/haiDb';
import {
  haiEmbeddings,
  contentDocuments,
  useCases,
} from '@/db/migrations/schemas/schema';
import { eq, and, sql } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export interface UseCaseIngestionResult {
  success: boolean;
  useCaseId: string;
  documentId: string;
  pagesProcessed: number;
  chunksIndexed: number;
  chunksSkipped: number;
  chunksFailed: number;
  error?: string;
}

export interface BatchIngestionResult {
  totalUseCases: number;
  successfulUseCases: number;
  failedUseCases: number;
  totalPages: number;
  totalChunks: number;
  errors: string[];
}

interface UseCaseDocumentRow {
  useCaseId: string;
  useCaseTitle: string;
  documentId: string;
  documentTitle: string;
  storageUrl: string;
  documentType: string;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

const EMBEDDING_RATE_LIMIT_MS = 700; // ms between embedding calls
let _lastEmbeddingCall = 0;

async function rateLimitedWait(): Promise<void> {
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

function generateContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a page chunk already exists with same content hash
 */
async function pageChunkExists(
  sourceId: string,
  pageNumber: number,
  chunkIndex: number,
  contentHash: string
): Promise<boolean> {
  try {
    const result = await haiDb.execute(sql`
            SELECT 1 FROM hai_embeddings 
            WHERE source_type = 'use_case'
              AND source_id = ${sourceId}::uuid
              AND metadata->>'page' = ${String(pageNumber)}
              AND chunk_index = ${chunkIndex}
              AND content_hash = ${contentHash}
            LIMIT 1
        `);
    return (result as any[]).length > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// MAIN INGESTION FUNCTIONS
// ============================================================================

/**
 * Ingest a single Use Case's TRAINER_SOLUTION document into HAI embeddings.
 * Uses per-page extraction for PageIndex citations.
 *
 * @param useCaseId - The use case ID
 * @param documentId - The content_documents ID (TRAINER_SOLUTION)
 * @param forceReindex - Force re-embedding even if content hash matches
 */
export async function ingestUseCaseDocument(
  useCaseId: string,
  documentId: string,
  forceReindex: boolean = false,
  onProgress?: (current: number, total: number, status: string) => void
): Promise<UseCaseIngestionResult> {
  const result: UseCaseIngestionResult = {
    success: false,
    useCaseId,
    documentId,
    pagesProcessed: 0,
    chunksIndexed: 0,
    chunksSkipped: 0,
    chunksFailed: 0,
  };

  try {
    // 1. Fetch document and use case info (always from production via haiDb)
    const [docRow] = await haiDb
      .select({
        id: contentDocuments.id,
        title: contentDocuments.title,
        storageUrl: contentDocuments.storageUrl,
        documentType: contentDocuments.documentType,
        useCaseId: contentDocuments.useCaseId,
      })
      .from(contentDocuments)
      .where(eq(contentDocuments.id, documentId as any))
      .limit(1);

    if (!docRow) {
      result.error = `Document not found: ${documentId}`;
      return result;
    }

    // Only process TRAINER_SOLUTION documents
    if (docRow.documentType !== 'TRAINER_SOLUTION') {
      result.error = `Document is not TRAINER_SOLUTION type: ${docRow.documentType}`;
      return result;
    }

    const [useCaseRow] = await haiDb
      .select({ title: useCases.title })
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any))
      .limit(1);

    const useCaseTitle = useCaseRow?.title || 'Unknown Use Case';

    onProgress?.(0, 100, `Extracting PDF pages from ${docRow.title}...`);

    // 2. Extract text per page
    const extraction: PerPageExtractionResult = await extractTextByPage(
      docRow.storageUrl
    );

    if (!extraction.success || extraction.pages.length === 0) {
      result.error = extraction.error || 'No pages extracted from PDF';
      return result;
    }

    onProgress?.(
      10,
      100,
      `Extracted ${extraction.totalPages} pages, generating embeddings...`
    );

    // 3. Get embedding provider
    const embeddingProvider = getEmbeddingProvider();
    if (!embeddingProvider.isInitialized()) {
      result.error = 'Embedding provider not initialized';
      return result;
    }

    // 4. Process each page
    const totalPages = extraction.pages.length;

    for (let pageIdx = 0; pageIdx < extraction.pages.length; pageIdx++) {
      const page = extraction.pages[pageIdx];

      // Skip empty pages
      if (!page.text || page.text.trim().length < 10) {
        continue;
      }

      result.pagesProcessed++;

      // Chunk the page content (pages can be long)
      // chunkDocument(content, title, options) returns TextChunk[]
      const pageTitle = `${useCaseTitle} - Seite ${page.page}`;
      const chunks = chunkDocument(page.text, pageTitle, {
        maxChunkSize: 800,
        overlap: 100,
      });

      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const chunkText = chunk.content;
        const contentHash = generateContentHash(chunkText);

        // Check if already indexed (skip if not forcing)
        if (!forceReindex) {
          const exists = await pageChunkExists(
            useCaseId,
            page.page,
            chunkIdx,
            contentHash
          );
          if (exists) {
            result.chunksSkipped++;
            continue;
          }
        }

        try {
          // Rate limiting
          await rateLimitedWait();

          // Generate embedding
          const embeddingResult =
            await embeddingProvider.generateEmbedding(chunkText);
          const embeddingVector = JSON.stringify(embeddingResult.embedding);

          // Prepare metadata with PageIndex info
          const metadata = {
            page: page.page,
            totalPages: extraction.totalPages,
            documentId: documentId,
            documentTitle: docRow.title,
            useCaseTitle: useCaseTitle,
            documentType: 'TRAINER_SOLUTION',
            chunkOfPage: chunkIdx,
            totalChunksInPage: chunks.length,
          };

          // Upsert embedding
          await haiDb.execute(sql`
                        INSERT INTO hai_embeddings (
                            source_type, source_id, chunk_index, content, content_hash, embedding, metadata
                        ) VALUES (
                            'use_case',
                            ${useCaseId}::uuid,
                            ${page.page * 1000 + chunkIdx},
                            ${chunkText},
                            ${contentHash},
                            ${embeddingVector}::vector,
                            ${metadata}::jsonb
                        )
                        ON CONFLICT (source_type, source_id, chunk_index) 
                        DO UPDATE SET
                            content = EXCLUDED.content,
                            content_hash = EXCLUDED.content_hash,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata,
                            updated_at = NOW()
                    `);

          result.chunksIndexed++;
        } catch (chunkError) {
          console.error(
            `Failed to embed chunk ${chunkIdx} of page ${page.page}:`,
            chunkError
          );
          result.chunksFailed++;
        }
      }

      // Progress update
      const progressPercent = Math.round(10 + (pageIdx / totalPages) * 90);
      onProgress?.(
        progressPercent,
        100,
        `Processed page ${page.page}/${totalPages}`
      );
    }

    // 5. Update document status (production DB)
    await haiDb
      .update(contentDocuments)
      .set({
        isIndexedByHai: true,
        pageCount: extraction.totalPages,
      })
      .where(eq(contentDocuments.id, documentId as any));

    result.success = true;
    onProgress?.(100, 100, 'Ingestion complete');

    return result;
  } catch (error) {
    console.error('HAI.ai: Error ingesting use case document:', error);
    result.error = error instanceof Error ? error.message : 'Unknown error';
    return result;
  }
}

/**
 * Ingest all TRAINER_SOLUTION documents for all use cases.
 * Used for bulk HAI learning.
 */
export async function ingestAllUseCases(
  forceReindex: boolean = false,
  onProgress?: (current: number, total: number, status: string) => void
): Promise<BatchIngestionResult> {
  const result: BatchIngestionResult = {
    totalUseCases: 0,
    successfulUseCases: 0,
    failedUseCases: 0,
    totalPages: 0,
    totalChunks: 0,
    errors: [],
  };

  try {
    // Find all TRAINER_SOLUTION documents linked to use cases (always from production)
    const docs = await haiDb
      .select({
        useCaseId: contentDocuments.useCaseId,
        useCaseTitle: useCases.title,
        documentId: contentDocuments.id,
        documentTitle: contentDocuments.title,
        storageUrl: contentDocuments.storageUrl,
        documentType: contentDocuments.documentType,
      })
      .from(contentDocuments)
      .innerJoin(useCases, eq(contentDocuments.useCaseId, useCases.id))
      .where(
        and(
          eq(contentDocuments.documentType as any, 'TRAINER_SOLUTION'),
          sql`${contentDocuments.useCaseId} IS NOT NULL`
        )
      );

    result.totalUseCases = docs.length;

    if (docs.length === 0) {
      onProgress?.(100, 100, 'No TRAINER_SOLUTION documents found');
      return result;
    }

    onProgress?.(
      0,
      docs.length,
      `Found ${docs.length} use case documents to process`
    );

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i] as UseCaseDocumentRow;

      onProgress?.(i, docs.length, `Processing: ${doc.useCaseTitle}`);

      const ingestionResult = await ingestUseCaseDocument(
        doc.useCaseId!,
        doc.documentId,
        forceReindex
      );

      if (ingestionResult.success) {
        result.successfulUseCases++;
        result.totalPages += ingestionResult.pagesProcessed;
        result.totalChunks += ingestionResult.chunksIndexed;
      } else {
        result.failedUseCases++;
        result.errors.push(`${doc.useCaseTitle}: ${ingestionResult.error}`);
      }
    }

    onProgress?.(docs.length, docs.length, 'Batch ingestion complete');
    return result;
  } catch (error) {
    console.error('HAI.ai: Error in batch use case ingestion:', error);
    result.errors.push(
      error instanceof Error ? error.message : 'Unknown error'
    );
    return result;
  }
}

/**
 * Delete all embeddings for a specific use case.
 * Used when a use case is deleted or needs full re-indexing.
 */
export async function deleteUseCaseEmbeddings(
  useCaseId: string
): Promise<{ deleted: number }> {
  try {
    const result = await haiDb.execute(sql`
            DELETE FROM hai_embeddings 
            WHERE source_type = 'use_case' AND source_id = ${useCaseId}::uuid
        `);

    return { deleted: (result as any).rowCount || 0 };
  } catch (error) {
    console.error('HAI.ai: Error deleting use case embeddings:', error);
    return { deleted: 0 };
  }
}

/**
 * Get ingestion status for a use case document.
 */
export async function getUseCaseIngestionStatus(useCaseId: string): Promise<{
  isIndexed: boolean;
  chunksCount: number;
  pagesCount: number;
  lastUpdated: Date | null;
}> {
  try {
    const result = await haiDb.execute(sql`
            SELECT 
                COUNT(*) as chunks_count,
                COUNT(DISTINCT (metadata->>'page')::int) as pages_count,
                MAX(updated_at) as last_updated
            FROM hai_embeddings 
            WHERE source_type = 'use_case' AND source_id = ${useCaseId}::uuid
        `);

    const row = (result as any[])[0];
    return {
      isIndexed: (row?.chunks_count || 0) > 0,
      chunksCount: parseInt(row?.chunks_count || '0', 10),
      pagesCount: parseInt(row?.pages_count || '0', 10),
      lastUpdated: row?.last_updated ? new Date(row.last_updated) : null,
    };
  } catch (error) {
    return {
      isIndexed: false,
      chunksCount: 0,
      pagesCount: 0,
      lastUpdated: null,
    };
  }
}
