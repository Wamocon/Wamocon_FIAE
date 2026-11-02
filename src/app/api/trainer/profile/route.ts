import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq } from 'drizzle-orm';
import {
  profiles,
  courses,
  quizSubmissions,
  useCaseSubmissions,
  enablers,
  useCases,
  trainingCatalogLearningFields,
} from '@/db/migrations/schemas/schema';
import {
  requireTraineeScopeCondition,
  traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';
import { catalogCondition, requireCatalogScope } from '@/lib/catalog/scope';
import { loadRecentActivities } from '@/lib/profile/recent-activities';

export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const catalogScope = await requireCatalogScope(session, req);
    if (isErrorResponse(catalogScope)) return catalogScope;

    const trainerId = session.id;

    // Only trainees of the own organization (the super admin sees every one)
    // and, with a chosen occupation (x-catalog), of that occupation. Every
    // count and list below stays inside this scope.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

    // Get all trainees visible to this trainer through the organization scope.
    const traineeRows = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(traineeScope.condition);
    const traineeIds = traineeRows.map(t => t.id);

    // Active courses created by this trainer
    const [{ c: activeCourses = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(courses)
      .where(
        and(
          eq(courses.createdById, trainerId),
          eq(courses.isActive, true),
          catalogCondition(courses.trainingCatalogId, catalogScope)
        )
      );

    // Total courses created by this trainer
    const [{ c: totalCourses = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(courses)
      .where(and(eq(courses.createdById, trainerId), catalogCondition(courses.trainingCatalogId, catalogScope)));

    // If trainer has no courses, count all courses as fallback
    let displayCourses = Number(totalCourses);
    let displayActiveCourses = Number(activeCourses);
    if (displayCourses === 0) {
      const [{ c: allCourses = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(courses)
        .where(catalogCondition(courses.trainingCatalogId, catalogScope));
      displayCourses = Number(allCourses);

      const [{ c: allActiveCourses = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(courses)
        .where(and(eq(courses.isActive, true), catalogCondition(courses.trainingCatalogId, catalogScope)));
      displayActiveCourses = Number(allActiveCourses);
    }

    // Total Enablers (Lessons) - belonging to courses created by trainer or all
    let [{ c: totalEnablers = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(enablers)
      .innerJoin(courses, eq(enablers.courseId, courses.id))
      .where(and(eq(courses.createdById, trainerId), catalogCondition(courses.trainingCatalogId, catalogScope)));

    if (Number(totalEnablers) === 0) {
      const [{ c: allEnablers = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(enablers)
        .innerJoin(courses, eq(enablers.courseId, courses.id))
        .where(catalogCondition(courses.trainingCatalogId, catalogScope));
      totalEnablers = allEnablers;
    }

    // Total Use Cases - belonging to courses created by trainer or all
    let [{ c: totalUseCases = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(useCases)
      .innerJoin(courses, eq(useCases.courseId, courses.id))
      .where(and(eq(courses.createdById, trainerId), catalogCondition(courses.trainingCatalogId, catalogScope)));

    if (Number(totalUseCases) === 0) {
      const [{ c: allUseCases = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(useCases)
        .innerJoin(courses, eq(useCases.courseId, courses.id))
        .where(catalogCondition(courses.trainingCatalogId, catalogScope));
      totalUseCases = allUseCases;
    }

    // Total Lernfelder of the caller's catalogs
    const [{ c: totalLernfelder = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(trainingCatalogLearningFields)
      .where(
        catalogCondition(
          trainingCatalogLearningFields.trainingCatalogId,
          catalogScope
        )
      );

    // Pending reviews
    let pendingReviews = 0;
    let pendingQuizzes = 0;
    let pendingUseCases = 0;

    // Count the pending reviews of the trainees inside the scope
    const [{ c: pq = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(quizSubmissions)
      .where(
        and(
          eq(quizSubmissions.isReviewed, false),
          traineeIdInScope(quizSubmissions.traineeId, traineeScope.condition)
        )
      );
    pendingQuizzes = Number(pq);

    const [{ c: pu = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(useCaseSubmissions)
      .where(
        and(
          eq(useCaseSubmissions.status, 'PENDING'),
          traineeIdInScope(useCaseSubmissions.traineeId, traineeScope.condition)
        )
      );
    pendingUseCases = Number(pu);

    pendingReviews = pendingQuizzes + pendingUseCases;

    // Recent activities of the trainees inside the scope: what they really
    // did (finished lessons, quiz and use case submissions) in the occupation
    // of the caller. The activity_log is no source for this: it records the
    // actions of trainers and admins, so a list built from it stayed empty.
    const userMap = new Map<string, string>();
    traineeRows.forEach(t => userMap.set(t.id, t.fullName || ''));

    const activities = await loadRecentActivities({
      traineeFilter: column =>
        traineeIdInScope(column, traineeScope.condition),
      scope: catalogScope,
      limit: 10,
    });
    const recentActivities = activities.map(a => ({
      id: a.id,
      userId: a.traineeId,
      // An empty name is shown as "unknown" by the page (translated there)
      userFullName: userMap.get(a.traineeId) || null,
      activityType: a.activityType,
      itemTitle: a.itemTitle,
      score: a.score,
      status: a.status,
      createdAt: a.createdAt,
    }));

    return NextResponse.json({
      counts: {
        trainees: traineeIds.length,
        activeCourses: displayActiveCourses,
        totalCourses: displayCourses,
        totalEnablers: Number(totalEnablers) || 0,
        totalUseCases: Number(totalUseCases) || 0,
        totalLernfelder: Number(totalLernfelder) || 0,
        pendingReviews,
        pendingQuizzes,
        pendingUseCases,
      },
      recentActivities,
    });
  } catch (e) {
    console.error('Trainer profile API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
