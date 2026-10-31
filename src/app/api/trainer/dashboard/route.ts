import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, countDistinct, desc, eq, inArray, type SQL } from 'drizzle-orm';
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
import { cacheHeaders } from '@/lib/api-cache';
import { requireTraineeScopeCondition } from '@/lib/auth/trainee-scope-conditions';
import {
  catalogCondition,
  requireCatalogScope,
  type CatalogScope,
} from '@/lib/catalog/scope';
import { bestScoresOf, isEnablerCompleted } from '@/lib/catalog/progression';
import { loadGradableQuizIds } from '@/lib/catalog/progression-db';
import {
  enablerSubmissionsWhere,
  quizSubmissionsWhere,
  reviewableCourseIds,
  submissionsOfUseCasesWhere,
} from '@/lib/trainer/pending-reviews';

async function fetchTrainerDashboardData(
  trainerId: string,
  scope: CatalogScope,
  traineeCondition: SQL
) {
  try {
    // ── Phase 1: Trainer + trainee lookups (3 queries) ──
    const [createdCourses, memberCoursesRaw] = await Promise.all([
      db
        .select({ id: courses.id, title: courses.title })
        .from(courses)
        .where(
          and(
            eq(courses.createdById, trainerId),
            catalogCondition(courses.trainingCatalogId, scope)
          )
        ),
      db
        .select({
          courseId: courseMembers.courseId,
          courseTitle: courses.title,
        })
        .from(courseMembers)
        .innerJoin(courses, eq(courseMembers.courseId, courses.id))
        .where(
          and(
            eq(courseMembers.userId, trainerId),
            eq(courseMembers.role, 'TRAINER'),
            catalogCondition(courses.trainingCatalogId, scope)
          )
        ),
    ]);

    const courseIds = Array.from(
      new Set([
        ...createdCourses.map(c => String(c.id)),
        ...memberCoursesRaw.map(m => String(m.courseId)),
      ])
    );

    // Trainers see every trainee in their organization (the super admin every
    // one) and, with a chosen occupation, of that occupation, regardless of
    // direct assignment.
    const traineeRows = await db
      .selectDistinct({
        id: profiles.id,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        isActive: profiles.isActive,
        organizationId: profiles.organizationId,
      })
      .from(profiles)
      .where(traineeCondition);
    const traineeIds = traineeRows.map(t => String(t.id));
    const hasTrainees = traineeIds.length > 0;

    // The courses whose submissions are reviewed: all of the catalog scope
    const reviewCourseIds = await reviewableCourseIds(scope);

    // ── Phase 2: courseId-dependent (2 queries, was 4) ──
    const [trainerEnablers, useCaseRows] = await Promise.all([
      courseIds.length
        ? db
            .select({
              id: enablers.id,
              courseId: enablers.courseId,
              scenarioPdfUrl: enablers.scenarioPdfUrl,
            })
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
    ]);

    // Compute enabler counts per course in JS (was separate DB query)
    const courseEnablerTotal = new Map<string, number>();
    for (const e of trainerEnablers) {
      const cId = String(e.courseId);
      courseEnablerTotal.set(cId, (courseEnablerTotal.get(cId) || 0) + 1);
    }

    // Build course title map from Phase 1 data (was separate DB query)
    const courseTitleMap = new Map<string, string>();
    createdCourses.forEach(c =>
      courseTitleMap.set(String(c.id), String(c.title ?? ''))
    );
    memberCoursesRaw.forEach(m =>
      courseTitleMap.set(String(m.courseId), String(m.courseTitle ?? ''))
    );

    const enablerIds = trainerEnablers.map(e => e.id);
    const totalEnablers = enablerIds.length;
    const useCaseIds = useCaseRows.map(u => u.id);
    const hasEnablers = enablerIds.length > 0;

    // ── Phase 3: All trainee data in ONE parallel batch (was 4 sequential sub-phases) ──
    const [
      quizLinks,
      allQuizSubs,
      useCaseSubRows,
      pendingQuizResult,
      pendingLessonQuizResult,
      pendingUseCasesResult,
      pendingEnablersResult,
      pendingActivityResult,
      allCompletionRows,
    ] = await Promise.all([
      hasEnablers
        ? db
            .select({
              enablerId: enablerQuizLinks.enablerId,
              quizId: enablerQuizLinks.quizId,
            })
            .from(enablerQuizLinks)
            .where(inArray(enablerQuizLinks.enablerId, enablerIds as any))
        : Promise.resolve([]),
      // Merged: quiz scores + timestamps (was quizSubRows + trendSubRows)
      hasTrainees
        ? db
            .select({
              traineeId: quizSubmissions.traineeId,
              quizId: quizSubmissions.quizId,
              score: quizSubmissions.score,
              submittedAt: quizSubmissions.submittedAt,
            })
            .from(quizSubmissions)
            .where(inArray(quizSubmissions.traineeId, traineeIds))
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
      // The pending reviews are counted with the filter of the lists behind
      // the card (src/lib/trainer/pending-reviews.ts), so the number on the
      // card is the number of rows the trainer finds there
      hasTrainees
        ? db
            .select({ c: countDistinct(quizSubmissions.id) })
            .from(quizSubmissions)
            .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
            .where(quizSubmissionsWhere(scope, traineeCondition, true))
        : Promise.resolve([{ c: 0 }]),
      hasTrainees
        ? db
            .select({ c: countDistinct(quizSubmissions.id) })
            .from(quizSubmissions)
            .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
            .innerJoin(
              enablerQuizLinks,
              eq(quizSubmissions.quizId, enablerQuizLinks.quizId)
            )
            .where(quizSubmissionsWhere(scope, traineeCondition, true))
        : Promise.resolve([{ c: 0 }]),
      // Reviews are counted over every course of the catalog scope, like the
      // list: the whole organization is reviewed (WMCNL-2876)
      hasTrainees && reviewCourseIds.length > 0
        ? db
            .select({ c: countDistinct(useCaseSubmissions.id) })
            .from(useCaseSubmissions)
            .innerJoin(useCases, eq(useCases.id, useCaseSubmissions.useCaseId))
            .where(
              submissionsOfUseCasesWhere(
                reviewCourseIds,
                traineeCondition,
                true
              )
            )
        : Promise.resolve([{ c: 0 }]),
      hasTrainees && reviewCourseIds.length > 0
        ? db
            .select({ c: countDistinct(enablerSubmissions.id) })
            .from(enablerSubmissions)
            .innerJoin(enablers, eq(enablers.id, enablerSubmissions.enablerId))
            .where(
              enablerSubmissionsWhere(reviewCourseIds, traineeCondition, true)
            )
        : Promise.resolve([{ c: 0 }]),
      hasTrainees
        ? db
            .select({ c: countDistinct(activityReports.id) })
            .from(activityReports)
            .where(
              and(
                eq(activityReports.status, 'SUBMITTED'),
                inArray(activityReports.traineeId, traineeIds)
              )
            )
        : Promise.resolve([{ c: 0 }]),
      // Merged: enabler completions for trend + module chart (was trendCompRows + compByCourseRows)
      hasTrainees
        ? db
            .select({
              traineeId: enablerCompletions.traineeId,
              enablerId: enablerCompletions.enablerId,
              completedAt: enablerCompletions.completedAt,
            })
            .from(enablerCompletions)
            .where(inArray(enablerCompletions.traineeId, traineeIds))
        : Promise.resolve([]),
    ]);

    // Which linked quizzes are active (an inactive quiz does not exist for the
    // trainee, see src/lib/catalog/progression.ts)
    const linkedQuizRows = quizLinks.length
      ? await db
          .select({ id: quizzes.id, isActive: quizzes.isActive })
          .from(quizzes)
          .where(
            inArray(
              quizzes.id,
              quizLinks.map(l => l.quizId)
            )
          )
      : [];
    const quizActive = new Map(
      linkedQuizRows.map(q => [String(q.id), !!q.isActive])
    );
    // A quiz without a gradable question is no prerequisite (same distinction
    // as the order of work and the grading of a submission)
    const gradableQuizIds = await loadGradableQuizIds(
      quizLinks.map(l => String(l.quizId))
    );
    const progressionLinks = quizLinks.map(l => ({
      enablerId: String(l.enablerId),
      quizId: String(l.quizId),
      quizIsActive: quizActive.get(String(l.quizId)) ?? false,
      gradable: gradableQuizIds.has(String(l.quizId)),
    }));

    // ── Compute progress per trainee (pure computation, no DB) ──
    const completedMap = new Map<string, number>();
    if (totalEnablers > 0 && hasTrainees) {
      for (const traineeId of traineeIds) {
        // The one definition of a completed enabler: every active lesson quiz
        // passed (best attempt). Scenarios and use cases do not count.
        const quizBestScores = bestScoresOf(
          allQuizSubs.filter(r => String(r.traineeId) === traineeId)
        );

        let completedCount = 0;
        for (const enabler of trainerEnablers) {
          const enablerId = String(enabler.id);
          const enablerQuizzes = progressionLinks.filter(
            l => l.enablerId === enablerId
          );
          if (isEnablerCompleted(enablerQuizzes, quizBestScores)) {
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
    allCompletionRows.forEach(r => addToBuckets(r.completedAt ?? null));
    allQuizSubs.forEach(r => addToBuckets(r.submittedAt ?? null));

    const progressTrend = trendBuckets;

    // ── Module progress chart (from Phase 2 + Phase 3 results) ──
    // Map enablerId → courseId for completion grouping
    const enablerToCourse = new Map<string, string>();
    for (const e of trainerEnablers) {
      enablerToCourse.set(String(e.id), String(e.courseId));
    }

    const compByCourseAndTrainee = new Map<string, Map<string, number>>();
    allCompletionRows.forEach((r: any) => {
      const cId = enablerToCourse.get(String(r.enablerId));
      if (!cId) return;
      const tId = String(r.traineeId);
      if (!compByCourseAndTrainee.has(cId))
        compByCourseAndTrainee.set(cId, new Map());
      const m = compByCourseAndTrainee.get(cId)!;
      m.set(tId, (m.get(tId) || 0) + 1);
    });

    const moduleProgress: {
      name: string;
      completed: number;
      inProgress: number;
      notStarted: number;
    }[] = [];
    for (const courseId of courseIds) {
      const totalEnabs = courseEnablerTotal.get(courseId) || 0;
      let completed = 0;
      let inProgress = 0;
      let notStarted = 0;

      if (traineeIds.length === 0) {
        notStarted = 0;
      } else if (totalEnabs === 0) {
        notStarted = traineeIds.length;
      } else {
        const map =
          compByCourseAndTrainee.get(courseId) || new Map<string, number>();
        for (const tId of traineeIds) {
          const done = map.get(String(tId)) || 0;
          if (done === 0) notStarted += 1;
          else if (done >= totalEnabs) completed += 1;
          else inProgress += 1;
        }
      }

      moduleProgress.push({
        name: courseTitleMap.get(courseId) ?? '',
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
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const scope = await requireCatalogScope(session, req);
    if (isErrorResponse(scope)) return scope;

    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

    const trainerId = session.id;

    const data = await fetchTrainerDashboardData(
      trainerId,
      scope,
      traineeScope.condition
    );

    return NextResponse.json(data, { headers: cacheHeaders.none });
  } catch (e) {
    console.error('Trainer dashboard API error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
