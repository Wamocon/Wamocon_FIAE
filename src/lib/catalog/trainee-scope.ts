/**
 * Trainee lists per occupation (catalog): which trainees a trainer, admin or
 * super admin sees once they have chosen an occupation.
 *
 * A trainee belongs to the occupation of an enrollment (trainee_enrollments).
 * A trainee without any enrollment counts as FIAE, like in the catalog scope.
 * The caller chooses an occupation with the header `x-catalog` (or the query
 * parameter `catalog`), the scope validates it (403 for a foreign one).
 *
 * Without a choice nothing is filtered and nothing is asked: a trainer with a
 * single occupation (every FIAE trainer today) sees the trainees of the
 * organization exactly as before.
 */

import { NextResponse } from 'next/server';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import db from '@/db';
import { profiles, traineeEnrollments } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import {
  FIAE_CATALOG_ID,
  requestedCatalogCode,
  requireCatalogScope,
  type CatalogRequestLike,
  type CatalogScope,
  type CatalogSubject,
} from '@/lib/catalog/scope';

/**
 * Condition on `profiles` limiting the trainees to the chosen occupation, or
 * null if the caller chose none. exists() instead of a join, so a trainee with
 * several enrollments never shows up twice.
 */
export function traineeCatalogCondition(scope: CatalogScope): SQL | null {
  if (!scope.selected) return null;
  const enrolledInChosen = sql`exists (select 1 from ${traineeEnrollments} where ${traineeEnrollments.traineeId} = ${profiles.id} and ${traineeEnrollments.trainingCatalogId} = ${scope.activeCatalogId})`;
  if (scope.activeCatalogId !== FIAE_CATALOG_ID) return enrolledInChosen;
  const enrolledAnywhere = sql`exists (select 1 from ${traineeEnrollments} where ${traineeEnrollments.traineeId} = ${profiles.id})`;
  return sql`(${enrolledInChosen} or not ${enrolledAnywhere})`;
}

/**
 * The trainee condition for a request: `{ condition: null }` without a chosen
 * occupation (no query is made), the condition for a valid choice, or a
 * ready-made error response (403 for a foreign occupation, 503 fail closed).
 */
export async function requireTraineeCatalogFilter(
  session: CatalogSubject,
  request: CatalogRequestLike
): Promise<{ condition: SQL | null } | NextResponse> {
  if (!requestedCatalogCode(request)) return { condition: null };
  const scope = await requireCatalogScope(session, request);
  if (scope instanceof Response) return scope as NextResponse;
  return { condition: traineeCatalogCondition(scope) };
}

/**
 * 404 if the trainee does not belong to the occupation the caller chose,
 * otherwise null. Without a chosen occupation nothing is checked. The answer
 * is the same as for a missing trainee, so nothing is leaked.
 */
export async function ensureTraineeInCatalog(
  session: CatalogSubject,
  request: CatalogRequestLike,
  traineeId: string
): Promise<NextResponse | null> {
  const filter = await requireTraineeCatalogFilter(session, request);
  if (filter instanceof Response) return filter as NextResponse;
  if (!filter.condition) return null;

  let rows: { id: unknown }[];
  try {
    rows = await withDbRetry(() =>
      db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, traineeId as any), filter.condition!))
        .limit(1)
    );
  } catch (err) {
    console.error('[catalog-scope] trainee lookup failed:', err);
    return NextResponse.json(
      { error: 'Catalog scope unavailable' },
      { status: 503 }
    );
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
