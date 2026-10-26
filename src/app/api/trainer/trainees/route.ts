import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import {
  profiles,
  enablers,
  courses,
  enablerCompletions,
  courseMembers,
} from '@/db/migrations/schemas/schema';
import { cacheHeaders } from '@/lib/api-cache';
import { requireTraineeScopeCondition } from '@/lib/auth/trainee-scope-conditions';

export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    // Only trainees of the own organization (the super admin sees every one)
    // and, with a chosen occupation (x-catalog), of that occupation. The
    // platform-owner flag of an organization does not widen the list.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

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
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        assignedTrainerId: profiles.assignedTrainerId,
      })
      .from(profiles)
      .where(traineeScope.condition);

    const traineeIds = traineeRows.map(t => String(t.id));

    const memberships = traineeIds.length
      ? await db
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
          )
      : [];

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

    const allEnablerIds = Array.from(
      new Set(enablerRows.map(e => String(e.id)))
    );
    const completedMap = new Map<string, number>();
    if (allEnablerIds.length > 0 && traineeIds.length > 0) {
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

    const response = {
      trainees: traineeRows.map(t => {
        const uid = String(t.id);
        const courseIdsForTrainee = traineeCourses.get(uid) || [];
        const enablerIdsForTrainee = courseIdsForTrainee.flatMap(
          cid => courseEnablers.get(cid) || []
        );
        const total = enablerIdsForTrainee.length;
        const completed = completedMap.get(uid) || 0;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return {
          id: t.id,
          firstName: t.firstName,
          lastName: t.lastName,
          email: t.email,
          full_name: t.fullName,
          fullName: t.fullName,
          avatar_url: t.avatarUrl,
          avatarUrl: t.avatarUrl,
          assignedTrainerId: t.assignedTrainerId,
          assigned_trainer_id: t.assignedTrainerId,
          ausbildungDurationYears: t.ausbildungDurationYears ?? 3,
          ausbildung_duration_years: t.ausbildungDurationYears ?? 3,
          progress: pct,
          coursesCount: courseIdsForTrainee.length,
          isActive: Boolean(t.isActive),
          trainerActivated: Boolean(t.trainerActivated),
        };
      }),
    };

    return NextResponse.json(response, { headers: cacheHeaders.none });
  } catch (e) {
    console.error('List trainer trainees error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
