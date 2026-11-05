/**
 * Occupation (training catalog) of school exams (school_exams) and school
 * blocks (ausbildung_blocks).
 *
 * Both tables carry the occupation a row was written for
 * (training_catalog_id). A trainee in two trainings used to see the exams and
 * the calendar entries of BOTH occupations in every tab, because the routes
 * filtered by trainee_id only. The rule is the one of the activity reports
 * (requireReportCatalogFilter in src/lib/auth/activity-report-access.ts), built
 * on the same catalog scope (src/lib/catalog/scope.ts), nothing new:
 *
 *  - A trainee works in ONE occupation (x-catalog, otherwise the first
 *    enrollment). A trainee in several occupations is filtered by it, a trainee
 *    with one occupation is not filtered (all rows are of that occupation).
 *  - Trainer level without a chosen occupation is not filtered, with a choice
 *    (x-catalog or ?catalog) only the rows of that occupation count.
 *  - A new row gets the occupation of the tab. For a trainee that is the active
 *    occupation of the scope, for trainer level the chosen occupation (the
 *    trainee must belong to it, requireTraineeAccess checks that) or, without a
 *    choice, the default occupation of the trainee.
 *  - A single row of another chosen occupation is answered like a missing one.
 */

import { NextResponse } from 'next/server';
import { eq, type SQL } from 'drizzle-orm';
import db from '@/db';
import {
  ausbildungBlocks,
  schoolExams,
  traineeEnrollments,
} from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { isErrorResponse, type SessionUser } from '@/lib/auth/session';
import {
  FIAE_CATALOG_ID,
  catalogCondition,
  requestedCatalogCode,
  requireCatalogScope,
  type CatalogRequestLike,
} from '@/lib/catalog/scope';
import { firstEnrollment } from '@/lib/catalog/enrollments';

export type SchoolCatalogFilter = {
  /**
   * Condition on school_exams.training_catalog_id for a list, or null if
   * nothing is to be filtered (a single occupation without a choice, or
   * trainer level without a choice).
   */
  examCondition: SQL | null;
  /**
   * The same choice as a condition on ausbildung_blocks.training_catalog_id. It
   * is set exactly when `examCondition` is set.
   */
  blockCondition: SQL | null;
  /**
   * The occupation the caller works in, for the check of a single row. null
   * for trainer level without a choice.
   */
  catalogId: string | null;
};

/**
 * The occupation of a request for exams and blocks. Returns a ready-made error
 * response for a foreign occupation (403) or a scope that cannot be determined
 * (503).
 */
export async function requireSchoolCatalogFilter(
  session: SessionUser,
  request: CatalogRequestLike
): Promise<SchoolCatalogFilter | NextResponse> {
  if (session.isTrainerLevel && !requestedCatalogCode(request)) {
    return { examCondition: null, blockCondition: null, catalogId: null };
  }
  const scope = await requireCatalogScope(session, request);
  if (scope instanceof Response) return scope as NextResponse;
  return {
    examCondition: scope.selected
      ? catalogCondition(schoolExams.trainingCatalogId, scope)
      : null,
    blockCondition: scope.selected
      ? catalogCondition(ausbildungBlocks.trainingCatalogId, scope)
      : null,
    catalogId: scope.activeCatalogId,
  };
}

/**
 * null if the row is inside the occupation the caller chose (or nothing was
 * chosen), otherwise the answer for a missing row (`notFound`, the words of the
 * route) or the error of the occupation check (403, 503).
 */
export async function ensureSchoolRowInChosenCatalog(
  session: SessionUser,
  request: CatalogRequestLike,
  row: { trainingCatalogId: unknown },
  notFound: () => NextResponse
): Promise<NextResponse | null> {
  const filter = await requireSchoolCatalogFilter(session, request);
  if (isErrorResponse(filter)) return filter;
  if (
    filter.examCondition &&
    String(row.trainingCatalogId) !== filter.catalogId
  ) {
    return notFound();
  }
  return null;
}

/**
 * The occupation for a new exam or block: a ready-made error response or the
 * catalog id. A trainee gets the occupation of the tab. Trainer level gets the
 * chosen occupation (the route has checked with requireTraineeAccess that the
 * trainee belongs to it), without a choice the default occupation of the
 * trainee (the first enrollment, without one FIAE), never the one of the
 * trainer. Fails closed (503) if the occupation cannot be determined.
 */
export async function resolveSchoolWriteCatalog(
  session: SessionUser,
  request: CatalogRequestLike,
  traineeId: string
): Promise<string | NextResponse> {
  if (session.isTrainerLevel && !requestedCatalogCode(request)) {
    // The first enrollment of the trainee (the order of the catalog scope, see
    // firstEnrollment), without one FIAE
    try {
      const rows = (await withDbRetry(() =>
        db
          .select({
            trainingCatalogId: traineeEnrollments.trainingCatalogId,
            startDate: traineeEnrollments.startDate,
            createdAt: traineeEnrollments.createdAt,
          })
          .from(traineeEnrollments)
          .where(eq(traineeEnrollments.traineeId, traineeId as any))
      )) as {
        trainingCatalogId: unknown;
        startDate: string | null;
        createdAt?: Date | string | null;
      }[];
      const first = firstEnrollment(
        rows.map(r => ({
          ...r,
          trainingCatalogId: String(r.trainingCatalogId),
        }))
      );
      return first ? first.trainingCatalogId : FIAE_CATALOG_ID;
    } catch (err) {
      console.error('[school-catalog] enrollment lookup failed:', err);
      return NextResponse.json(
        { error: 'Catalog scope unavailable' },
        { status: 503 }
      );
    }
  }
  const scope = await requireCatalogScope(session, request);
  if (scope instanceof Response) return scope as NextResponse;
  return scope.activeCatalogId;
}
