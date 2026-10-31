// Who may touch the file of a submission, and the answers of the routes.
//
// Trainee routes: the session user, always. A traineeId in the query or body does not
// exist for them. The use case has to lie in the catalog (occupation) of the trainee,
// the trainee has to be a member of its course, the order of work has to allow it, and
// the submission must still be open for changes (none yet, or rejected by the trainer).
//
// Trainer route: the trainee of the submission has to lie in the organization and in the
// chosen occupation of the caller (requireTraineeAccess), and so does the use case.

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import db from '@/db';
import {
  courseMembers,
  enablers,
  useCaseSubmissions,
  useCases,
} from '@/db/migrations/schemas/schema';
import { isErrorResponse, type SessionUser } from '@/lib/auth/session';
import {
  ensureContentInScope,
  requireCatalogScope,
  requireContentScopeForUser,
  type CatalogRequestLike,
} from '@/lib/catalog/scope';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { requireEnablerOpen } from '@/lib/catalog/progression-db';
import { isUuid } from '@/lib/uuid';
import type { SubmissionScope } from '@/lib/submission-file/rules';
import {
  createSubmissionStorage,
  type SubmissionFileStorage,
} from '@/lib/submission-file/storage';
import type { ServiceResult } from '@/lib/submission-file/service';

const notFound = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404 });

/**
 * The scope of the file for the trainee in the session, or a ready-made response (401 and
 * 403 from the session, 404 for a use case outside of the occupation or an inactive one,
 * 403 without a course membership, the lock of the order of work, 409 when the submission
 * is no longer open for changes).
 */
export async function resolveTraineeScope(
  session: SessionUser,
  request: CatalogRequestLike,
  useCaseId: string,
  options: { forChange: boolean }
): Promise<SubmissionScope | NextResponse> {
  if (session.isTrainerLevel) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!isUuid(useCaseId)) return notFound();
  const traineeId = session.id;

  // The content must lie inside the catalog scope of the trainee
  const catalogScope = await requireContentScopeForUser(
    traineeId,
    request,
    'useCase',
    useCaseId
  );
  if (catalogScope instanceof Response) return catalogScope as NextResponse;

  const [useCase] = await db
    .select()
    .from(useCases)
    .where(eq(useCases.id, useCaseId as any));
  if (!useCase || !useCase.isActive) return notFound();

  const [member] = await db
    .select()
    .from(courseMembers)
    .where(
      and(
        eq(courseMembers.courseId, useCase.courseId as any),
        eq(courseMembers.userId, traineeId as any)
      )
    );
  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (useCase.enablerId) {
    const [owner] = await db
      .select({
        id: enablers.id,
        courseId: enablers.courseId,
        isActive: enablers.isActive,
      })
      .from(enablers)
      .where(eq(enablers.id, useCase.enablerId as any));
    if (owner && owner.isActive) {
      const locked = await requireEnablerOpen(traineeId, {
        id: String(owner.id),
        courseId: String(owner.courseId),
      });
      if (locked) return locked;
    }
  }

  if (options.forChange) {
    const [submission] = await db
      .select({ status: useCaseSubmissions.status })
      .from(useCaseSubmissions)
      .where(
        and(
          eq(useCaseSubmissions.useCaseId, useCaseId as any),
          eq(useCaseSubmissions.traineeId, traineeId as any)
        )
      );
    if (submission && submission.status !== 'REJECTED') {
      return NextResponse.json(
        {
          error: 'The submission can not be changed',
          code: 'SUBMISSION_LOCKED',
        },
        { status: 409 }
      );
    }
  }

  return {
    organizationId: session.organizationId,
    traineeId,
    useCaseId,
  };
}

/**
 * The scope of the file of a submission for a trainer-level caller, or a response. A
 * submission of a foreign organization or occupation answers like a missing one.
 */
export async function resolveTrainerScope(
  session: SessionUser,
  request: CatalogRequestLike,
  submissionId: string
): Promise<SubmissionScope | NextResponse> {
  if (!isUuid(submissionId)) {
    return NextResponse.json(
      { error: 'Submission not found' },
      { status: 404 }
    );
  }
  const [submission] = await db
    .select({
      traineeId: useCaseSubmissions.traineeId,
      useCaseId: useCaseSubmissions.useCaseId,
      organizationId: useCaseSubmissions.organizationId,
    })
    .from(useCaseSubmissions)
    .where(eq(useCaseSubmissions.id, submissionId as any));
  if (!submission) {
    return NextResponse.json(
      { error: 'Submission not found' },
      { status: 404 }
    );
  }
  const access = await requireTraineeAccess(
    session,
    String(submission.traineeId),
    request,
    'Submission not found'
  );
  if (isErrorResponse(access)) return access;

  const catalogScope = await requireCatalogScope(session, request);
  if (isErrorResponse(catalogScope)) return catalogScope;
  const denied = await ensureContentInScope(
    catalogScope,
    'useCase',
    String(submission.useCaseId)
  );
  if (denied) return denied;

  return {
    organizationId: String(submission.organizationId),
    traineeId: access.traineeId,
    useCaseId: String(submission.useCaseId),
  };
}

/** The storage of this deployment, or a 503 answer when it is not configured. */
export function openStorage(): SubmissionFileStorage | NextResponse {
  try {
    return createSubmissionStorage();
  } catch (error) {
    return storageFailure(error);
  }
}

/** The answer for a storage that failed: nothing of the cause reaches the client. */
export function storageFailure(error: unknown): NextResponse {
  const notConfigured =
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'SubmissionStorageError' &&
    (error as { code?: unknown }).code === 'NOT_CONFIGURED';
  console.error('Submission file storage error', error);
  return NextResponse.json(
    {
      error: notConfigured
        ? 'The file storage is not configured'
        : 'The file storage did not answer',
      code: notConfigured ? 'STORAGE_NOT_CONFIGURED' : 'STORAGE_ERROR',
    },
    { status: 503 }
  );
}

/** The answer of a service result. */
export function respond<T>(
  result: ServiceResult<T>,
  key: string
): NextResponse {
  return result.ok
    ? NextResponse.json({ [key]: result.value })
    : NextResponse.json(
        { error: result.code, code: result.code },
        { status: result.status }
      );
}
