import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import {
  profiles,
  courses,
  quizSubmissions,
  useCaseSubmissions,
  activityLog,
  enablers,
  useCases,
  trainingCatalogLearningFields,
} from '@/db/migrations/schemas/schema';
import {
  requireTraineeScopeCondition,
  traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';
import { catalogCondition, requireCatalogScope } from '@/lib/catalog/scope';

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

    // Recent activity from activity_log (last 7 days)
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get recent activities from activity log
    const activityRows = await db
      .select({
        id: activityLog.id,
        odaUserId: activityLog.userId,
        activityType: activityLog.activityType,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(traineeIdInScope(activityLog.userId, traineeScope.condition))
      .orderBy(desc(activityLog.createdAt))
      .limit(10);

    // Map user IDs to names
    const userMap = new Map<string, string>();
    traineeRows.forEach(t => userMap.set(t.id, t.fullName || 'Unbekannt'));

    const recentActivities = activityRows.map(a => ({
      id: a.id,
      odaUserId: a.odaUserId,
      userFullName: a.odaUserId ? userMap.get(a.odaUserId) || 'Azubi' : 'Azubi',
      activityType: a.activityType,
      createdAt: a.createdAt,
      details: getActivityDescription(a.activityType),
    }));

    // Count activities in last 7 days
    const [{ c: c7 = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(activityLog)
      .where(
        and(
          gte(activityLog.createdAt, lastWeek),
          traineeIdInScope(activityLog.userId, traineeScope.condition)
        )
      );
    let recentCount7d = Number(c7) || 0;

    // If no activity log entries, get recent submissions instead
    if (recentActivities.length === 0) {
      let recentSubmissions: Array<{ id: string; userFullName: string; activityType: string; createdAt: Date | null; details: string }> = [];

      // Get recent quiz submissions
      const quizSubs = await db
        .select({
          id: quizSubmissions.id,
          traineeId: quizSubmissions.traineeId,
          createdAt: quizSubmissions.submittedAt,
          score: quizSubmissions.score,
        })
        .from(quizSubmissions)
        .where(
          traineeIdInScope(quizSubmissions.traineeId, traineeScope.condition)
        )
        .orderBy(desc(quizSubmissions.submittedAt))
        .limit(5);

      quizSubs.forEach(q => {
        recentSubmissions.push({
          id: q.id,
          userFullName: userMap.get(q.traineeId) || 'Azubi',
          activityType: 'QUIZ_SUBMITTED',
          createdAt: q.createdAt,
          details: `Quiz abgegeben (${q.score ?? 0}%)`,
        });
      });

      // Get recent use case submissions
      const ucSubs = await db
        .select({
          id: useCaseSubmissions.id,
          traineeId: useCaseSubmissions.traineeId,
          createdAt: useCaseSubmissions.submittedAt,
          status: useCaseSubmissions.status,
        })
        .from(useCaseSubmissions)
        .where(
          traineeIdInScope(useCaseSubmissions.traineeId, traineeScope.condition)
        )
        .orderBy(desc(useCaseSubmissions.submittedAt))
        .limit(5);

      ucSubs.forEach(u => {
        recentSubmissions.push({
          id: u.id,
          userFullName: userMap.get(u.traineeId) || 'Azubi',
          activityType: 'USECASE_SUBMITTED',
          createdAt: u.createdAt,
          details: `Use Case Abgabe (${u.status})`,
        });
      });

      // Sort by date and take top 10
      recentSubmissions.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

      recentSubmissions = recentSubmissions.slice(0, 10);

      // Update activity count based on submissions
      if (recentCount7d === 0) {
        recentCount7d = recentSubmissions.length;
      }
    }

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
        recentActivity7d: recentCount7d,
      },
      recentActivities,
    });
  } catch (e) {
    console.error('Trainer profile API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function getActivityDescription(activityType: string): string {
  const descriptions: Record<string, string> = {
    'LOGIN': 'Anmeldung',
    'LOGOUT': 'Abmeldung',
    'QUIZ_STARTED': 'Quiz gestartet',
    'QUIZ_SUBMITTED': 'Quiz abgegeben',
    'QUIZ_COMPLETED': 'Quiz abgeschlossen',
    'LESSON_STARTED': 'Lektion gestartet',
    'LESSON_COMPLETED': 'Lektion abgeschlossen',
    'USECASE_STARTED': 'Use Case gestartet',
    'USECASE_SUBMITTED': 'Use Case abgegeben',
    'COURSE_STARTED': 'Kurs gestartet',
    'COURSE_COMPLETED': 'Kurs abgeschlossen',
  };
  return descriptions[activityType] || activityType;
}
