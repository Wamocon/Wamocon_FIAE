import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, countDistinct, eq, inArray, type SQL } from 'drizzle-orm';
import {
  profiles,
  enablers,
  enablerSubmissions,
  quizSubmissions,
  useCaseSubmissions,
  enablerQuizLinks,
  quizzes,
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
import { sortCourses } from '@/lib/catalog/course-order';
import {
  loadTraineeProgress,
  progressTrendOf,
  type TraineeProgress,
} from '@/lib/trainer/trainee-progress';
import {
  enablerSubmissionsWhere,
  quizSubmissionsWhere,
  reviewableCourseIds,
  submissionsOfUseCasesWhere,
} from '@/lib/trainer/pending-reviews';

async function fetchTrainerDashboardData(
  scope: CatalogScope,
  traineeCondition: SQL
) {
  try {
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

    // The ONE progress figure (src/lib/trainer/trainee-progress.ts): the same
    // formula as the trainee list, the trainee detail and the PDF, over the
    // courses of each trainee inside the chosen occupation
    const progress = await loadTraineeProgress(traineeIds, scope);

    // The courses whose submissions are reviewed: all of the catalog scope
    const reviewCourseIds = await reviewableCourseIds(scope);

    // ── Pending counts in ONE parallel batch ──
    const [
      pendingQuizResult,
      pendingLessonQuizResult,
      pendingUseCasesResult,
      pendingEnablersResult,
      pendingActivityResult,
    ] = await Promise.all([
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
                inArray(activityReports.traineeId, traineeIds),
                // a report counts in the occupation it was written for
                catalogCondition(activityReports.trainingCatalogId, scope)
              )
            )
        : Promise.resolve([{ c: 0 }]),
    ]);

    const trainees = traineeRows.map(t => ({
      id: t.id,
      full_name: t.fullName,
      avatar_url: t.avatarUrl,
      progress: progress.byTrainee.get(String(t.id))?.pct ?? 0,
    }));

    // ── Pending reviews ──
    const pendingQuiz = Number((pendingQuizResult[0] as any)?.c) || 0;
    const pendingLessonQuiz =
      Number((pendingLessonQuizResult[0] as any)?.c) || 0;
    const pendingUseCases = Number((pendingUseCasesResult[0] as any)?.c) || 0;
    const pendingEnablers = Number((pendingEnablersResult[0] as any)?.c) || 0;
    const pendingActivityReports =
      Number((pendingActivityResult[0] as any)?.c) || 0;
    const pendingReviews = pendingQuiz + pendingUseCases + pendingEnablers;

    // ── Progress trend: the average progress (0 to 100 percent) of the
    // trainees in scope at the end of each of the last six weeks, the last
    // point is the progress of today. It used to count activities (completions
    // and quiz attempts of every occupation) and plotted them as percent. ──
    const progressTrend = progressTrendOf(
      traineeIds
        .map(id => progress.byTrainee.get(id))
        .filter((p): p is TraineeProgress => !!p),
      new Date()
    );

    // ── Chart per course: how many trainees finished, work on or have not
    // started the course (the same completion as the progress above) ──
    const moduleProgress = sortCourses(
      Array.from(progress.courses.values())
    ).map(course => {
      let completed = 0;
      let inProgress = 0;
      let notStarted = 0;
      for (const id of traineeIds) {
        const row = progress.byTrainee.get(id)?.courses.get(course.id);
        if (!row) continue;
        if (row.total > 0 && row.completed >= row.total) completed += 1;
        else if (row.completed === 0) notStarted += 1;
        else inProgress += 1;
      }
      return { name: course.title, completed, inProgress, notStarted };
    });

    const charts = {
      progressTrend,
      moduleProgress,
    };

    return {
      trainees,
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

    const data = await fetchTrainerDashboardData(scope, traineeScope.condition);

    return NextResponse.json(data, { headers: cacheHeaders.none });
  } catch (e) {
    console.error('Trainer dashboard API error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
