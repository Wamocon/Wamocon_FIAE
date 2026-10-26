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
  scope: Partial<IndexScope> | undefined
): string | null {
  if (!scope) return 'scope is missing';
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

/** Half-open range [from, to) of the chunk indexes of the part at `offset`. */
export function chunkIndexRange(offset: number): { from: number; to: number } {
  return { from: offset, to: offset + CHUNK_INDEX_BLOCK };
}
