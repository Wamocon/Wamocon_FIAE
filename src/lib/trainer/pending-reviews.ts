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

import { and, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import db from '@/db';
import {
  courses,
  profiles,
  enablerQuizLinks,
  enablers,
  enablerSubmissions,
  quizSubmissions,
  quizzes,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';
import { traineeIdInScope } from '@/lib/auth/trainee-scope-conditions';
import { catalogCondition, type CatalogScope } from '@/lib/catalog/scope';
import {
  COURSE_GLOBAL,
  type ReviewStatusFilter,
} from '@/lib/trainer/review-paging';

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
 * The status condition of a list. `true` is the old "only pending" flag, the
 * words are the filter of the list page (WMCNL-3002); `all` and `false` do not
 * limit.
 */
function statusCondition(
  column: typeof enablerSubmissions.status | typeof useCaseSubmissions.status,
  filter: boolean | ReviewStatusFilter
): SQL | undefined {
  if (filter === true || filter === 'pending') return eq(column, 'PENDING');
  if (filter === 'approved') return eq(column, 'APPROVED');
  if (filter === 'rejected') return eq(column, 'REJECTED');
  return undefined;
}

/**
 * where() for enabler submissions. The query has to join `enablers` (the
 * course of the submission is the course of its enabler).
 */
export function enablerSubmissionsWhere(
  courseIds: string[],
  traineeCondition: SQL,
  status: boolean | ReviewStatusFilter
): SQL | undefined {
  return and(
    inArray(enablers.courseId, courseIds as any),
    traineeIdInScope(enablerSubmissions.traineeId, traineeCondition),
    statusCondition(enablerSubmissions.status, status)
  );
}

/** where() for use case submissions. The query has to join `use_cases`. */
export function submissionsOfUseCasesWhere(
  courseIds: string[],
  traineeCondition: SQL,
  status: boolean | ReviewStatusFilter
): SQL | undefined {
  return and(
    inArray(useCases.courseId, courseIds as any),
    traineeIdInScope(useCaseSubmissions.traineeId, traineeCondition),
    statusCondition(useCaseSubmissions.status, status)
  );
}

/** The text of a search as a LIKE pattern: % and _ are plain characters. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

/**
 * where() for quiz submissions. The query has to join `quizzes`. A `search`
 * text (the quiz list, WMCNL-3001) also needs the join of `profiles` and
 * narrows the list to a trainee or a quiz whose name contains the text; the
 * dashboard counts without it. `quizType` limits the list to one kind of quiz
 * (the type filter of the page, so the total stays the total of the filter).
 * `course` limits it to the quizzes of one course (Fragenkomplex) or, with
 * `global`, to the global quizzes (WMCNL-3001).
 */
export function quizSubmissionsWhere(
  scope: CatalogScope,
  traineeCondition: SQL,
  onlyPending: boolean,
  search?: string | null,
  quizType?: 'LESSON' | 'GLOBAL' | null,
  course?: string | null
): SQL | undefined {
  const pattern = search ? likePattern(search) : null;
  return and(
    traineeIdInScope(quizSubmissions.traineeId, traineeCondition),
    catalogCondition(quizzes.trainingCatalogId, scope),
    onlyPending ? eq(quizSubmissions.isReviewed, false as any) : undefined,
    quizType ? eq(quizzes.quizType, quizType) : undefined,
    pattern
      ? or(ilike(profiles.fullName, pattern), ilike(quizzes.title, pattern))
      : undefined,
    courseCondition(scope, course)
  );
}

/**
 * A quiz of a lesson hangs on its course through the lesson (enabler) it is
 * linked to; the course has to lie inside the catalog scope, so a course of
 * another occupation never matches. A global quiz has no course.
 */
function courseCondition(
  scope: CatalogScope,
  course?: string | null
): SQL | undefined {
  if (!course) return undefined;
  if (course === COURSE_GLOBAL) return eq(quizzes.quizType, 'GLOBAL');
  return sql`${quizSubmissions.quizId} in (select ${enablerQuizLinks.quizId} from ${enablerQuizLinks} inner join ${enablers} on ${enablers.id} = ${enablerQuizLinks.enablerId} where ${enablers.courseId} = ${course} and ${catalogCondition(enablers.trainingCatalogId, scope)})`;
}

/**
 * The open reviews are listed newest first (WMCNL-2924). The database gives no
 * order without ORDER BY, so the lists are sorted by submission date; the id
 * breaks a tie so the order stays stable between two requests.
 */
export function newestFirst<T extends { id: unknown; submittedAt: unknown }>(
  rows: T[]
): T[] {
  const time = (v: unknown) => {
    const t = new Date(v as any).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return [...rows].sort(
    (a, b) =>
      time(b.submittedAt) - time(a.submittedAt) ||
      String(b.id).localeCompare(String(a.id))
  );
}
