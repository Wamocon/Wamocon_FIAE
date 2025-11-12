import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { profiles, reflections, courses, courseMembers } from '@/db/migrations/schemas/schema';

// GET /api/trainer/reflections?trainerProfileId=...
// Returns reflections for all trainees assigned to this trainer, newest first, plus summary counts.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerProfileId = searchParams.get('trainerProfileId');
    if (!trainerProfileId) {
      return NextResponse.json({ error: 'Missing trainerProfileId' }, { status: 400 });
    }

    // Primary set: trainees assigned directly to this trainer
    const assignedTrainees = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.role, 'TRAINEE'), eq(profiles.assignedTrainerId, trainerProfileId)));

    // Fallback/union: trainees who are members (TRAINEE) of courses the trainer owns or co-teaches
    const createdCourses = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.createdById, trainerProfileId));
    const trainerMemberCourses = await db
      .select({ courseId: courseMembers.courseId })
      .from(courseMembers)
      .where(and(eq(courseMembers.userId, trainerProfileId), eq(courseMembers.role, 'TRAINER')));
    const courseIds = Array.from(
      new Set([...
        createdCourses.map(c => String(c.id)),
        ...trainerMemberCourses.map(m => String(m.courseId)),
      ]),
    );

    let courseTraineeIds: string[] = [];
    if (courseIds.length > 0) {
      const courseTrainees = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(inArray(courseMembers.courseId, courseIds), eq(courseMembers.role, 'TRAINEE')));
      courseTraineeIds = courseTrainees.map(t => String(t.userId));
    }

    // Combine assigned and course-based trainee IDs
    const traineeIds = Array.from(new Set([...
      assignedTrainees.map(t => String(t.id)),
      ...courseTraineeIds,
    ]));

    if (traineeIds.length === 0) {
      return NextResponse.json({ reflections: [], summary: { total: 0, reviewed: 0, unread: 0 } });
    }

    const rows = await db
      .select({
        id: reflections.id,
        traineeId: reflections.traineeId,
        strengths: reflections.strengths,
        weaknesses: reflections.weaknesses,
        mesMore: reflections.mesMore,
        mesEqual: reflections.mesEqual,
        isReviewed: reflections.isReviewed,
        reviewedById: reflections.reviewedById,
        createdAt: reflections.createdAt,
        traineeName: profiles.fullName,
      })
    .from(reflections)
    .innerJoin(profiles, eq(reflections.traineeId, profiles.id))
    .where(inArray(reflections.traineeId, traineeIds as any))
      .orderBy(desc(reflections.createdAt))
      .limit(200);

    const total = rows.length;
    const reviewed = rows.filter(r => r.isReviewed).length;
    const unread = total - reviewed;
    return NextResponse.json({ reflections: rows, summary: { total, reviewed, unread } });
  } catch (e) {
    console.error('Trainer reflections API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
