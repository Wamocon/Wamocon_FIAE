/**
 * The one filter for the reviews a trainer still has to do. The dashboard
 * ("Aktion erforderlich") counts with it and the lists behind the card read
 * with it, so the number on the card is always the number of rows in the list.
 * Before, the count ran over every submission of the trainees in scope while
 * the list only showed the courses of the trainer and the quizzes of the
 * chosen occupation, so the card promised reviews the list did not contain.
 *
 * Three rules apply together:
 *  - Trainees: the trainees inside the scope of the caller (organization,
 *    chosen occupation, role), see src/lib/auth/trainee-scope-conditions.ts.
 *  - Content: enabler and use case submissions of every course inside the
 *    catalog scope (reviewableCourseIds), quiz submissions of quizzes of the
 *    catalog scope. A trainer does not need to have created a course or to be
 *    a member of it: the whole organization is reviewed (decision of the
 *    owner, WMCNL-2876). Before, a trainer who was neither creator nor TRAINER
 *    member of a course saw no submission of it and could not review.
 *  - Status: PENDING for enablers and use cases, not reviewed for quizzes.
 */

import { and, eq, inArray, type SQL } from 'drizzle-orm';
import db from '@/db';
import {
  courses,
  enablers,
  enablerSubmissions,
  quizSubmissions,
  quizzes,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';
import { traineeIdInScope } from '@/lib/auth/trainee-scope-conditions';
import { catalogCondition, type CatalogScope } from '@/lib/catalog/scope';

/**
 * The courses whose submissions a trainer may review: every course inside the
 * catalog scope. Which submissions that really shows is decided by the trainee
 * condition (organization, occupation, role), not by who created the course.
 */
export async function reviewableCourseIds(
  scope: CatalogScope
): Promise<string[]> {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(catalogCondition(courses.trainingCatalogId, scope));
  return rows.map(r => String(r.id));
}

/**
 * where() for enabler submissions. The query has to join `enablers` (the
 * course of the submission is the course of its enabler).
 */
export function enablerSubmissionsWhere(
  courseIds: string[],
  traineeCondition: SQL,
  onlyPending: boolean
): SQL | undefined {
  return and(
    inArray(enablers.courseId, courseIds as any),
    traineeIdInScope(enablerSubmissions.traineeId, traineeCondition),
    onlyPending ? eq(enablerSubmissions.status, 'PENDING') : undefined
  );
}

/** where() for use case submissions. The query has to join `use_cases`. */
export function submissionsOfUseCasesWhere(
  courseIds: string[],
  traineeCondition: SQL,
  onlyPending: boolean
): SQL | undefined {
  return and(
    inArray(useCases.courseId, courseIds as any),
    traineeIdInScope(useCaseSubmissions.traineeId, traineeCondition),
    onlyPending ? eq(useCaseSubmissions.status, 'PENDING') : undefined
  );
}

/** where() for quiz submissions. The query has to join `quizzes`. */
export function quizSubmissionsWhere(
  scope: CatalogScope,
  traineeCondition: SQL,
  onlyPending: boolean
): SQL | undefined {
  return and(
    traineeIdInScope(quizSubmissions.traineeId, traineeCondition),
    catalogCondition(quizzes.trainingCatalogId, scope),
    onlyPending ? eq(quizSubmissions.isReviewed, false as any) : undefined
  );
}
