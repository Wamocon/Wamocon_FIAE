/**
 * Database side of the navigation to courses, to the enablers and use cases of a
 * trainer, and to documents (the reader).
 *
 * The rules are those of the pages and routes themselves, nothing is wider:
 *  - Courses: a trainee sees the active courses he is a member of, inside the
 *    catalogs of the person; a trainer level sees the courses inside its catalogs.
 *  - Documents: the rows of the file questions (documentQuery.ts: occupation,
 *    own organization or platform, no TRAINER_SOLUTION and no TRAINER_ONLY for a
 *    trainee), checked once more for a trainee with the rules of
 *    GET /api/trainee/documents/[id]/content (membership of the course, active
 *    enabler or use case, no solution, no Word original, a file that a trainee
 *    may read) and reduced to PDF files (the reader shows PDF files only).
 *  - A TRAINER_SOLUTION is a link for a trainer only while the owner switch
 *    HAI_TRAINER_SOLUTIONS is on, like the index (trainerSolutions.ts).
 *
 * A record that does not pass is not in the result, so it can neither be named
 * nor offered, and "not allowed" is not told apart from "not there". A query that
 * fails throws, the caller answers "cannot check now" and offers nothing.
 *
 * @module lib/hai/navigation/contentData
 */

import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import db from '@/db';
import haiDb from '@/db/haiDb';
import {
  courseMembers,
  courses,
  enablers,
  useCases,
} from '@/db/migrations/schemas/schema';
import {
  filterDocumentRows,
  normalizeFileKey,
  queryDocumentsByName,
  queryDocumentsByScope,
  type DocumentAccess,
  type DocumentRow,
  type FileNameKey,
} from '../documentQuery';
import { isPageUuid } from '../pageContext/shared';
import { isTrainerSolutionsEnabled } from '../trainerSolutions';
import type { HaiTrainingScope } from '../trainingScope';
import type { ContentCandidate } from './match';
import type { NavigationLevel } from './targets';

// ============================================================================
// COURSES AND THE RECORDS OF A TRAINER
// ============================================================================

function toCandidate(r: {
  id: unknown;
  title: unknown;
  code: unknown;
  courseId: unknown;
  courseTitle: unknown;
}): ContentCandidate {
  return {
    id: String(r.id),
    title: String(r.title),
    code: r.code ? String(r.code) : null,
    courseId: String(r.courseId),
    courseTitle: String(r.courseTitle),
  };
}

/**
 * The courses a person may be taken to. A trainee: active courses he is a member
 * of. A trainer level: the courses of its catalogs (the content management
 * lists them the same way).
 */
export async function loadCourses(
  userId: string,
  level: NavigationLevel,
  catalogIds: readonly string[]
): Promise<ContentCandidate[]> {
  if (catalogIds.length === 0) return [];
  if (level === 'TRAINEE') {
    const rows = await db
      .select({ id: courses.id, title: courses.title, code: courses.code })
      .from(courses)
      .innerJoin(
        courseMembers,
        and(
          eq(courseMembers.courseId, courses.id),
          eq(courseMembers.userId, userId as never)
        )
      )
      .where(
        and(
          eq(courses.isActive, true),
          inArray(courses.trainingCatalogId, catalogIds as string[])
        )
      );
    return rows.map(r =>
      toCandidate({ ...r, courseId: r.id, courseTitle: r.title })
    );
  }
  const rows = await db
    .select({ id: courses.id, title: courses.title, code: courses.code })
    .from(courses)
    .where(inArray(courses.trainingCatalogId, catalogIds as string[]));
  return rows.map(r =>
    toCandidate({ ...r, courseId: r.id, courseTitle: r.title })
  );
}

/** The enablers of the catalogs of a trainer level (the editor of a course shows them). */
export async function loadTrainerEnablers(
  catalogIds: readonly string[]
): Promise<ContentCandidate[]> {
  if (catalogIds.length === 0) return [];
  const rows = await db
    .select({
      id: enablers.id,
      title: enablers.title,
      code: enablers.code,
      courseId: enablers.courseId,
      courseTitle: courses.title,
    })
    .from(enablers)
    .innerJoin(courses, eq(enablers.courseId, courses.id))
    .where(inArray(enablers.trainingCatalogId, catalogIds as string[]));
  return rows.map(toCandidate);
}

/** The use cases of the catalogs of a trainer level. */
export async function loadTrainerUseCases(
  catalogIds: readonly string[]
): Promise<ContentCandidate[]> {
  if (catalogIds.length === 0) return [];
  const rows = await db
    .select({
      id: useCases.id,
      title: useCases.title,
      code: useCases.code,
      courseId: useCases.courseId,
      courseTitle: courses.title,
    })
    .from(useCases)
    .innerJoin(courses, eq(useCases.courseId, courses.id))
    .where(inArray(useCases.trainingCatalogId, catalogIds as string[]));
  return rows.map(toCandidate);
}

/** The course of each enabler (the trainer page of an enabler is the editor of its course). */
export async function loadEnablerCourseIds(
  enablerIds: readonly string[]
): Promise<Map<string, string>> {
  const ids = enablerIds.filter(isPageUuid);
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: enablers.id, courseId: enablers.courseId })
    .from(enablers)
    .where(inArray(enablers.id, ids));
  return new Map(rows.map(r => [String(r.id), String(r.courseId)]));
}

/**
 * Whether the enabler carries the single scenario PDF of its own (the field
 * scenario_pdf_url, no row in content_documents). A trainee opens it through
 * GET /api/trainee/enablers/[id]/scenario/content.
 */
export async function enablerHasScenarioPdf(
  enablerId: string
): Promise<boolean> {
  if (!isPageUuid(enablerId)) return false;
  const rows = await db
    .select({ url: enablers.scenarioPdfUrl })
    .from(enablers)
    .where(eq(enablers.id, enablerId));
  const url = rows[0]?.url;
  return typeof url === 'string' && url.trim() !== '';
}

// ============================================================================
// DOCUMENTS
// ============================================================================

/** A document the person may be taken to (a page that opens it in the reader). */
export interface OpenableDocument {
  id: string;
  title: string;
  fileName: string;
  documentType: string | null;
  parentType: 'enabler' | 'use_case';
  parentId: string;
  parentTitle: string;
  /** The course of an enabler (the trainer opens it in the editor of the course). */
  courseId: string | null;
}

export interface DocumentLookup {
  userId: string;
  level: NavigationLevel;
  catalogIds: readonly string[];
  organizationId?: string | null;
  trainingScope?: HaiTrainingScope;
}

function accessOf(lookup: DocumentLookup): DocumentAccess {
  return {
    catalogIds: [...lookup.catalogIds],
    audience: lookup.level === 'TRAINEE' ? 'trainee' : 'trainer',
    organizationId: lookup.organizationId ?? null,
    trainingScope: lookup.trainingScope,
  };
}

const isPdfRow = (row: DocumentRow) =>
  /pdf/i.test(row.mimeType ?? '') || /\.pdf$/i.test(row.fileName);

/**
 * The second line of defense behind the SQL of the rows, in code: a record
 * needs an enabler or use case (a course level file has no page), only PDF
 * files, and a solution only for a trainer while the owner switch is on.
 */
export function openableRows(
  rows: readonly DocumentRow[],
  lookup: Pick<DocumentLookup, 'level' | 'trainingScope'>,
  solutionsEnabled: boolean = isTrainerSolutionsEnabled()
): DocumentRow[] {
  const audience = lookup.level === 'TRAINEE' ? 'trainee' : 'trainer';
  return filterDocumentRows([...rows], {
    audience,
    trainingScope: lookup.trainingScope,
  }).filter(row => {
    if (!row.enablerId && !row.useCaseId) return false;
    if (!isPdfRow(row)) return false;
    if (row.documentType === 'TRAINER_SOLUTION') {
      return audience === 'trainer' && solutionsEnabled;
    }
    return true;
  });
}

/**
 * The ids among `ids` that a TRAINEE may read, by the rules of the content route
 * (GET /api/trainee/documents/[id]/content): a file that carries an address a
 * trainee may read, no solution, no Word original, visibility for trainees, an
 * active enabler or use case of a course the trainee is a member of.
 */
export async function traineeReadableIds(
  userId: string,
  ids: readonly string[]
): Promise<Set<string>> {
  const clean = ids.filter(isPageUuid);
  if (clean.length === 0 || !isPageUuid(userId)) return new Set();
  const list = sql.join(
    clean.map(id => sql`${id}::uuid`),
    sql`, `
  );
  const result = await haiDb.execute(sql`
    SELECT cd.id
    FROM content_documents cd
    LEFT JOIN enablers e ON cd.enabler_id = e.id
    LEFT JOIN use_cases uc ON cd.use_case_id = uc.id
    WHERE cd.id IN (${list})
      AND btrim(cd.storage_url) <> ''
      AND (cd.storage_url NOT LIKE 'private://%' OR cd.storage_url LIKE 'private://content/%')
      AND (cd.mime_type IS NULL OR (lower(cd.mime_type) NOT LIKE '%wordprocessingml%' AND lower(cd.mime_type) <> 'application/msword'))
      AND cd.document_type IS DISTINCT FROM 'TRAINER_SOLUTION'
      AND (cd.visibility IS NULL OR cd.visibility IN ('ALL', 'TRAINEE_ONLY'))
      AND (
        (cd.enabler_id IS NOT NULL AND e.is_active = true AND EXISTS (
          SELECT 1 FROM course_members cm WHERE cm.course_id = e.course_id AND cm.user_id = ${userId}::uuid))
        OR
        (cd.use_case_id IS NOT NULL AND cd.document_type IS NOT NULL AND uc.is_active = true AND EXISTS (
          SELECT 1 FROM course_members cm WHERE cm.course_id = uc.course_id AND cm.user_id = ${userId}::uuid))
      )
  `);
  return new Set(
    (result as unknown as Array<{ id: unknown }>).map(r => String(r.id))
  );
}

async function toOpenable(
  rows: readonly DocumentRow[],
  lookup: DocumentLookup
): Promise<OpenableDocument[]> {
  let kept = openableRows(rows, lookup);
  if (lookup.level === 'TRAINEE' && kept.length > 0) {
    const readable = await traineeReadableIds(
      lookup.userId,
      kept.map(row => row.id)
    );
    kept = kept.filter(row => readable.has(row.id));
  }
  const courseOf = await loadEnablerCourseIds(
    kept.map(row => row.enablerId).filter((id): id is string => !!id)
  );
  return kept.map(row => ({
    id: row.id,
    title: row.title || row.fileName,
    fileName: row.fileName,
    documentType: row.documentType,
    parentType: row.enablerId ? 'enabler' : 'use_case',
    parentId: (row.enablerId ?? row.useCaseId) as string,
    parentTitle: (row.enablerId ? row.enablerTitle : row.useCaseTitle) ?? '',
    courseId: row.enablerId ? (courseOf.get(row.enablerId) ?? null) : null,
  }));
}

/** The documents of one enabler or use case that the person may be taken to. */
export async function findDocumentsOf(
  lookup: DocumentLookup,
  parent: { type: 'enabler' | 'use_case'; id: string }
): Promise<OpenableDocument[]> {
  if (!isPageUuid(parent.id)) return [];
  const rows = await queryDocumentsByScope(accessOf(lookup), {
    enablerIds: parent.type === 'enabler' ? [parent.id] : [],
    useCaseIds: parent.type === 'use_case' ? [parent.id] : [],
    courseIds: [],
  });
  return toOpenable(rows, lookup);
}

/**
 * Of the readable documents, the ones the file name keys name: the longest key
 * that matches decides, an exact name beats a part of a name (the rule of
 * answerDocumentQuestion).
 */
export function pickByKeys(
  documents: readonly OpenableDocument[],
  keys: readonly FileNameKey[]
): OpenableDocument[] {
  for (const { key, partial } of keys) {
    const names = (doc: OpenableDocument) => [
      normalizeFileKey(doc.fileName),
      normalizeFileKey(doc.title),
    ];
    const matched = documents.filter(doc =>
      names(doc).some(name => (partial ? name.includes(key) : name === key))
    );
    if (matched.length > 0) {
      const exact = matched.filter(doc =>
        names(doc).some(name => name === key)
      );
      return exact.length > 0 ? exact : matched;
    }
  }
  return [];
}

/** The documents that a file name in the message names, among those the person may be taken to. */
export async function findDocumentsByName(
  lookup: DocumentLookup,
  keys: readonly FileNameKey[]
): Promise<OpenableDocument[]> {
  if (keys.length === 0) return [];
  const rows = await queryDocumentsByName(accessOf(lookup), [...keys]);
  return pickByKeys(await toOpenable(rows, lookup), keys);
}
