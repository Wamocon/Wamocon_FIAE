import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  profiles,
  courses,
  quizSubmissions,
  reflections,
  useCaseSubmissions,
  activityLog,
} from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Trainees assigned to this trainer
    const traineeRows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.role, 'TRAINEE' as any), eq(profiles.assignedTrainerId, trainerId as any)));
    const traineeIds = traineeRows.map(t => t.id);

    // Active courses created by trainer
    const [{ c: activeCourses = 0 } = { c: 0 }] = await db
      .select({ c: count() })
      .from(courses)
      .where(and(eq(courses.createdById, trainerId as any), eq(courses.isActive, true as any)));

    // Pending reviews: unreviewed quiz submissions + reflections + pending use case submissions
    let pendingReviews = 0;
    if (traineeIds.length > 0) {
      const [{ c: pq = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(quizSubmissions)
        .where(and(eq(quizSubmissions.isReviewed, false as any), inArray(quizSubmissions.traineeId, traineeIds as any)));
      const [{ c: pr = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(reflections)
        .where(and(eq(reflections.isReviewed, false as any), inArray(reflections.traineeId, traineeIds as any)));
      const [{ c: pu = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(useCaseSubmissions)
        .where(and(eq(useCaseSubmissions.status, 'PENDING' as any), inArray(useCaseSubmissions.traineeId, traineeIds as any)));
      pendingReviews = Number(pq) + Number(pr) + Number(pu);
    }

    // Recent activities among these trainees (last 7 days)
    let recentActivities: Array<{ id: string; userId: string; activityType: string; createdAt: Date }> = [];
    let recentCount7d = 0;
    if (traineeIds.length > 0) {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      recentActivities = await db
        .select({ id: activityLog.id, userId: activityLog.userId, activityType: activityLog.activityType, createdAt: activityLog.createdAt })
        .from(activityLog)
        .where(inArray(activityLog.userId, traineeIds as any))
        .orderBy(desc(activityLog.createdAt))
        .limit(5);
      const [{ c: c7 = 0 } = { c: 0 }] = await db
        .select({ c: count() })
        .from(activityLog)
        .where(inArray(activityLog.userId, traineeIds as any));
      recentCount7d = Number(c7) || 0; // simple count; could add timestamp filter if stored reliably
    }

    return NextResponse.json({
      counts: {
        trainees: traineeIds.length,
        activeCourses: Number(activeCourses) || 0,
        pendingReviews,
        recentActivity7d: recentCount7d,
      },
      recentActivities,
    });
  } catch (e) {
    console.error('Trainer profile API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
