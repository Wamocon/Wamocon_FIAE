import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, gte } from 'drizzle-orm';
import {
  courseMembers,
  courses,
  quizSubmissions,
  quizzes,
  useCaseSubmissions,
  useCases,
} from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  catalogCondition,
  requireCatalogScopeForUser,
} from '@/lib/catalog/scope';
import { loadCourseProgressions } from '@/lib/catalog/progression-db';
import { PASS_THRESHOLD } from '@/lib/catalog/progression';
import { loadRecentActivities } from '@/lib/profile/recent-activities';

/**
 * "Statistiken" and "Letzte Aktivitäten" of the profile of a trainee, from the
 * real data of the person (jira WMCNL-2964; the page showed fixed example
 * numbers before). Every figure is the one of the occupation of the chosen tab
 * (header x-catalog) and counts only the own entries of the session user, a
 * userId in the query is ignored.
 *
 * Only what the platform really records is counted: finished lessons (the one
 * definition of the dashboard, quizzes passed), passed quizzes and approved use
 * cases. There are no certificates and no learning hours on the platform, so
 * the profile shows none.
 */
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const userId = session.id;

  try {
    const scope = await requireCatalogScopeForUser(userId, req);
    if (scope instanceof Response) return scope;

    const memberCourses = await db
      .select({ id: courses.id })
      .from(courseMembers)
      .innerJoin(courses, eq(courseMembers.courseId, courses.id))
      .where(
        and(
          eq(courseMembers.userId, userId as any),
          eq(courseMembers.role, 'TRAINEE' as any),
          catalogCondition(courses.trainingCatalogId, scope)
        )
      );
    const courseIds = memberCourses.map(c => String(c.id));

    const [progressions, passedRows, approvedRows, activities] =
      await Promise.all([
        courseIds.length > 0
          ? loadCourseProgressions(userId, courseIds)
          : Promise.resolve(new Map()),
        db
          .select({ quizId: quizSubmissions.quizId })
          .from(quizSubmissions)
          .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
          .where(
            and(
              eq(quizSubmissions.traineeId, userId as any),
              gte(quizSubmissions.score, PASS_THRESHOLD),
              catalogCondition(quizzes.trainingCatalogId, scope)
            )
          ),
        db
          .select({ useCaseId: useCaseSubmissions.useCaseId })
          .from(useCaseSubmissions)
          .innerJoin(useCases, eq(useCaseSubmissions.useCaseId, useCases.id))
          .where(
            and(
              eq(useCaseSubmissions.traineeId, userId as any),
              eq(useCaseSubmissions.status, 'APPROVED'),
              catalogCondition(useCases.trainingCatalogId, scope)
            )
          ),
        loadRecentActivities({
          traineeFilter: column => eq(column, userId as any),
          scope,
          limit: 5,
        }),
      ]);

    let lessonsCompleted = 0;
    let lessonsTotal = 0;
    for (const p of progressions.values()) {
      lessonsCompleted += p.progression.completedCount;
      lessonsTotal += p.progression.totalCount;
    }

    return NextResponse.json({
      stats: {
        lessonsCompleted,
        lessonsTotal,
        // One quiz counts once, however often it was passed
        quizzesPassed: new Set(passedRows.map(r => String(r.quizId))).size,
        useCasesApproved: new Set(approvedRows.map(r => String(r.useCaseId)))
          .size,
      },
      recentActivities: activities.map(a => ({
        id: a.id,
        activityType: a.activityType,
        itemTitle: a.itemTitle,
        score: a.score,
        status: a.status,
        createdAt: a.createdAt,
      })),
    });
  } catch (e) {
    console.error('Trainee profile summary error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
