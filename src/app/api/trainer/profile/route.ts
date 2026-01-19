import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import {
  profiles,
  courses,
  quizSubmissions,
  reflections,
  useCaseSubmissions,
  activityLog,
  enablers,
  useCases,
  lernfelderSchema,
} from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Get ALL trainees (role = TRAINEE) - either assigned to this trainer or all trainees
    const assignedTrainees = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.role, 'TRAINEE'), eq(profiles.assignedTrainerId, trainerId)));

    // If no assigned trainees, get all trainees as fallback
    let traineeRows = assignedTrainees;
    if (traineeRows.length === 0) {
      traineeRows = await db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.role, 'TRAINEE'));
    }
    const traineeIds = traineeRows.map(t => t.id);

    // Count all trainees in the system (for display purposes)
    const [{ c: allTraineesCount = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(profiles)
      .where(eq(profiles.role, 'TRAINEE'));

    // Active courses created by this trainer
    const [{ c: activeCourses = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(courses)
      .where(and(eq(courses.createdById, trainerId), eq(courses.isActive, true)));

    // Total courses created by this trainer
    const [{ c: totalCourses = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(courses)
      .where(eq(courses.createdById, trainerId));

    // If trainer has no courses, count all courses as fallback
    let displayCourses = Number(totalCourses);
    let displayActiveCourses = Number(activeCourses);
    if (displayCourses === 0) {
      const [{ c: allCourses = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(courses);
      displayCourses = Number(allCourses);

      const [{ c: allActiveCourses = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(courses)
        .where(eq(courses.isActive, true));
      displayActiveCourses = Number(allActiveCourses);
    }

    // Total Enablers (Lessons) - belonging to courses created by trainer or all
    let [{ c: totalEnablers = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(enablers)
      .innerJoin(courses, eq(enablers.courseId, courses.id))
      .where(eq(courses.createdById, trainerId));

    if (Number(totalEnablers) === 0) {
      const [{ c: allEnablers = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(enablers);
      totalEnablers = allEnablers;
    }

    // Total Use Cases - belonging to courses created by trainer or all
    let [{ c: totalUseCases = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(useCases)
      .innerJoin(courses, eq(useCases.courseId, courses.id))
      .where(eq(courses.createdById, trainerId));

    if (Number(totalUseCases) === 0) {
      const [{ c: allUseCases = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(useCases);
      totalUseCases = allUseCases;
    }

    // Total Lernfelder (global count)
    const [{ c: totalLernfelder = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(lernfelderSchema);

    // Pending reviews
    let pendingReviews = 0;
    let pendingQuizzes = 0;
    let pendingReflections = 0;
    let pendingUseCases = 0;

    // Count all pending reviews (not just from assigned trainees)
    const [{ c: pq = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(quizSubmissions)
      .where(eq(quizSubmissions.isReviewed, false));
    pendingQuizzes = Number(pq);

    const [{ c: pr = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(reflections)
      .where(eq(reflections.isReviewed, false));
    pendingReflections = Number(pr);

    const [{ c: pu = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(useCaseSubmissions)
      .where(eq(useCaseSubmissions.status, 'PENDING'));
    pendingUseCases = Number(pu);

    pendingReviews = pendingQuizzes + pendingReflections + pendingUseCases;

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
      .orderBy(desc(activityLog.createdAt))
      .limit(10);

    // Map user IDs to names
    const userMap = new Map<string, string>();
    traineeRows.forEach(t => userMap.set(t.id, t.fullName || 'Unbekannt'));

    let recentActivities = activityRows.map(a => ({
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
      .where(gte(activityLog.createdAt, lastWeek));
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

      // Get recent reflections
      const refSubs = await db
        .select({
          id: reflections.id,
          traineeId: reflections.traineeId,
          createdAt: reflections.createdAt,
        })
        .from(reflections)
        .orderBy(desc(reflections.createdAt))
        .limit(5);

      refSubs.forEach(r => {
        recentSubmissions.push({
          id: r.id,
          userFullName: userMap.get(r.traineeId) || 'Azubi',
          activityType: 'REFLECTION_SUBMITTED',
          createdAt: r.createdAt,
          details: 'Reflexion eingereicht',
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
        trainees: Number(allTraineesCount) || traineeIds.length,
        activeCourses: displayActiveCourses,
        totalCourses: displayCourses,
        totalEnablers: Number(totalEnablers) || 0,
        totalUseCases: Number(totalUseCases) || 0,
        totalLernfelder: Number(totalLernfelder) || 0,
        pendingReviews,
        pendingQuizzes,
        pendingReflections,
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
    'REFLECTION_SUBMITTED': 'Reflexion eingereicht',
    'USECASE_STARTED': 'Use Case gestartet',
    'USECASE_SUBMITTED': 'Use Case abgegeben',
    'COURSE_STARTED': 'Kurs gestartet',
    'COURSE_COMPLETED': 'Kurs abgeschlossen',
  };
  return descriptions[activityType] || activityType;
}
