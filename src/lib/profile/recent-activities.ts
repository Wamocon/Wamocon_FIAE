/**
 * "Letzte Aktivitäten" of the profile pages, from the data the trainees really
 * produce: finished lessons, quiz submissions and use case submissions.
 *
 * The same function serves the profile of a trainee (the own entries) and the
 * profile of a trainer or admin (the entries of the trainees inside the scope
 * of the caller). Every list is limited to the occupation of the read scope
 * (header x-catalog): a quiz, lesson or use case of the other occupation of a
 * trainee with two occupations does not show up on this tab.
 *
 * It replaces the activity_log as a source: that table is written for actions
 * of trainers and admins (releases, overrides), not for the work of trainees,
 * so a list of "trainee activity" built from it stayed empty.
 *
 * Only structured values leave this function (type, title, score, status), the
 * profile page turns them into texts of the translation system.
 */

import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import db from '@/db';
import {
  courses,
  enablerCompletions,
  enablers,
  quizSubmissions,
  quizzes,
  useCaseSubmissions,
  useCases,
} from '@/db/migrations/schemas/schema';
import { catalogCondition, type CatalogScope } from '@/lib/catalog/scope';

export type RecentActivityType =
  | 'LESSON_COMPLETED'
  | 'QUIZ_SUBMITTED'
  | 'USECASE_SUBMITTED';

export type RecentActivity = {
  id: string;
  /** Profile id of the trainee who did it. */
  traineeId: string;
  activityType: RecentActivityType;
  /** Title of the lesson, quiz or use case, null if it has none. */
  itemTitle: string | null;
  /** Quiz: score in percent, null while it is not graded. */
  score: number | null;
  /** Use case: review status (PENDING, APPROVED, ...). */
  status: string | null;
  createdAt: Date | null;
};

type Options = {
  /** Condition on the trainee column of a table (own id, or the trainees in scope). */
  traineeFilter: (column: PgColumn) => SQL;
  scope: CatalogScope;
  /** Number of entries to return. */
  limit?: number;
};

function time(value: Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

export async function loadRecentActivities({
  traineeFilter,
  scope,
  limit = 10,
}: Options): Promise<RecentActivity[]> {
  const [lessonRows, quizRows, useCaseRows] = await Promise.all([
    db
      .select({
        enablerId: enablerCompletions.enablerId,
        traineeId: enablerCompletions.traineeId,
        title: enablers.title,
        at: enablerCompletions.completedAt,
      })
      .from(enablerCompletions)
      .innerJoin(enablers, eq(enablerCompletions.enablerId, enablers.id))
      .innerJoin(courses, eq(enablers.courseId, courses.id))
      .where(
        and(
          traineeFilter(enablerCompletions.traineeId),
          catalogCondition(courses.trainingCatalogId, scope)
        )
      )
      .orderBy(desc(enablerCompletions.completedAt))
      .limit(limit),
    db
      .select({
        id: quizSubmissions.id,
        traineeId: quizSubmissions.traineeId,
        title: quizzes.title,
        score: quizSubmissions.score,
        at: quizSubmissions.submittedAt,
      })
      .from(quizSubmissions)
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .where(
        and(
          traineeFilter(quizSubmissions.traineeId),
          catalogCondition(quizzes.trainingCatalogId, scope)
        )
      )
      .orderBy(desc(quizSubmissions.submittedAt))
      .limit(limit),
    db
      .select({
        id: useCaseSubmissions.id,
        traineeId: useCaseSubmissions.traineeId,
        title: useCases.title,
        status: useCaseSubmissions.status,
        at: useCaseSubmissions.submittedAt,
      })
      .from(useCaseSubmissions)
      .innerJoin(useCases, eq(useCaseSubmissions.useCaseId, useCases.id))
      .where(
        and(
          traineeFilter(useCaseSubmissions.traineeId),
          catalogCondition(useCases.trainingCatalogId, scope)
        )
      )
      .orderBy(desc(useCaseSubmissions.submittedAt))
      .limit(limit),
  ]);

  const items: RecentActivity[] = [
    ...lessonRows.map(r => ({
      // The completion has no id of its own, its key is trainee plus lesson
      id: `${r.traineeId}:${r.enablerId}`,
      traineeId: String(r.traineeId),
      activityType: 'LESSON_COMPLETED' as const,
      itemTitle: r.title ?? null,
      score: null,
      status: null,
      createdAt: r.at ?? null,
    })),
    ...quizRows.map(r => ({
      id: String(r.id),
      traineeId: String(r.traineeId),
      activityType: 'QUIZ_SUBMITTED' as const,
      itemTitle: r.title ?? null,
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      status: null,
      createdAt: r.at ?? null,
    })),
    ...useCaseRows.map(r => ({
      id: String(r.id),
      traineeId: String(r.traineeId),
      activityType: 'USECASE_SUBMITTED' as const,
      itemTitle: r.title ?? null,
      score: null,
      status: r.status ? String(r.status) : null,
      createdAt: r.at ?? null,
    })),
  ];

  return items
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))
    .slice(0, limit);
}
