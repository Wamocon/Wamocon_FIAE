import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  enablerSubmissions,
  enablers,
  useCaseSubmissions,
  useCases,
  quizSubmissions,
  quizzes,
  enablerQuizzes,
} from '@/db/migrations/schemas/schema';

// GET /api/trainee/feedback?traineeId=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    // Enabler submissions with titles
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
      .where(eq(enablerSubmissions.traineeId, traineeId as any))
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
      .where(eq(useCaseSubmissions.traineeId, traineeId as any))
      .orderBy(desc(useCaseSubmissions.submittedAt))
      .limit(200);

    // Geschäftsprozesse feature removed; skipping related submissions

    // Enabler quiz submissions: join quizSubmissions -> quizzes (quizType ENABLER) -> enablerQuizzes -> enablers for title
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
        enablerId: enablerQuizzes.enablerId,
        enablerTitle: enablers.title,
        attemptNumber: quizSubmissions.attemptNumber,
      })
      .from(quizSubmissions)
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .leftJoin(enablerQuizzes, eq(quizzes.id, enablerQuizzes.quizId))
      .leftJoin(enablers, eq(enablerQuizzes.enablerId, enablers.id))
      .where(and(eq(quizSubmissions.traineeId, traineeId as any)))
      .orderBy(desc(quizSubmissions.submittedAt))
      .limit(400);

    // Keep latest submission per enabler quiz (if multiple attempts). If no enablerId, skip (global quizzes not shown here).
    const latestByEnabler = new Map<string, any>();
    for (const r of quizRows) {
      if (!r.enablerId) continue;
      const key = String(r.enablerId);
      if (!latestByEnabler.has(key)) latestByEnabler.set(key, r);
    }
    const enablerQuizResults = Array.from(latestByEnabler.values());

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
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
