/**
 * HAI.ai PageIndex Service — Query-Time PDF Retrieval
 *
 * Instead of embedding PDFs into vectors (expensive, rate-limited),
 * this service fetches and extracts PDF text at QUERY TIME.
 *
 * Architecture:
 *   1. User asks a question
 *   2. Vector search finds relevant enablers/courses/quizzes (text-only embeddings)
 *   3. PageIndex identifies relevant PDFs based on vector results + query context
 *   4. Relevant PDF pages are extracted on-the-fly from Supabase Storage
 *   5. Combined context (vectors + PDF pages) is sent to LLM
 *
 * Benefits:
 *   - No embedding needed for PDFs → dramatically fewer Gemini API calls
 *   - PDFs are always up-to-date (no stale embeddings)
 *   - Scales with new PDFs automatically
 *   - Uses existing Supabase Storage (no extra hosting cost)
 *
 * @module lib/hai/pageIndexService
 */

import haiDb from '@/db/haiDb';
import { sql, type SQL } from 'drizzle-orm';
import {
  extractTextByPage,
  type PerPageExtractionResult,
} from './pdfExtractor';
import { isUuid, type HaiAudience, type SearchResult } from './vectorSearch';
import {
  isMetadataAllowedForTrainingScope,
  type HaiTrainingScope,
} from './trainingScope';

// ============================================================================
// TYPES
// ============================================================================

export interface PageIndexResult {
  documentId: string;
  documentTitle: string;
  fileName: string;
  storageUrl: string;
  /** Visibility ALL and not a trainer solution: may be linked in a citation */
  visibleToTrainees: boolean;
  /** Parent entity (enabler, use_case, or standalone) */
  parentType: 'enabler' | 'use_case' | 'standalone';
  parentId: string | null;
  parentTitle: string | null;
  /** Extracted page content */
  pages: PageContent[];
  /** Total pages in PDF */
  totalPages: number;
}

export interface PageContent {
  pageNumber: number;
  text: string;
  /** Relevance score based on keyword matching (0-1) */
  relevanceScore: number;
}

export interface PageIndexContext {
  /** Formatted text context from PDFs for LLM injection */
  pdfContext: string;
  /** Number of documents scanned */
  documentsScanned: number;
  /** Number of relevant pages found */
  relevantPages: number;
  /** Citations for the UI */
  citations: PageIndexCitation[];
}

export interface PageIndexCitation {
  documentId: string;
  documentTitle: string;
  fileName: string;
  pageNumber: number;
  /**
   * Public URL of the PDF. Only set if the document is visible to trainees
   * (visibility ALL, not a trainer solution): the bucket is public, so a URL
   * in a citation would open a solution without any sign-in.
   */
  storageUrl?: string;
  relevanceScore: number;
}

/** What a PageIndex query may read. Built from the session by the pipeline. */
export interface PageIndexOptions {
  currentEnablerId?: string;
  currentCourseId?: string;
  trainingScope?: HaiTrainingScope;
  /** Catalogs (occupations) the caller may read. Empty: no PDF (fail closed). */
  catalogIds: string[];
  /** Only 'trainer' gets solution and trainer-only documents. */
  audience: HaiAudience;
  /** Own organization and platform documents (NULL) only. */
  organizationId?: string | null;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Maximum number of PDFs to fetch per query */
const MAX_PDFS_PER_QUERY = 5;

/** Maximum number of relevant pages to include in context */
const MAX_PAGES_IN_CONTEXT = 8;

/** Minimum relevance score for a page to be included (0-1) */
const MIN_PAGE_RELEVANCE = 0.15;

/** Maximum character limit per page to include in context */
const MAX_CHARS_PER_PAGE = 3000;

// In-memory PDF text cache (avoids re-fetching the same PDF within short timeframe)
const _pdfCache = new Map<
  string,
  { pages: PerPageExtractionResult; timestamp: number }
>();
const PDF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Fetch relevant PDF context for a user query.
 *
 * Strategy:
 *   1. Identify candidate PDFs based on vector search results (enabler/course context)
 *   2. Extract pages from those PDFs
 *   3. Score pages by keyword relevance to the query
 *   4. Return top-K most relevant pages as formatted context
 *
 * @param userQuery - The user's question
 * @param vectorResults - Results from vector search (used to identify related PDFs)
 * @param options - Additional context (current enabler, course, etc.)
 */
export async function fetchPageIndexContext(
  userQuery: string,
  vectorResults: SearchResult[],
  options: PageIndexOptions
): Promise<PageIndexContext> {
  const startTime = Date.now();

  try {
    // Step 1: Find candidate PDFs
    const candidatePDFs = await findCandidatePDFs(vectorResults, options);

    if (candidatePDFs.length === 0) {
      return {
        pdfContext: '',
        documentsScanned: 0,
        relevantPages: 0,
        citations: [],
      };
    }

    // Step 2: Extract pages from candidate PDFs (with caching)
    const pdfResults: PageIndexResult[] = [];
    const candidatesToScan = candidatePDFs.slice(0, MAX_PDFS_PER_QUERY);

    // Scan PDFs in parallel to reduce total latency
    await Promise.all(
      candidatesToScan.map(async pdf => {
        try {
          const pages = await extractPDFPages(pdf.storageUrl);
          if (pages && pages.success && pages.pages.length > 0) {
            // Step 3: Score pages by relevance
            const scoredPages = scorePagesByRelevance(
              pages.pages.map(p => ({
                pageNumber: p.page,
                text: p.text,
                charCount: p.charCount,
              })),
              userQuery,
              vectorResults
            );

            pdfResults.push({
              documentId: pdf.id,
              documentTitle: pdf.title,
              fileName: pdf.fileName,
              storageUrl: pdf.storageUrl,
              visibleToTrainees: pdf.visibleToTrainees,
              parentType: pdf.parentType,
              parentId: pdf.parentId,
              parentTitle: pdf.parentTitle,
              pages: scoredPages,
              totalPages: pages.totalPages,
            });
          }
        } catch (err) {
          console.warn(
            `HAI.ai PageIndex: Failed to extract ${pdf.fileName}:`,
            err
          );
        }
      })
    );

    // Step 4: Collect best pages across all PDFs
    const allPages: (PageContent & {
      docId: string;
      docTitle: string;
      fileName: string;
      storageUrl: string;
      visibleToTrainees: boolean;
    })[] = [];

    for (const result of pdfResults) {
      for (const page of result.pages) {
        if (page.relevanceScore >= MIN_PAGE_RELEVANCE) {
          allPages.push({
            ...page,
            docId: result.documentId,
            docTitle: result.documentTitle,
            fileName: result.fileName,
            storageUrl: result.storageUrl,
            visibleToTrainees: result.visibleToTrainees,
          });
        }
      }
    }

    // Sort by relevance and take top-K
    allPages.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topPages = allPages.slice(0, MAX_PAGES_IN_CONTEXT);

    // Step 5: Format as context string
    const pdfContext = formatPDFContext(topPages);

    // Step 6: Build citations
    const citations: PageIndexCitation[] = topPages.map(p => ({
      documentId: p.docId,
      documentTitle: p.docTitle,
      fileName: p.fileName,
      pageNumber: p.pageNumber,
      // no URL for a document that trainees may not see (public bucket)
      storageUrl: p.visibleToTrainees ? p.storageUrl : undefined,
      relevanceScore: p.relevanceScore,
    }));

    const elapsed = Date.now() - startTime;
    console.log(
      `HAI.ai PageIndex: ${pdfResults.length} PDFs scanned, ${topPages.length} pages selected in ${elapsed}ms`
    );

    return {
      pdfContext,
      documentsScanned: pdfResults.length,
      relevantPages: topPages.length,
      citations,
    };
  } catch (error) {
    console.error('HAI.ai PageIndex error:', error);
    return {
      pdfContext: '',
      documentsScanned: 0,
      relevantPages: 0,
      citations: [],
    };
  }
}

// ============================================================================
// CANDIDATE PDF SELECTION
// ============================================================================

interface CandidatePDF {
  id: string;
  title: string;
  fileName: string;
  storageUrl: string;
  visibleToTrainees: boolean;
  parentType: 'enabler' | 'use_case' | 'standalone';
  parentId: string | null;
  parentTitle: string | null;
}

/** A trainee-visible PDF: visibility is not TRAINER_ONLY, type is not a solution. */
function isVisibleToTrainees(row: {
  document_type?: string | null;
  visibility?: string | null;
}): boolean {
  return (
    row.document_type !== 'TRAINER_SOLUTION' &&
    row.visibility !== 'TRAINER_ONLY'
  );
}

/**
 * SQL condition on content_documents (alias cd) for the caller: trainees get
 * neither TRAINER_SOLUTION nor TRAINER_ONLY documents, everyone gets only
 * documents of the own organization or of the platform (organization_id NULL).
 */
export function documentAccessCondition(
  options: Pick<PageIndexOptions, 'audience' | 'organizationId'>
): SQL {
  const parts: SQL[] = [];
  if (options.audience !== 'trainer') {
    parts.push(sql`cd.document_type IS DISTINCT FROM 'TRAINER_SOLUTION'`);
    parts.push(sql`cd.visibility IS DISTINCT FROM 'TRAINER_ONLY'`);
  }
  parts.push(
    isUuid(options.organizationId)
      ? sql`(cd.organization_id IS NULL OR cd.organization_id = ${options.organizationId}::uuid)`
      : sql`cd.organization_id IS NULL`
  );
  return sql.join(parts, sql` AND `);
}

/**
 * Find candidate PDFs based on vector search results and current context.
 *
 * Priority:
 *   1. PDFs directly linked to enablers/courses found in vector search
 *   2. PDFs for the current enabler/course (if in an enabler chat)
 *   3. Use case PDFs of the related courses: the solution PDFs for trainer
 *      level, the question PDFs (TRAINEE_QUESTION) for trainees
 *
 * Every query joins the catalog of the document (through enabler or use case),
 * so ids that come from the client (current enabler or course) cannot reach
 * content of another occupation.
 */
async function findCandidatePDFs(
  vectorResults: SearchResult[],
  options: PageIndexOptions
): Promise<CandidatePDF[]> {
  const candidates: CandidatePDF[] = [];
  const seenIds = new Set<string>();

  // Fail closed: without a catalog scope no PDF is read
  const catalogIds = [...new Set((options.catalogIds ?? []).filter(isUuid))];
  if (catalogIds.length === 0) return candidates;
  const catalogList = sql.join(
    catalogIds.map(id => sql`${id}::uuid`),
    sql`, `
  );
  const access = documentAccessCondition(options);

  // Priority 1: PDFs linked to enablers/courses from vector results
  const enablerIds = new Set<string>();
  const courseIds = new Set<string>();

  for (const result of vectorResults) {
    if (result.sourceType === 'enabler' && result.sourceId) {
      enablerIds.add(result.sourceId);
    }
    const courseId = result.metadata?.courseId as string;
    if (courseId) {
      courseIds.add(courseId);
    }
  }

  // Add current context (comes from the client: malformed ids are dropped
  // instead of failing the ::uuid cast)
  if (options.currentEnablerId) enablerIds.add(options.currentEnablerId);
  if (options.currentCourseId) courseIds.add(options.currentCourseId);
  const validEnablerIds = Array.from(enablerIds).filter(isUuid);
  const validCourseIds = Array.from(courseIds).filter(isUuid);

  // Fetch enabler-linked PDFs
  if (validEnablerIds.length > 0) {
    try {
      const enablerIdArray = validEnablerIds;
      const result = await haiDb.execute(sql`
        SELECT 
          cd.id, cd.title, cd.file_name, cd.storage_url,
          cd.document_type, cd.visibility,
          cd.enabler_id, e.title AS enabler_title, c.year AS course_year
        FROM content_documents cd
        JOIN enablers e ON cd.enabler_id = e.id
        LEFT JOIN courses c ON e.course_id = c.id
        WHERE cd.enabler_id IN (${sql.join(enablerIdArray.map(id => sql`${id}::uuid`), sql`, `)})
          AND e.training_catalog_id IN (${catalogList})
          AND ${access}
          AND cd.storage_url IS NOT NULL
          AND cd.mime_type = 'application/pdf'
        ORDER BY cd.order_index
        LIMIT ${MAX_PDFS_PER_QUERY}
      `);

      for (const row of result as any[]) {
        if (
          !isMetadataAllowedForTrainingScope(
            { year: row.course_year },
            'course',
            options.trainingScope
          )
        ) {
          continue;
        }

        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          candidates.push({
            id: row.id,
            title: row.title || row.file_name,
            fileName: row.file_name,
            storageUrl: row.storage_url,
            visibleToTrainees: isVisibleToTrainees(row),
            parentType: 'enabler',
            parentId: row.enabler_id,
            parentTitle: row.enabler_title,
          });
        }
      }
    } catch (err) {
      console.warn('HAI.ai PageIndex: Error fetching enabler PDFs:', err);
    }
  }

  // Fetch use case PDFs for related courses: solutions for trainer level, the
  // question PDFs for trainees (a trainee never gets a solution)
  if (validCourseIds.length > 0) {
    try {
      const courseIdArray = validCourseIds;
      const useCaseDocumentType =
        options.audience === 'trainer' ? 'TRAINER_SOLUTION' : 'TRAINEE_QUESTION';
      const result = await haiDb.execute(sql`
        SELECT 
          cd.id, cd.title, cd.file_name, cd.storage_url,
          cd.document_type, cd.visibility,
          cd.use_case_id, uc.title AS use_case_title, uc.year, uc.training_stage
        FROM content_documents cd
        JOIN use_cases uc ON cd.use_case_id = uc.id
        WHERE uc.course_id IN (${sql.join(courseIdArray.map(id => sql`${id}::uuid`), sql`, `)})
          AND uc.training_catalog_id IN (${catalogList})
          AND cd.document_type::text = ${useCaseDocumentType}
          AND ${access}
          AND cd.storage_url IS NOT NULL
        ORDER BY uc.order_index
        LIMIT ${MAX_PDFS_PER_QUERY}
      `);

      for (const row of result as any[]) {
        if (
          !isMetadataAllowedForTrainingScope(
            {
              year: row.year,
              trainingStage: row.training_stage,
            },
            'use_case',
            options.trainingScope
          )
        ) {
          continue;
        }

        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          candidates.push({
            id: row.id,
            title: row.title || row.file_name,
            fileName: row.file_name,
            storageUrl: row.storage_url,
            visibleToTrainees: isVisibleToTrainees(row),
            parentType: 'use_case',
            parentId: row.use_case_id,
            parentTitle: row.use_case_title,
          });
        }
      }
    } catch (err) {
      console.warn('HAI.ai PageIndex: Error fetching use case PDFs:', err);
    }
  }

  return candidates;
}

// ============================================================================
// PAGE EXTRACTION (with caching)
// ============================================================================

/**
 * Extract pages from a PDF, with in-memory caching.
 */
async function extractPDFPages(
  storageUrl: string
): Promise<PerPageExtractionResult | null> {
  // Check cache
  const cached = _pdfCache.get(storageUrl);
  if (cached && Date.now() - cached.timestamp < PDF_CACHE_TTL_MS) {
    return cached.pages;
  }

  // Extract pages
  const result = await extractTextByPage(storageUrl);

  if (result.success) {
    _pdfCache.set(storageUrl, { pages: result, timestamp: Date.now() });

    // Evict old entries if cache grows too large
    if (_pdfCache.size > 50) {
      const oldestKey = _pdfCache.keys().next().value;
      if (oldestKey) _pdfCache.delete(oldestKey);
    }
  }

  return result;
}

// ============================================================================
// PAGE RELEVANCE SCORING
// ============================================================================

/**
 * Score each page by keyword relevance to the user query and vector results.
 * Uses a simple TF-based approach (no embedding needed).
 */
function scorePagesByRelevance(
  pages: { pageNumber: number; text: string; charCount: number }[],
  userQuery: string,
  vectorResults: SearchResult[]
): PageContent[] {
  // Extract keywords from query
  const queryKeywords = extractKeywords(userQuery);

  // Also extract keywords from vector result titles/content (for context enrichment)
  const contextKeywords: string[] = [];
  for (const result of vectorResults.slice(0, 3)) {
    const title = result.metadata?.title as string;
    if (title) contextKeywords.push(...extractKeywords(title));
    // Take first 200 chars of content for keywords
    if (result.content) {
      contextKeywords.push(...extractKeywords(result.content.slice(0, 200)));
    }
  }

  // Weight: query keywords are 2x more important than context keywords
  const allKeywords = [
    ...queryKeywords.map(k => ({ word: k, weight: 2.0 })),
    ...contextKeywords.map(k => ({ word: k, weight: 1.0 })),
  ];

  if (allKeywords.length === 0) {
    // No keywords to match — return all pages with baseline score
    return pages.map(p => ({
      pageNumber: p.pageNumber,
      text: p.text.slice(0, MAX_CHARS_PER_PAGE),
      relevanceScore: 0.1,
    }));
  }

  return pages.map(page => {
    const lowerText = page.text.toLowerCase();
    let score = 0;
    let maxPossibleScore = 0;

    for (const { word, weight } of allKeywords) {
      maxPossibleScore += weight;
      if (lowerText.includes(word)) {
        score += weight;
        // Bonus for multiple occurrences
        const occurrences = (
          lowerText.match(new RegExp(escapeRegex(word), 'gi')) || []
        ).length;
        if (occurrences > 1) {
          score += Math.min(occurrences - 1, 3) * weight * 0.2;
        }
      }
    }

    const relevanceScore =
      maxPossibleScore > 0 ? Math.min(score / maxPossibleScore, 1.0) : 0;

    return {
      pageNumber: page.pageNumber,
      text: page.text.slice(0, MAX_CHARS_PER_PAGE),
      relevanceScore,
    };
  });
}

/**
 * Extract meaningful keywords from text (German + English).
 * Filters out common stop words and short words.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    // German
    'der',
    'die',
    'das',
    'ein',
    'eine',
    'und',
    'oder',
    'aber',
    'ist',
    'sind',
    'war',
    'hat',
    'haben',
    'wird',
    'werden',
    'kann',
    'können',
    'soll',
    'sollen',
    'mit',
    'von',
    'für',
    'auf',
    'aus',
    'bei',
    'nach',
    'über',
    'unter',
    'vor',
    'zum',
    'zur',
    'als',
    'wie',
    'was',
    'wer',
    'wann',
    'wo',
    'warum',
    'nicht',
    'auch',
    'noch',
    'nur',
    'sehr',
    'schon',
    'mehr',
    'dann',
    'hier',
    'dort',
    'diese',
    'dieser',
    'dieses',
    'jede',
    'jeder',
    'jedes',
    'alle',
    'viele',
    'einige',
    'manche',
    'welche',
    'welcher',
    'welches',
    'ich',
    'du',
    'er',
    'sie',
    'wir',
    'ihr',
    'mein',
    'dein',
    'sein',
    'ihr',
    'mir',
    'dir',
    'ihm',
    'uns',
    'euch',
    'ihnen',
    // English
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'is',
    'are',
    'was',
    'has',
    'have',
    'will',
    'can',
    'should',
    'with',
    'from',
    'for',
    'on',
    'at',
    'by',
    'to',
    'in',
    'of',
    'it',
    'this',
    'that',
    'these',
    'those',
    'not',
    'also',
    'just',
    'more',
    'then',
    'here',
    'there',
    'what',
    'who',
    'when',
    'where',
    'why',
    'how',
    'which',
    'some',
    'all',
    'many',
    'each',
    'every',
    'me',
    'you',
    'he',
    'she',
    'we',
    'they',
    'my',
    'your',
    'his',
    'her',
    'our',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-zäöüß\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i); // unique
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// CONTEXT FORMATTING
// ============================================================================

/**
 * Format selected PDF pages into a context string for the LLM prompt.
 */
function formatPDFContext(
  pages: (PageContent & { docTitle: string; fileName: string })[]
): string {
  if (pages.length === 0) return '';

  const sections: string[] = ['--- PDF-Dokumenten-Kontext (PageIndex) ---', ''];

  // Group by document
  const byDoc = new Map<string, typeof pages>();
  for (const page of pages) {
    const key = page.fileName;
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key)!.push(page);
  }

  for (const [fileName, docPages] of byDoc) {
    const docTitle = docPages[0].docTitle;
    sections.push(`📄 ${docTitle} (${fileName})`);

    // Sort pages by page number
    docPages.sort((a, b) => a.pageNumber - b.pageNumber);

    for (const page of docPages) {
      sections.push(`  [Seite ${page.pageNumber}]:`);
      // Truncate long page text
      const text =
        page.text.length > MAX_CHARS_PER_PAGE
          ? page.text.slice(0, MAX_CHARS_PER_PAGE) + '...'
          : page.text;
      sections.push(`  ${text.replace(/\n/g, '\n  ')}`);
      sections.push('');
    }
  }

  sections.push('--- Ende PDF-Kontext ---');
  return sections.join('\n');
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Clear the in-memory PDF cache.
 */
export function clearPageIndexCache(): void {
  _pdfCache.clear();
}

/**
 * Get cache statistics.
 */
export function getPageIndexCacheStats(): { size: number; maxAge: number } {
  let maxAge = 0;
  const now = Date.now();
  for (const [, entry] of _pdfCache) {
    const age = now - entry.timestamp;
    if (age > maxAge) maxAge = age;
  }
  return { size: _pdfCache.size, maxAge };
}
