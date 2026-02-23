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
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

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

    const cached = await apiCache.getOrFetch(
      `trainer_trainees_${trainerId}`,
      async () => {
        // List ALL trainees regardless of assigned trainer
        const traineeRows = await db
          .select({
            id: profiles.id,
            fullName: profiles.fullName,
            firstName: profiles.firstName,
            lastName: profiles.lastName,
            email: profiles.email,
            avatarUrl: profiles.avatarUrl,
            isActive: profiles.isActive,
          })
          .from(profiles)
          .where(eq(profiles.role, 'TRAINEE'));

        const traineeIds = traineeRows.map(t => String(t.id));

        // Phase 2: memberships + completions in parallel where possible
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

        // Phase 3: enablers + completions can overlap if we fetch enablers first
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

        return {
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
              avatar_url: t.avatarUrl,
              progress: pct,
              coursesCount: courseIdsForTrainee.length,
              isActive: Boolean(t.isActive),
            };
          }),
        };
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(cached, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('List trainer trainees error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
