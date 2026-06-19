import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import {
  profiles,
  enablers,
  enablerCompletions,
  courseMembers,
  activityReports,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId, verifyPlatformOwner, verifyTrainer } from '@/lib/auth-helpers';

/**
 * GET /api/trainer/trainees/with-stats
 *
 * Returns all trainees with their activity report stats in a SINGLE query.
 * This eliminates N+1 API calls pattern for better performance.
 *
 * Response includes:
 * - Basic trainee info
 * - Progress percentage
 * - Approved reports count
 * - Pending (submitted) reports count
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId =
      searchParams.get('trainerProfileId') || searchParams.get('trainerAuthId');

    if (!trainerId) {
      return NextResponse.json(
        { error: 'Missing trainer id' },
        { status: 400 }
      );
    }

    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const isPlatformOwnerUser = await verifyPlatformOwner(trainerId);
    const trainerOrgId = await getUserOrgId(trainerId);

    const traineeConditions = [eq(profiles.role, 'TRAINEE')];
    if (!isPlatformOwnerUser && trainerOrgId) {
      traineeConditions.push(eq(profiles.organizationId, trainerOrgId));
    }

    const traineeRows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
        avatarUrl: profiles.avatarUrl,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
        birthDate: profiles.birthDate,
      })
      .from(profiles)
      .where(and(...traineeConditions));

    const traineeIds = traineeRows.map(t => String(t.id));

    if (traineeIds.length === 0) {
      return NextResponse.json({ trainees: [] });
    }

    // Get activity report stats for ALL trainees in ONE query
    const reportStats = await db
      .select({
        traineeId: activityReports.traineeId,
        status: activityReports.status,
        reportCount: count(),
      })
      .from(activityReports)
      .where(inArray(activityReports.traineeId, traineeIds as any))
      .groupBy(activityReports.traineeId, activityReports.status);

    // Build a map of traineeId -> { approved, pending }
    const statsMap = new Map<string, { approved: number; pending: number }>();
    traineeIds.forEach(id => statsMap.set(id, { approved: 0, pending: 0 }));

    reportStats.forEach(row => {
      const tid = String(row.traineeId);
      const existing = statsMap.get(tid) || { approved: 0, pending: 0 };
      if (row.status === 'APPROVED') {
        existing.approved = Number(row.reportCount);
      } else if (row.status === 'SUBMITTED') {
        existing.pending = Number(row.reportCount);
      }
      statsMap.set(tid, existing);
    });

    // Get course memberships for progress calculation
    const memberships = await db
      .select({
        userId: courseMembers.userId,
        courseId: courseMembers.courseId,
      })
      .from(courseMembers)
      .where(
        and(
          inArray(courseMembers.userId, traineeIds as any),
          eq(courseMembers.role, 'TRAINEE')
        )
      );

    const traineeCourses = new Map<string, string[]>();
    memberships.forEach(m => {
      const uid = String(m.userId);
      const arr = traineeCourses.get(uid) || [];
      arr.push(String(m.courseId));
      traineeCourses.set(uid, arr);
    });

    const allCourseIds = Array.from(
      new Set(memberships.map(m => String(m.courseId)))
    );

    const enablerRows = allCourseIds.length
      ? await db
          .select({ courseId: enablers.courseId, id: enablers.id })
          .from(enablers)
          .where(inArray(enablers.courseId, allCourseIds as any))
      : [];

    const courseEnablers = new Map<string, string[]>();
    enablerRows.forEach(e => {
      const cid = String(e.courseId);
      const arr = courseEnablers.get(cid) || [];
      arr.push(String(e.id));
      courseEnablers.set(cid, arr);
    });

    // Get enabler completions
    const allEnablerIds = Array.from(
      new Set(enablerRows.map(e => String(e.id)))
    );
    const completedMap = new Map<string, number>();

    if (allEnablerIds.length > 0) {
      const rows = await db
        .select({ traineeId: enablerCompletions.traineeId, c: count() })
        .from(enablerCompletions)
        .where(
          and(
            inArray(enablerCompletions.enablerId, allEnablerIds as any),
            inArray(enablerCompletions.traineeId, traineeIds as any)
          )
        )
        .groupBy(enablerCompletions.traineeId);
      rows.forEach(r => completedMap.set(String(r.traineeId), Number(r.c)));
    }

    // Build final response
    const trainees = traineeRows.map(t => {
      const uid = String(t.id);
      const courseIdsForTrainee = traineeCourses.get(uid) || [];
      const enablerIdsForTrainee = courseIdsForTrainee.flatMap(
        cid => courseEnablers.get(cid) || []
      );
      const total = enablerIdsForTrainee.length;
      const completed = completedMap.get(uid) || 0;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const stats = statsMap.get(uid) || { approved: 0, pending: 0 };

      return {
        id: t.id,
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        full_name: t.fullName,
        avatar_url: t.avatarUrl,
        birth_date: t.birthDate ? new Date(t.birthDate).toISOString() : null,
        progress: pct,
        isActive: Boolean(t.isActive),
        approvedReports: stats.approved,
        pendingReports: stats.pending,
      };
    });

    return NextResponse.json({ trainees });
  } catch (e) {
    console.error('List trainees with stats error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
