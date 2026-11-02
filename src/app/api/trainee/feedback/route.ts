import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  courses,
  enablerSubmissions,
  enablers,
  useCaseSubmissions,
  useCases,
  quizSubmissions,
  quizzes,
  enablerQuizzes,
  enablerQuizLinks,
} from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  catalogCondition,
  requireCatalogScopeForUser,
} from '@/lib/catalog/scope';

// GET /api/trainee/feedback
// The feedback of the session user, a traineeId in the query is ignored. Every
// list belongs to the occupation of the request (x-catalog): a trainee in two
// trainings sees the submissions and quiz results of the chosen one only.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const scope = await requireCatalogScopeForUser(traineeId, req);
    if (scope instanceof Response) return scope;

    // Enabler submissions with titles (the enabler belongs to a course, the
    // course to an occupation)
    const enablerRows = await db
      .select({
        id: enablerSubmissions.id,
        enablerId: enablerSubmissions.enablerId,
        status: enablerSubmissions.status,
        trainerFeedback: enablerSubmissions.trainerFeedback,
        feedbacks: enablerSubmissions.feedbacks,
        solutionText: enablerSubmissions.solutionText,
        solutions: enablerSubmissions.solutions,
        submittedAt: enablerSubmissions.submittedAt,
        reviewedAt: enablerSubmissions.reviewedAt,
        attemptNumber: enablerSubmissions.attemptNumber,
        enablerTitle: enablers.title,
      })
      .from(enablerSubmissions)
      .innerJoin(enablers, eq(enablerSubmissions.enablerId, enablers.id))
      .innerJoin(courses, eq(enablers.courseId, courses.id))
      .where(
        and(
          eq(enablerSubmissions.traineeId, traineeId as any),
          catalogCondition(courses.trainingCatalogId, scope)
        )
      )
      .orderBy(desc(enablerSubmissions.submittedAt))
      .limit(200);

    // Use case submissions with titles
    const useCaseRows = await db
      .select({
        id: useCaseSubmissions.id,
        useCaseId: useCaseSubmissions.useCaseId,
        status: useCaseSubmissions.status,
        trainerFeedback: useCaseSubmissions.trainerFeedback,
        submittedAt: useCaseSubmissions.submittedAt,
        reviewedAt: useCaseSubmissions.reviewedAt,
        attemptNumber: useCaseSubmissions.attemptNumber,
        useCaseTitle: useCases.title,
      })
      .from(useCaseSubmissions)
      .innerJoin(useCases, eq(useCaseSubmissions.useCaseId, useCases.id))
      .innerJoin(courses, eq(useCases.courseId, courses.id))
      .where(
        and(
          eq(useCaseSubmissions.traineeId, traineeId as any),
          catalogCondition(courses.trainingCatalogId, scope)
        )
      )
      .orderBy(desc(useCaseSubmissions.submittedAt))
      .limit(200);

    // Quiz submissions of the occupation. An enabler has up to three quizzes
    // (one per difficulty, enabler_quiz_links); the older one-quiz link
    // (enabler_quizzes) is still read, so no quiz result goes missing.
    const quizRows = await db
      .select({
        id: quizSubmissions.id,
        quizId: quizSubmissions.quizId,
        score: quizSubmissions.score,
        isReviewed: quizSubmissions.isReviewed,
        trainerFeedback: quizSubmissions.trainerFeedback,
        submittedAt: quizSubmissions.submittedAt,
        quizTitle: quizzes.title,
        quizType: quizzes.quizType,
        difficulty: enablerQuizLinks.difficulty,
        enablerId: sql<
          string | null
        >`coalesce(${enablerQuizLinks.enablerId}, ${enablerQuizzes.enablerId})`,
        enablerTitle: enablers.title,
        attemptNumber: quizSubmissions.attemptNumber,
      })
      .from(quizSubmissions)
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .leftJoin(enablerQuizLinks, eq(quizzes.id, enablerQuizLinks.quizId))
      .leftJoin(enablerQuizzes, eq(quizzes.id, enablerQuizzes.quizId))
      .leftJoin(
        enablers,
        eq(
          enablers.id,
          sql`coalesce(${enablerQuizLinks.enablerId}, ${enablerQuizzes.enablerId})`
        )
      )
      .where(
        and(
          eq(quizSubmissions.traineeId, traineeId as any),
          catalogCondition(quizzes.trainingCatalogId, scope)
        )
      )
      .orderBy(desc(quizSubmissions.submittedAt))
      .limit(400);

    // The latest attempt of every enabler quiz (one row per quiz, so the three
    // difficulties of an enabler are three rows). A quiz without an enabler is
    // not an enabler quiz (global quizzes are listed below).
    const latestByQuiz = new Map<string, any>();
    for (const r of quizRows) {
      if (!r.enablerId) continue;
      const key = String(r.quizId);
      if (!latestByQuiz.has(key)) latestByQuiz.set(key, r);
    }
    const enablerQuizResults = Array.from(latestByQuiz.values());

    // Also include GLOBAL quiz submissions for the trainee (latest per quiz)
    const globalLatestByQuiz = new Map<string, any>();
    for (const r of quizRows) {
      if (String(r.quizType) !== 'GLOBAL') continue;
      const key = String(r.quizId);
      if (!globalLatestByQuiz.has(key)) globalLatestByQuiz.set(key, r);
    }
    const globalQuizResults = Array.from(globalLatestByQuiz.values());

    return NextResponse.json({
      enablerResults: enablerRows,
      useCaseResults: useCaseRows,
      enablerQuizResults,
      globalQuizResults,
    });
  } catch (e) {
    console.error('Trainee feedback GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
