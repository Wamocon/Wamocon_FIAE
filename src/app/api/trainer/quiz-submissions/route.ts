import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { profiles, quizzes, quizSubmissions, enablerQuizLinks, enablers, courses, courseMembers } from '@/db/migrations/schemas/schema';
import { getTrainerScope } from '@/lib/trainer-scope';

// GET /api/trainer/quiz-submissions?trainerProfileId=...&onlyPending=true
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerProfileId = searchParams.get('trainerProfileId');
    const onlyPending = searchParams.get('onlyPending') === 'true';
    if (!trainerProfileId) return NextResponse.json({ error: 'Missing trainerProfileId' }, { status: 400 });

    const scope = await getTrainerScope(trainerProfileId);
    if (!scope) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const traineeConditions: any[] = [eq(profiles.role, 'TRAINEE' as any)];
    if (!scope.isPlatformOwner && scope.organizationId) {
      traineeConditions.push(eq(profiles.organizationId, scope.organizationId as any));
    } else if (!scope.isPlatformOwner) {
      traineeConditions.push(inArray(profiles.assignedTrainerId, scope.profileIds as any));
    }

    // Primary: all trainees in the trainer's organization
    const organizationTrainees = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(...traineeConditions));

    // Union with trainees from trainer's courses (created or co-trainer)
    const createdCourses = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.createdById, trainerProfileId as any));
    const trainerMemberCourses = await db
      .select({ courseId: courseMembers.courseId })
      .from(courseMembers)
      .where(and(eq(courseMembers.userId, trainerProfileId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const courseIds = Array.from(new Set([...
      createdCourses.map(c => String(c.id)),
      ...trainerMemberCourses.map(m => String(m.courseId)),
    ]));
    let courseTraineeIds: string[] = [];
    if (courseIds.length > 0) {
      const courseTrainees = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(inArray(courseMembers.courseId, courseIds as any), eq(courseMembers.role, 'TRAINEE' as any)));
      courseTraineeIds = courseTrainees.map(t => String(t.userId));
    }

    const traineeIds = Array.from(new Set([...
      organizationTrainees.map(t => String(t.id)),
      ...courseTraineeIds,
    ]));

    if (traineeIds.length === 0) return NextResponse.json({ submissions: [] });

    const rows = await db
      .select({
        id: quizSubmissions.id,
        traineeId: quizSubmissions.traineeId,
        quizId: quizSubmissions.quizId,
        score: quizSubmissions.score,
        isReviewed: quizSubmissions.isReviewed,
        submittedAt: quizSubmissions.submittedAt,
        attemptNumber: quizSubmissions.attemptNumber,
        traineeName: profiles.fullName,
        quizTitle: quizzes.title,
        quizType: quizzes.quizType,
        difficulty: enablerQuizLinks.difficulty,
        enablerTitle: enablers.title,
      })
      .from(quizSubmissions)
      .innerJoin(profiles, eq(quizSubmissions.traineeId, profiles.id))
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .leftJoin(enablerQuizLinks, eq(enablerQuizLinks.quizId, quizSubmissions.quizId))
      .leftJoin(enablers, eq(enablers.id, enablerQuizLinks.enablerId))
  .where(onlyPending
        ? and(inArray(quizSubmissions.traineeId, traineeIds as any), eq(quizSubmissions.isReviewed, false as any))
        : inArray(quizSubmissions.traineeId, traineeIds as any))
      .orderBy(desc(quizSubmissions.submittedAt))
      .limit(200);

    return NextResponse.json({ submissions: rows });
  } catch (e) {
    console.error('Trainer quiz submissions GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
