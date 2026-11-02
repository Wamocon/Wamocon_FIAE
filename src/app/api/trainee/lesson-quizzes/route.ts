import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray, max } from 'drizzle-orm';
import {
  courseMembers,
  courses,
  questions,
  quizSubmissions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  catalogCacheKey,
  catalogCondition,
  requireCatalogScopeForUser,
} from '@/lib/catalog/scope';
import {
  loadCourseProgressions,
  quizChainOf,
} from '@/lib/catalog/progression-db';
import { sortCourses } from '@/lib/catalog/course-order';

// GET the lesson quizzes (Niedrig, Mittel, Hoch of every Themenkreis) of the
// session user with status and result. The page "Quizze & Tests" lists them
// next to the global quizzes of /api/trainee/quizzes, so the page shows every
// quiz of the trainee. The quiz itself is taken on the page of its Themenkreis
// (gated by the order of work), this route only lists. It reads the same
// source as the course list: the courses of the occupation the trainee is in,
// the active Themenkreise and their active quizzes, the state of the order of
// work from loadCourseProgressions. A userId in the query is ignored.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const userId = session.id;

  try {
    const scope = await requireCatalogScopeForUser(userId, req);
    if (scope instanceof Response) return scope;

    // The tag "trainee_quizzes" is the one a quiz submission invalidates
    const data = await apiCache.getOrFetch(
      `trainee_quizzes_lesson_${userId}_${catalogCacheKey(scope)}`,
      async () => {
        const memberships = await db
          .select({ courseId: courseMembers.courseId })
          .from(courseMembers)
          .where(eq(courseMembers.userId, userId));
        const memberCourseIds = memberships.map(m => String(m.courseId));
        if (memberCourseIds.length === 0) return [];

        const courseRows = await db
          .select()
          .from(courses)
          .where(
            and(
              inArray(courses.id, memberCourseIds),
              eq(courses.isActive, true),
              catalogCondition(courses.trainingCatalogId, scope)
            )
          );
        if (courseRows.length === 0) return [];

        const progressions = await loadCourseProgressions(
          userId,
          courseRows.map(c => String(c.id))
        );

        type Entry = {
          quizId: string;
          difficulty: string;
          enablerId: string;
          enablerTitle: string;
          courseTitle: string;
          locked: boolean;
        };
        const entries: Entry[] = [];
        for (const course of sortCourses(courseRows)) {
          const loaded = progressions.get(String(course.id));
          if (!loaded) continue;
          const titleOf = new Map(
            loaded.enablers.map(e => [String(e.id), e.title])
          );
          // computeCourseProgression lists the active enablers in their order
          for (const enabler of loaded.progression.enablers) {
            for (const entry of quizChainOf(loaded, enabler.enablerId)) {
              entries.push({
                quizId: entry.quizId,
                difficulty: entry.difficulty,
                enablerId: enabler.enablerId,
                enablerTitle: titleOf.get(enabler.enablerId) ?? '',
                courseTitle: course.title,
                locked: enabler.locked,
              });
            }
          }
        }
        if (entries.length === 0) return [];

        const quizIds = Array.from(new Set(entries.map(e => e.quizId)));
        const [quizRows, questionCounts, submissionStats] = await Promise.all([
          db
            .select({ id: quizzes.id, title: quizzes.title })
            .from(quizzes)
            .where(inArray(quizzes.id, quizIds)),
          db
            .select({ quizId: questions.quizId, qCount: count() })
            .from(questions)
            .where(inArray(questions.quizId, quizIds))
            .groupBy(questions.quizId),
          db
            .select({
              quizId: quizSubmissions.quizId,
              maxScore: max(quizSubmissions.score),
              attempts: count(),
            })
            .from(quizSubmissions)
            .where(
              and(
                eq(quizSubmissions.traineeId, userId),
                inArray(quizSubmissions.quizId, quizIds)
              )
            )
            .groupBy(quizSubmissions.quizId),
        ]);
        const titleOfQuiz = new Map(quizRows.map(q => [String(q.id), q.title]));
        const questionsOf = new Map(
          questionCounts.map(r => [String(r.quizId), Number(r.qCount)])
        );
        const statsOf = new Map(
          submissionStats.map(r => [
            String(r.quizId),
            {
              bestScore: Number(r.maxScore) || 0,
              attempts: Number(r.attempts) || 0,
            },
          ])
        );

        return entries.map(e => {
          const stats = statsOf.get(e.quizId) ?? { bestScore: 0, attempts: 0 };
          return {
            id: e.quizId,
            kind: 'LESSON' as const,
            title: titleOfQuiz.get(e.quizId) ?? e.enablerTitle,
            difficulty: e.difficulty,
            enablerId: e.enablerId,
            enablerTitle: e.enablerTitle,
            courseTitle: e.courseTitle,
            locked: e.locked,
            bestScore: stats.bestScore,
            attempts: stats.attempts,
            questionsCount: questionsOf.get(e.quizId) ?? 0,
          };
        });
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(data, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('Lesson quizzes API error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
