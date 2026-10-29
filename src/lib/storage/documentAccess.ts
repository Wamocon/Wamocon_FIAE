/**
 * May this person open the file of this document?
 *
 * The one rule behind GET /api/documents/[documentId]/file. A document row is
 * loaded by its id, and the file is only handed out (as a signed url, see
 * contentUrl.ts) when the person may see the row, by the rules of the lists
 * that exist already:
 *
 *  - Occupation (catalog): the enabler, use case or course the document hangs
 *    on has to lie inside the catalogs of the person (requireContentScope for a
 *    trainer, requireContentScopeForUser for a trainee).
 *  - Organization: the shared curriculum, the platform and the own organization
 *    (isDocumentOrgVisible, the rule of documentVisibilityCondition).
 *  - Trainer, admin, super admin: every visibility, TRAINER_ONLY included.
 *  - Trainee: only ALL, TRAINEE_ONLY or unset, never a TRAINER_SOLUTION, no Word
 *    original, the enabler has to be active and the trainee a member of the
 *    course (like the trainee lists).
 *
 * Everything that is no access answers 404 with the same text as a missing
 * document, so the route does not tell which documents exist. A role that is
 * neither trainer level nor trainee gets 403.
 *
 * The path of the file never comes from the request: only the id of the row.
 */

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import db from '@/db';
import {
  contentDocuments,
  courseMembers,
  enablers,
  useCases,
} from '@/db/migrations/schemas/schema';
import {
  isDocumentOrgVisible,
  loadPlatformOrgIds,
} from '@/lib/auth/document-scope';
import { ROLE } from '@/lib/auth/roles';
import { isErrorResponse, type SessionUser } from '@/lib/auth/session';
import {
  requireContentScope,
  requireContentScopeForUser,
  type CatalogContentKind,
  type CatalogRequestLike,
} from '@/lib/catalog/scope';
import { isTraineeFileReference } from '@/lib/storage/contentPath';
import { isUuid } from '@/lib/uuid';

const NOT_FOUND = { error: 'Not found' };

const notFound = () => NextResponse.json(NOT_FOUND, { status: 404 });

const TRAINEE_VISIBILITIES = new Set(['ALL', 'TRAINEE_ONLY']);

function isWordMime(mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? '').toLowerCase();
  return mime.includes('wordprocessingml') || mime === 'application/msword';
}

export type DocumentFileAccess =
  | { ok: true; storageUrl: string }
  | { ok: false; response: NextResponse };

const deny = (response: NextResponse): DocumentFileAccess => ({
  ok: false,
  response,
});

/**
 * The stored address of the file of `documentId`, when `session` may open it.
 * Otherwise a ready-made error response. The address is still the stored one
 * (public url, private reference or path): the caller signs it.
 */
export async function authorizeDocumentFile(
  session: SessionUser,
  request: CatalogRequestLike,
  documentId: string
): Promise<DocumentFileAccess> {
  if (!isUuid(documentId)) return deny(notFound());

  const isTrainerLevel = session.isTrainerLevel === true;
  const isTrainee = session.role === ROLE.TRAINEE;
  if (!isTrainerLevel && !isTrainee) {
    return deny(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  }

  const [doc] = await db
    .select({
      enablerId: contentDocuments.enablerId,
      useCaseId: contentDocuments.useCaseId,
      courseId: contentDocuments.courseId,
      organizationId: contentDocuments.organizationId,
      visibility: contentDocuments.visibility,
      documentType: contentDocuments.documentType,
      mimeType: contentDocuments.mimeType,
      storageUrl: contentDocuments.storageUrl,
    })
    .from(contentDocuments)
    .where(eq(contentDocuments.id, documentId as any))
    .limit(1);
  if (!doc) return deny(notFound());

  // What the document hangs on decides the occupation and the course
  let kind: CatalogContentKind;
  let ownerId: string;
  if (doc.enablerId) {
    kind = 'enabler';
    ownerId = String(doc.enablerId);
  } else if (doc.useCaseId) {
    kind = 'useCase';
    ownerId = String(doc.useCaseId);
  } else if (doc.courseId) {
    kind = 'course';
    ownerId = String(doc.courseId);
  } else {
    return deny(notFound());
  }

  // Occupation: the answer of the scope helpers is passed on (403 for a
  // rejected catalog choice, 404 outside the scope, 503 when it is unknown)
  const scope = isTrainerLevel
    ? await requireContentScope(session, request, kind, ownerId)
    : await requireContentScopeForUser(session.id, request, kind, ownerId);
  if (isErrorResponse(scope)) return deny(scope);

  // Organization
  const platformOrgIds = await loadPlatformOrgIds();
  if (!isDocumentOrgVisible(session, doc.organizationId, platformOrgIds)) {
    return deny(notFound());
  }

  if (typeof doc.storageUrl !== 'string' || doc.storageUrl.trim() === '') {
    return deny(notFound());
  }

  if (!isTrainerLevel) {
    // A trainee: material for trainees only
    const visibilityOk =
      doc.visibility === null ||
      doc.visibility === undefined ||
      TRAINEE_VISIBILITIES.has(doc.visibility);
    // The trainee lists offer no course level document, and the use case list
    // leaves out a row without a document type: the same here
    if (
      !visibilityOk ||
      kind === 'course' ||
      (kind === 'useCase' && !doc.documentType) ||
      doc.documentType === 'TRAINER_SOLUTION' ||
      isWordMime(doc.mimeType) ||
      !isTraineeFileReference(doc.storageUrl)
    ) {
      return deny(notFound());
    }

    // The course of the parent: the enabler has to be active, the trainee a member
    let courseId: string | null = null;
    if (kind === 'enabler') {
      const [enabler] = await db
        .select({ courseId: enablers.courseId, isActive: enablers.isActive })
        .from(enablers)
        .where(eq(enablers.id, ownerId as any))
        .limit(1);
      if (!enabler || !enabler.isActive) return deny(notFound());
      courseId = String(enabler.courseId);
    } else {
      // a use case (a course level document was turned away above)
      const [useCase] = await db
        .select({ courseId: useCases.courseId })
        .from(useCases)
        .where(eq(useCases.id, ownerId as any))
        .limit(1);
      if (!useCase) return deny(notFound());
      courseId = String(useCase.courseId);
    }
    const [member] = await db
      .select({ userId: courseMembers.userId })
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, courseId as any),
          eq(courseMembers.userId, session.id as any)
        )
      )
      .limit(1);
    if (!member) return deny(notFound());
  }

  return { ok: true, storageUrl: doc.storageUrl };
}
