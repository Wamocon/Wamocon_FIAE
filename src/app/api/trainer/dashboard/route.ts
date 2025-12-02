import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, inArray, gt } from 'drizzle-orm';
import {
  profiles,
  courses,
  courseMembers,
  enablers,
  enablerCompletions,
  enablerSubmissions,
  quizSubmissions,
  reflections,
  useCaseSubmissions,
  enablerQuizLinks,
} from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // With new schema, profiles.id equals Supabase auth user id
    const trainerId = searchParams.get('trainerProfileId') || searchParams.get('trainerAuthId');
    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainer id' }, { status: 400 });
    }

    // Discover courses the trainer owns or co-teaches
    const createdCourses = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.createdById, trainerId));
    const memberCourses = await db
      .select({ courseId: courseMembers.courseId })
      .from(courseMembers)
      .where(and(eq(courseMembers.userId, trainerId), eq(courseMembers.role, 'TRAINER')));
    const courseIds = Array.from(
      new Set([
        ...createdCourses.map((c) => String(c.id)),
        ...memberCourses.map((m) => String(m.courseId)),
      ])
    );

    // Trainees either directly assigned to this trainer OR enrolled in their courses
    const directlyAssigned = await db
      .select({ id: profiles.id, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl })
      .from(profiles)
      .where(and(eq(profiles.role, 'TRAINEE'), eq(profiles.assignedTrainerId, trainerId)));

    let courseTraineeIds: string[] = [];
    if (courseIds.length > 0) {
      const courseTrainees = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(inArray(courseMembers.courseId, courseIds), eq(courseMembers.role, 'TRAINEE')));
      courseTraineeIds = courseTrainees.map(t => String(t.userId));
    }
    const traineeIdSet = new Set<string>([
      ...directlyAssigned.map(t => String(t.id)),
      ...courseTraineeIds,
    ]);
    const traineeIds = Array.from(traineeIdSet);

    // Build full trainee objects (merge assigned list with any extra from course members)
    let traineeRows = directlyAssigned;
    if (traineeIds.length > directlyAssigned.length) {
      const missingIds = traineeIds.filter(id => !directlyAssigned.some(t => String(t.id) === id));
      if (missingIds.length) {
        const extras = await db
          .select({ id: profiles.id, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl })
          .from(profiles)
          .where(inArray(profiles.id, missingIds as any));
        traineeRows = [...directlyAssigned, ...extras];
      }
    }

    // Enablers under trainer's courses (owned or co-taught)
    const trainerEnablers = courseIds.length
      ? await db
          .select({ id: enablers.id })
          .from(enablers)
          .where(inArray(enablers.courseId, courseIds as any))
      : [];
    const enablerIds = trainerEnablers.map((e) => e.id);

    // Progress per trainee = completed enablers / total enablers
    let totalEnablers = enablerIds.length;
    const completedMap = new Map<string, number>();
    if (totalEnablers > 0 && traineeIds.length > 0) {
      const rows = await db
        .select({ traineeId: enablerCompletions.traineeId, c: count() })
        .from(enablerCompletions)
        .where(and(inArray(enablerCompletions.enablerId, enablerIds), inArray(enablerCompletions.traineeId, traineeIds)))
        .groupBy(enablerCompletions.traineeId);
      rows.forEach(r => completedMap.set(String(r.traineeId), Number(r.c)));
    }
    const trainees = traineeRows.map(t => {
      const completed = completedMap.get(String(t.id)) || 0;
      const pct = totalEnablers > 0 ? Math.round((completed / totalEnablers) * 100) : 0;
      return { id: t.id, full_name: t.fullName, avatar_url: t.avatarUrl, progress: pct };
    });

    // Pending reviews: unreviewed quiz submissions + reflections + pending use case submissions + pending enabler submissions
    let pendingQuiz = 0,
      pendingRefl = 0,
      pendingUseCases = 0,
      pendingEnablers = 0,
      pendingLessonQuiz = 0;
    if (traineeIds.length > 0) {
      const [{ c: pq } = { c: 0 }] = await db
        .select({ c: count() })
        .from(quizSubmissions)
        .where(and(eq(quizSubmissions.isReviewed, false), inArray(quizSubmissions.traineeId, traineeIds)));
      pendingQuiz = Number(pq) || 0;

      // Lesson quiz (multi-difficulty) pending subset where quiz has lesson link
      const [{ c: plq } = { c: 0 }] = await db
        .select({ c: count() })
        .from(quizSubmissions)
        .innerJoin(enablerQuizLinks, eq(quizSubmissions.quizId, enablerQuizLinks.quizId))
        .where(and(eq(quizSubmissions.isReviewed, false), inArray(quizSubmissions.traineeId, traineeIds)));
      pendingLessonQuiz = Number(plq) || 0;

      const [{ c: pr } = { c: 0 }] = await db
        .select({ c: count() })
        .from(reflections)
        .where(and(eq(reflections.isReviewed, false), inArray(reflections.traineeId, traineeIds)));
      pendingRefl = Number(pr) || 0;

      const [{ c: pu } = { c: 0 }] = await db
        .select({ c: count() })
        .from(useCaseSubmissions)
        .where(and(eq(useCaseSubmissions.status, 'PENDING'), inArray(useCaseSubmissions.traineeId, traineeIds)));
      pendingUseCases = Number(pu) || 0;

      const [{ c: pe } = { c: 0 }] = await db
        .select({ c: count() })
        .from(enablerSubmissions)
        .where(and(eq(enablerSubmissions.status, 'PENDING'), inArray(enablerSubmissions.traineeId, traineeIds)));
      pendingEnablers = Number(pe) || 0;
    }
    const pendingReviews = pendingQuiz + pendingRefl + pendingUseCases + pendingEnablers;

    // Recent reflections (last 7 days)
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const [{ c: recentReflections = 0 } = { c: 0 }] = traineeIds.length
      ? await db
          .select({ c: count() })
          .from(reflections)
          .where(and(inArray(reflections.traineeId, traineeIds), gt(reflections.createdAt, lastWeek)))
      : [{ c: 0 }];

    // Progress trend: count enabler completions and quiz submissions per week bucket for last 6 weeks
    const weeks = 6;
    const trendBuckets: { week: string; progress: number }[] = [];
    for (let i = weeks - 1; i >= 0; i--) trendBuckets.push({ week: `W${weeks - i}`, progress: 0 });
    if (traineeIds.length > 0) {
      const compRows = await db
        .select({ at: enablerCompletions.completedAt })
        .from(enablerCompletions)
        .where(inArray(enablerCompletions.traineeId, traineeIds))
        .orderBy(desc(enablerCompletions.completedAt));
      const subRows = await db
        .select({ at: quizSubmissions.submittedAt })
        .from(quizSubmissions)
        .where(inArray(quizSubmissions.traineeId, traineeIds))
        .orderBy(desc(quizSubmissions.submittedAt));
      const now = new Date();
      const addToBuckets = (date: Date | null) => {
        if (!date) return;
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        const bucketIndex = Math.floor(diffDays / 7);
        if (bucketIndex >= 0 && bucketIndex < weeks) {
          const idx = weeks - 1 - bucketIndex;
          trendBuckets[idx].progress += 1;
        }
      };
      compRows.forEach((r) => addToBuckets(r.at ?? null));
      subRows.forEach((r) => addToBuckets(r.at ?? null));
    }
    const maxVal = trendBuckets.reduce((m, b) => Math.max(m, b.progress), 0) || 1;
    const progressTrend = trendBuckets.map((b) => ({ week: b.week, progress: Math.round((b.progress / maxVal) * 100) }));

    // Module progress chart -> use Courses (modules) as units across trainees
    // For each course: count trainees that completed all enablers, in progress, not started
    const trainerCourses = courseIds.length
      ? await db
          .select({ id: courses.id, title: courses.title })
          .from(courses)
          .where(inArray(courses.id, courseIds as any))
      : [];

    // How many enablers per course
    const enablerCounts = courseIds.length
      ? await db
          .select({ courseId: enablers.courseId, c: count() })
          .from(enablers)
          .where(inArray(enablers.courseId, courseIds as any))
          .groupBy(enablers.courseId)
      : [];
    const courseEnablerTotal = new Map<string, number>();
    enablerCounts.forEach((row: any) => {
      courseEnablerTotal.set(String(row.courseId), Number(row.c) || 0);
    });

    // Completions by trainee and course
    let compByCourseAndTrainee = new Map<string, Map<string, number>>();
    if (courseIds.length && traineeIds.length) {
      const compRows = await db
        .select({
          traineeId: enablerCompletions.traineeId,
          courseId: enablers.courseId,
          c: count(),
        })
        .from(enablerCompletions)
        .innerJoin(enablers, eq(enablerCompletions.enablerId, enablers.id))
        .where(and(inArray(enablers.courseId, courseIds as any), inArray(enablerCompletions.traineeId, traineeIds)))
        .groupBy(enablerCompletions.traineeId, enablers.courseId);

      compRows.forEach((r: any) => {
        const courseId = String(r.courseId);
        const traineeId = String(r.traineeId);
        if (!compByCourseAndTrainee.has(courseId)) compByCourseAndTrainee.set(courseId, new Map());
        compByCourseAndTrainee.get(courseId)!.set(traineeId, Number(r.c) || 0);
      });
    }

    const moduleProgress: { name: string; completed: number; inProgress: number; notStarted: number }[] = [];
    for (const course of trainerCourses) {
      const totalEnabs = courseEnablerTotal.get(String(course.id)) || 0;
      let completed = 0;
      let inProgress = 0;
      let notStarted = 0;

      if (traineeIds.length === 0) {
        // No trainees -> nothing started
        notStarted = 0;
      } else if (totalEnabs === 0) {
        // No enablers in course -> treat as not started for all trainees
        notStarted = traineeIds.length;
      } else {
        const map = compByCourseAndTrainee.get(String(course.id)) || new Map<string, number>();
        for (const tId of traineeIds) {
          const done = map.get(String(tId)) || 0;
          if (done === 0) notStarted += 1;
          else if (done >= totalEnabs) completed += 1;
          else inProgress += 1;
        }
      }

      moduleProgress.push({ name: String(course.title ?? ''), completed, inProgress, notStarted });
    }

    return NextResponse.json({
      trainees,
      counts: {
        activeTrainees: trainees.length,
        pendingReviews,
        pendingQuiz,
        pendingLessonQuiz,
        pendingReflections: pendingRefl,
        pendingEnablers,
        pendingUseCases,
        recentReflections: Number(recentReflections) || 0,
      },
      charts: { progressTrend, moduleProgress },
    });
  } catch (e) {
    console.error('Trainer dashboard API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
