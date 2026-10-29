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
 *  - Content: enabler and use case submissions of the courses of the trainer
 *    (created or TRAINER member) inside the catalog scope, quiz submissions of
 *    quizzes of the catalog scope.
 *  - Status: PENDING for enablers and use cases, not reviewed for quizzes.
 */

import { and, eq, inArray, type SQL } from 'drizzle-orm';
import {
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
