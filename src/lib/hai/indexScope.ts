/**
 * Scope of a chunk in the HAI vector index (hai_embeddings), as the writers
 * set it. Pure module, no server imports, so the app, the reindex script and
 * the tests share it.
 *
 * Every writer states the three columns explicitly (training_catalog_id,
 * visibility, organization_id). The database trigger of migration
 * 20261027000100 stays as a safety net: it fills a NULL column from the source
 * and only ever raises the visibility to 'trainer'.
 *
 * Parts of a source. Some sources hold content that trainees may not see next
 * to content that they may see: the answers of a quiz, the hint of a scenario.
 * The writer splits such a source BEFORE it chunks by size and writes the
 * trainer part into its own block of chunk indexes starting at
 * TRAINER_PART_CHUNK_OFFSET. A size split of a mixed text could otherwise leave
 * the tail of an answer in a continuation chunk without any marker.
 *
 * @module lib/hai/indexScope
 */

import {
  parsePrivateSolutionObject,
  type PrivateSolutionObject,
} from './trainerSolutions';

/** 'all' = may be shown to trainees, 'trainer' = trainer level only. */
export type HaiVisibility = 'all' | 'trainer';

export interface IndexScope {
  /** Occupation of the chunk. null = visible to nobody (never on purpose). */
  trainingCatalogId: string | null;
  visibility: HaiVisibility;
  /** null = platform content for every organization. */
  organizationId: string | null;
}

/** Which part of a source a chunk holds, stored as metadata.contentPart. */
export type ContentPart = 'questions' | 'answers' | 'hint';

/** Size of the block of chunk indexes of one part of a source. */
export const CHUNK_INDEX_BLOCK = 10000;

/** First chunk index of the trainer part of a source. */
export const TRAINER_PART_CHUNK_OFFSET = CHUNK_INDEX_BLOCK;

/**
 * Who sees the hint of a scenario (enablers.hint_text and the hints of the
 * scenarios). The admin form labels the field "visible to trainees", but no
 * trainee page reads it, and the owner has not decided yet. The hint is its own
 * chunk either way, so reversing this constant to 'all' needs a reindex and
 * nothing else.
 */
export const SCENARIO_HINT_VISIBILITY: HaiVisibility = 'trainer';

/** Quiz questions (without any answer) may be shown to trainees. */
export const QUIZ_QUESTIONS_VISIBILITY: HaiVisibility = 'all';

/** Answers, explanations and expected answers are trainer level only. */
export const QUIZ_ANSWERS_VISIBILITY: HaiVisibility = 'trainer';

/**
 * Source type of the learning technique cards (HAI package B). Platform
 * knowledge for every trainee and trainer of every occupation: the chunks have
 * NO occupation (training_catalog_id NULL), visibility 'all' and no
 * organization. The search matches this source type explicitly (see
 * buildScopeCondition in vectorSearch.ts); it opens no other source.
 */
export const LEARNING_TECHNIQUE_SOURCE_TYPE = 'learning_technique';

/** Source types whose chunks are platform knowledge without an occupation. */
export const PLATFORM_SOURCE_TYPES: readonly string[] = [
  LEARNING_TECHNIQUE_SOURCE_TYPE,
];

export function isPlatformSourceType(
  sourceType: string | null | undefined
): boolean {
  return !!sourceType && PLATFORM_SOURCE_TYPES.includes(sourceType);
}

/**
 * Scope of a platform chunk: exactly the one the search expects, otherwise the
 * writer refuses (a chunk with an occupation or an owner would not match the
 * platform rule of the search and would be wasted or too narrow).
 */
function platformScopeProblem(scope: Partial<IndexScope>): string | null {
  if (scope.trainingCatalogId !== null) {
    return 'a platform chunk has no occupation (trainingCatalogId must be null)';
  }
  if (scope.visibility !== 'all') {
    return 'a platform chunk has visibility all';
  }
  if (scope.organizationId !== null) {
    return 'a platform chunk has no organization (organizationId must be null)';
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHaiVisibility(value: unknown): value is HaiVisibility {
  return value === 'all' || value === 'trainer';
}

/**
 * Why a scope may not be written, or null if it is complete. A writer
 * refuses to write a chunk without an occupation: the search would never
 * show it, so the embedding call would be wasted.
 */
export function scopeProblem(
  scope: Partial<IndexScope> | undefined,
  sourceType?: string
): string | null {
  if (!scope) return 'scope is missing';
  if (isPlatformSourceType(sourceType)) return platformScopeProblem(scope);
  if (!scope.trainingCatalogId || !UUID.test(scope.trainingCatalogId)) {
    return 'trainingCatalogId is missing or not a uuid';
  }
  if (!isHaiVisibility(scope.visibility)) {
    return 'visibility must be all or trainer';
  }
  if (scope.organizationId === undefined) {
    return 'organizationId must be set explicitly (null for platform content)';
  }
  if (scope.organizationId !== null && !UUID.test(scope.organizationId)) {
    return 'organizationId is not a uuid';
  }
  return null;
}

/**
 * Visibility of a document chunk: trainer solutions and documents that are
 * trainer only (content_documents.document_type / visibility) are 'trainer'.
 */
export function documentVisibility(
  documentType: string | null | undefined,
  visibility: string | null | undefined
): HaiVisibility {
  return documentType === 'TRAINER_SOLUTION' || visibility === 'TRAINER_ONLY'
    ? 'trainer'
    : 'all';
}

/**
 * First catalog that is set, in the order of the sources of a document
 * (enabler, use case, course).
 */
export function firstCatalogId(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate) return String(candidate);
  }
  return null;
}

/** A content_documents row as the reindex reads it, with the catalogs of its parents. */
export interface DocumentIndexRow {
  documentType: string | null;
  visibility: string | null;
  storageUrl: string | null;
  mimeType: string | null;
  description: string | null;
  organizationId: string | null;
  enablerCatalogId: string | null;
  useCaseCatalogId: string | null;
  courseCatalogId: string | null;
}

export type DocumentSkipReason =
  | 'no training catalog'
  | 'catalog conflict'
  | 'private reference'
  | 'word file'
  | 'not a pdf'
  | 'not an http url'
  | 'no file and no text';

/** What the reindex does with a document row. */
export type DocumentIndexPlan =
  | { kind: 'pdf' | 'text'; scope: IndexScope }
  | {
      /**
       * A model solution in the private bucket. `enabled` is the switch
       * HAI_TRAINER_SOLUTIONS: a run reads and embeds the file only when it is
       * true, a dry run counts the file either way (apart from the others).
       */
      kind: 'private_pdf';
      scope: IndexScope;
      object: PrivateSolutionObject;
      enabled: boolean;
    }
  | { kind: 'skip'; reason: DocumentSkipReason };

/** What the plan needs besides the row. */
export interface DocumentPlanOptions {
  /** The switch HAI_TRAINER_SOLUTIONS is on. Default: off. */
  trainerSolutions?: boolean;
  /**
   * Folder in the private bucket that this run may read (privateSolutionPrefix).
   * Without it no private reference is planned at all.
   */
  solutionPrefix?: string;
}

/** A text row needs at least this much text to be worth a chunk. */
export const MIN_DOCUMENT_TEXT_CHARS = 20;

const PRIVATE_REFERENCE = /^\s*private:\/\//i;
const WORD_MIME = /wordprocessingml|^application\/msword$/i;

/**
 * Decides what the reindex does with a document row, and for whom the chunks
 * are.
 *
 *  - pdf: the file is read from its url. text: the row has no file and holds
 *    its text in the description (the text rows of the import: the situation of
 *    a scenario, the solution of a use case).
 *  - visibility comes from documentVisibility: a solution or a trainer-only
 *    row is 'trainer' in every form (file or text), everything else follows the
 *    rule of the trainee routes.
 *  - private_pdf: a model solution in the private bucket (TRAINER_SOLUTION,
 *    TRAINER_ONLY, a reference into content-solutions inside the folder of the
 *    target, a use case of the same occupation). Always trainer level, whatever
 *    the switch says. It is read only by the dedicated reader with the server
 *    key, never as an address (planPrivateSolution).
 *  - skip: no catalog (nobody would see the chunk), every other private
 *    reference (only the model solutions above are ever read), a Word file or
 *    another file that is no PDF, or a row without file and text.
 */
export function planDocumentIndexing(
  row: DocumentIndexRow,
  options: DocumentPlanOptions = {}
): DocumentIndexPlan {
  const trainingCatalogId = firstCatalogId(
    row.enablerCatalogId,
    row.useCaseCatalogId,
    row.courseCatalogId
  );
  if (!trainingCatalogId) {
    return { kind: 'skip', reason: 'no training catalog' };
  }

  const url = (row.storageUrl ?? '').trim();
  if (PRIVATE_REFERENCE.test(url)) {
    return planPrivateSolution(row, options);
  }
  const mime = (row.mimeType ?? '').trim();
  if (WORD_MIME.test(mime)) return { kind: 'skip', reason: 'word file' };

  const scope: IndexScope = {
    trainingCatalogId,
    visibility: documentVisibility(row.documentType, row.visibility),
    organizationId: row.organizationId ? String(row.organizationId) : null,
  };

  if (url === '') {
    const text = (row.description ?? '').trim();
    return text.length >= MIN_DOCUMENT_TEXT_CHARS
      ? { kind: 'text', scope }
      : { kind: 'skip', reason: 'no file and no text' };
  }
  // Only an http or https address is fetched (the host of a stored url is not
  // checked here: the url is written by an import or a trainer)
  if (!/^https?:\/\//i.test(url)) {
    return { kind: 'skip', reason: 'not an http url' };
  }
  if (mime !== '' && !/^application\/pdf$/i.test(mime)) {
    return { kind: 'skip', reason: 'not a pdf' };
  }
  return { kind: 'pdf', scope };
}

/**
 * A private reference is read only if the row is a model solution: type
 * TRAINER_SOLUTION and visibility TRAINER_ONLY (both exactly), at a use case,
 * all catalogs that the row names are one and the same occupation, and the
 * reference is a PDF inside the bucket and the folder of the target. Anything
 * else stays a skipped private reference (nothing is fetched, old chunks of the
 * row are removed by the caller).
 */
function planPrivateSolution(
  row: DocumentIndexRow,
  options: DocumentPlanOptions
): DocumentIndexPlan {
  const refused: DocumentIndexPlan = {
    kind: 'skip',
    reason: 'private reference',
  };
  if (!options.solutionPrefix) return refused;
  if (row.documentType !== 'TRAINER_SOLUTION') return refused;
  if (row.visibility !== 'TRAINER_ONLY') return refused;
  if (!row.useCaseCatalogId) return refused;

  const mime = (row.mimeType ?? '').trim();
  if (mime !== '' && !/^application\/pdf$/i.test(mime)) return refused;

  // The text is checked as stored: no trimming, no decoding
  const parsed = parsePrivateSolutionObject(
    row.storageUrl,
    options.solutionPrefix
  );
  if (!parsed.ok) return refused;

  const catalogs = new Set(
    [row.enablerCatalogId, row.useCaseCatalogId, row.courseCatalogId]
      .filter((id): id is string => !!id)
      .map(id => String(id))
  );
  if (catalogs.size !== 1) return { kind: 'skip', reason: 'catalog conflict' };

  return {
    kind: 'private_pdf',
    scope: {
      trainingCatalogId: String(row.useCaseCatalogId),
      // a model solution is trainer level by its type and visibility
      visibility: documentVisibility(row.documentType, row.visibility),
      organizationId: row.organizationId ? String(row.organizationId) : null,
    },
    object: parsed.object,
    enabled: options.trainerSolutions === true,
  };
}

/** Half-open range [from, to) of the chunk indexes of the part at `offset`. */
export function chunkIndexRange(offset: number): { from: number; to: number } {
  return { from: offset, to: offset + CHUNK_INDEX_BLOCK };
}
