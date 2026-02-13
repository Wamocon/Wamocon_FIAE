import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  profiles,
  courses,
  courseMembers,
  enablers,
  enablerCompletions,
  enablerSubmissions,
  quizSubmissions,
  useCaseSubmissions,
  enablerQuizLinks,
  quizzes,
  quizMembers,
  useCases,
  activityReports,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

// Passing score threshold
const PASS_THRESHOLD = 50;

async function fetchTrainerDashboardData(trainerId: string) {
  try {
    // ── Phase 1: Trainer + trainee lookups (3 queries) ──
    const [createdCourses, memberCoursesRaw, traineeRows] = await Promise.all([
      db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.createdById, trainerId)),
      db
        .select({ courseId: courseMembers.courseId })
        .from(courseMembers)
        .where(
          and(
            eq(courseMembers.userId, trainerId),
            eq(courseMembers.role, 'TRAINER')
          )
        ),
      db
        .select({
          id: profiles.id,
          fullName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
          isActive: profiles.isActive,
        })
        .from(profiles)
        .where(eq(profiles.role, 'TRAINEE')),
    ]);

    const courseIds = Array.from(
      new Set([
        ...createdCourses.map(c => String(c.id)),
        ...memberCoursesRaw.map(m => String(m.courseId)),
      ])
    );
    const traineeIds = traineeRows.map(t => String(t.id));
    const hasTrainees = traineeIds.length > 0;

    // ── Phase 2: courseId-dependent (4 queries) ──
    const [trainerEnablers, useCaseRows, trainerCourses, enablerCounts] =
      await Promise.all([
        courseIds.length
          ? db
              .select({ id: enablers.id, scenarios: enablers.scenarios })
              .from(enablers)
              .where(
                and(
                  inArray(enablers.courseId, courseIds as any),
                  eq(enablers.isActive, true)
                )
              )
          : Promise.resolve([]),
        courseIds.length
          ? db
              .select({ id: useCases.id, courseId: useCases.courseId })
              .from(useCases)
              .where(
                and(
                  inArray(useCases.courseId, courseIds as any),
                  eq(useCases.isActive, true)
                )
              )
          : Promise.resolve([]),
        courseIds.length
          ? db
              .select({ id: courses.id, title: courses.title })
              .from(courses)
              .where(inArray(courses.id, courseIds as any))
          : Promise.resolve([]),
        courseIds.length
          ? db
              .select({ courseId: enablers.courseId, c: count() })
              .from(enablers)
              .where(
                and(
                  inArray(enablers.courseId, courseIds as any),
                  eq(enablers.isActive, true)
                )
              )
              .groupBy(enablers.courseId)
          : Promise.resolve([]),
      ]);

    const enablerIds = trainerEnablers.map(e => e.id);
    const totalEnablers = enablerIds.length;
    const useCaseIds = useCaseRows.map(u => u.id);
    const hasEnablers = enablerIds.length > 0;

    // ── Phase 3a: Data queries (max 4 parallel) ──
    const [quizLinks, quizSubRows, enablerSubRows, useCaseSubRows] =
      await Promise.all([
        hasEnablers
          ? db
              .select({
                enablerId: enablerQuizLinks.enablerId,
                quizId: enablerQuizLinks.quizId,
              })
              .from(enablerQuizLinks)
              .where(inArray(enablerQuizLinks.enablerId, enablerIds as any))
          : Promise.resolve([]),
        hasTrainees
          ? db
              .select({
                traineeId: quizSubmissions.traineeId,
                quizId: quizSubmissions.quizId,
                score: quizSubmissions.score,
              })
              .from(quizSubmissions)
              .where(inArray(quizSubmissions.traineeId, traineeIds))
          : Promise.resolve([]),
        hasTrainees && hasEnablers
          ? db
              .select({
                traineeId: enablerSubmissions.traineeId,
                enablerId: enablerSubmissions.enablerId,
              })
              .from(enablerSubmissions)
              .where(
                and(
                  inArray(enablerSubmissions.traineeId, traineeIds as any),
                  inArray(enablerSubmissions.enablerId, enablerIds as any),
                  eq(enablerSubmissions.status, 'APPROVED')
                )
              )
          : Promise.resolve([]),
        hasTrainees && useCaseIds.length > 0
          ? db
              .select({
                traineeId: useCaseSubmissions.traineeId,
                useCaseId: useCaseSubmissions.useCaseId,
              })
              .from(useCaseSubmissions)
              .where(
                and(
                  inArray(useCaseSubmissions.traineeId, traineeIds as any),
                  inArray(useCaseSubmissions.useCaseId, useCaseIds as any),
                  eq(useCaseSubmissions.status, 'APPROVED')
                )
              )
          : Promise.resolve([]),
      ]);

    // ── Phase 3b: Pending counts + trends (max 4 parallel) ──
    const [
      pendingQuizResult,
      pendingLessonQuizResult,
      pendingUseCasesResult,
      pendingEnablersResult,
    ] = await Promise.all([
      hasTrainees
        ? db
            .select({ c: count() })
            .from(quizSubmissions)
            .where(
              and(
                eq(quizSubmissions.isReviewed, false),
                inArray(quizSubmissions.traineeId, traineeIds)
              )
            )
        : Promise.resolve([{ c: 0 }]),
      hasTrainees
        ? db
            .select({ c: count() })
            .from(quizSubmissions)
            .innerJoin(
              enablerQuizLinks,
              eq(quizSubmissions.quizId, enablerQuizLinks.quizId)
            )
            .where(
              and(
                eq(quizSubmissions.isReviewed, false),
                inArray(quizSubmissions.traineeId, traineeIds)
              )
            )
        : Promise.resolve([{ c: 0 }]),
      hasTrainees
        ? db
            .select({ c: count() })
            .from(useCaseSubmissions)
            .where(
              and(
                eq(useCaseSubmissions.status, 'PENDING'),
                inArray(useCaseSubmissions.traineeId, traineeIds)
              )
            )
        : Promise.resolve([{ c: 0 }]),
      hasTrainees
        ? db
            .select({ c: count() })
            .from(enablerSubmissions)
            .where(
              and(
                eq(enablerSubmissions.status, 'PENDING'),
                inArray(enablerSubmissions.traineeId, traineeIds)
              )
            )
        : Promise.resolve([{ c: 0 }]),
    ]);

    // ── Phase 3c: Activity + trends + chart data (max 3 parallel) ──
    const [pendingActivityResult, trendCompRows, trendSubRows] =
      await Promise.all([
        hasTrainees
          ? db
              .select({ c: count() })
              .from(activityReports)
              .where(
                and(
                  eq(activityReports.status, 'SUBMITTED'),
                  inArray(activityReports.traineeId, traineeIds)
                )
              )
          : Promise.resolve([{ c: 0 }]),
        hasTrainees
          ? db
              .select({ at: enablerCompletions.completedAt })
              .from(enablerCompletions)
              .where(inArray(enablerCompletions.traineeId, traineeIds))
              .orderBy(desc(enablerCompletions.completedAt))
          : Promise.resolve([]),
        hasTrainees
          ? db
              .select({ at: quizSubmissions.submittedAt })
              .from(quizSubmissions)
              .where(inArray(quizSubmissions.traineeId, traineeIds))
              .orderBy(desc(quizSubmissions.submittedAt))
          : Promise.resolve([]),
      ]);

    // ── Phase 3d: Module chart completions (1 query) ──
    const compByCourseRows =
      courseIds.length && hasTrainees
        ? await db
            .select({
              traineeId: enablerCompletions.traineeId,
              courseId: enablers.courseId,
              c: count(),
            })
            .from(enablerCompletions)
            .innerJoin(enablers, eq(enablerCompletions.enablerId, enablers.id))
            .where(
              and(
                inArray(enablers.courseId, courseIds as any),
                inArray(enablerCompletions.traineeId, traineeIds)
              )
            )
            .groupBy(enablerCompletions.traineeId, enablers.courseId)
        : [];

    // ── Compute progress per trainee (pure computation, no DB) ──
    const completedMap = new Map<string, number>();
    if (totalEnablers > 0 && hasTrainees) {
      for (const traineeId of traineeIds) {
        const quizBestScores = new Map<string, number>();
        for (const s of quizSubRows.filter(
          r => String(r.traineeId) === traineeId
        )) {
          const qid = String(s.quizId);
          const currentBest = quizBestScores.get(qid) || 0;
          if ((s.score || 0) > currentBest) {
            quizBestScores.set(qid, s.score || 0);
          }
        }

        const approvedEnablerSubs = new Set(
          enablerSubRows
            .filter(r => String(r.traineeId) === traineeId)
            .map(r => String(r.enablerId))
        );
        const approvedUseCasesSet = new Set(
          useCaseSubRows
            .filter(r => String(r.traineeId) === traineeId)
            .map(r => String(r.useCaseId))
        );

        let completedCount = 0;
        for (const enabler of trainerEnablers) {
          const enablerId = String(enabler.id);

          const enablerQuizzes = quizLinks.filter(
            l => String(l.enablerId) === enablerId
          );
          let allQuizzesPassed = true;

          if (enablerQuizzes.length > 0) {
            for (const link of enablerQuizzes) {
              const score = quizBestScores.get(String(link.quizId)) || 0;
              if (score < PASS_THRESHOLD) {
                allQuizzesPassed = false;
                break;
              }
            }
          }

          const hasScenarios =
            enabler.scenarios &&
            Array.isArray(enabler.scenarios) &&
            enabler.scenarios.length > 0;
          let scenariosApproved = true;
          if (hasScenarios) {
            scenariosApproved = approvedEnablerSubs.has(enablerId);
          }

          if (allQuizzesPassed && scenariosApproved) {
            completedCount++;
          }
        }

        completedMap.set(traineeId, completedCount);
      }
    }

    const trainees = traineeRows.map(t => {
      const completed = completedMap.get(String(t.id)) || 0;
      const pct =
        totalEnablers > 0 ? Math.round((completed / totalEnablers) * 100) : 0;
      return {
        id: t.id,
        full_name: t.fullName,
        avatar_url: t.avatarUrl,
        progress: pct,
      };
    });

    // ── Pending reviews (from Phase 3 results) ──
    const pendingQuiz = Number((pendingQuizResult[0] as any)?.c) || 0;
    const pendingLessonQuiz =
      Number((pendingLessonQuizResult[0] as any)?.c) || 0;
    const pendingUseCases = Number((pendingUseCasesResult[0] as any)?.c) || 0;
    const pendingEnablers = Number((pendingEnablersResult[0] as any)?.c) || 0;
    const pendingActivityReports =
      Number((pendingActivityResult[0] as any)?.c) || 0;
    const pendingReviews = pendingQuiz + pendingUseCases + pendingEnablers;

    // ── Progress trend (from Phase 3 results) ──
    const weeks = 6;
    const trendBuckets: { week: string; progress: number }[] = [];
    for (let i = weeks - 1; i >= 0; i--)
      trendBuckets.push({ week: `W${weeks - i}`, progress: 0 });

    const now = new Date();
    const addToBuckets = (date: Date | null) => {
      if (!date) return;
      const diffDays = Math.floor(
        (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
      );
      const bucketIndex = Math.floor(diffDays / 7);
      if (bucketIndex >= 0 && bucketIndex < weeks) {
        const idx = weeks - 1 - bucketIndex;
        trendBuckets[idx].progress += 1;
      }
    };
    trendCompRows.forEach(r => addToBuckets(r.at ?? null));
    trendSubRows.forEach(r => addToBuckets(r.at ?? null));

    const progressTrend = trendBuckets;

    // ── Module progress chart (from Phase 2 + Phase 3 results) ──
    const courseEnablerTotal = new Map<string, number>();
    enablerCounts.forEach((row: any) => {
      courseEnablerTotal.set(String(row.courseId), Number(row.c) || 0);
    });

    const compByCourseAndTrainee = new Map<string, Map<string, number>>();
    compByCourseRows.forEach((r: any) => {
      const cId = String(r.courseId);
      const tId = String(r.traineeId);
      if (!compByCourseAndTrainee.has(cId))
        compByCourseAndTrainee.set(cId, new Map());
      compByCourseAndTrainee.get(cId)!.set(tId, Number(r.c) || 0);
    });

    const moduleProgress: {
      name: string;
      completed: number;
      inProgress: number;
      notStarted: number;
    }[] = [];
    for (const course of trainerCourses) {
      const totalEnabs = courseEnablerTotal.get(String(course.id)) || 0;
      let completed = 0;
      let inProgress = 0;
      let notStarted = 0;

      if (traineeIds.length === 0) {
        notStarted = 0;
      } else if (totalEnabs === 0) {
        notStarted = traineeIds.length;
      } else {
        const map =
          compByCourseAndTrainee.get(String(course.id)) ||
          new Map<string, number>();
        for (const tId of traineeIds) {
          const done = map.get(String(tId)) || 0;
          if (done === 0) notStarted += 1;
          else if (done >= totalEnabs) completed += 1;
          else inProgress += 1;
        }
      }

      moduleProgress.push({
        name: String(course.title ?? ''),
        completed,
        inProgress,
        notStarted,
      });
    }

    const charts = {
      progressTrend: Array.isArray(progressTrend) ? progressTrend : [],
      moduleProgress: Array.isArray(moduleProgress) ? moduleProgress : [],
    };

    return {
      trainees: Array.isArray(trainees) ? trainees : [],
      counts: {
        activeTrainees: trainees.length,
        pendingReviews,
        pendingQuiz,
        pendingLessonQuiz,
        pendingEnablers,
        pendingUseCases,
        pendingActivityReports,
      },
      charts,
    };
  } catch (e) {
    console.error('Trainer dashboard data fetch error', e);
    throw e;
  }
}

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
      `trainer_dashboard_${trainerId}`,
      async () => await fetchTrainerDashboardData(trainerId),
      ApiCache.TTL.MEDIUM // 5 minutes cache
    );

    return NextResponse.json(cached, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('Trainer dashboard API error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
