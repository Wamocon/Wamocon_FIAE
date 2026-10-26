import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq } from 'drizzle-orm';
import { profiles, quizzes, quizSubmissions, enablerQuizLinks, enablers } from '@/db/migrations/schemas/schema';
import { catalogCondition, requireCatalogScope } from '@/lib/catalog/scope';
import {
  requireTraineeScopeCondition,
  traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';

// GET /api/trainer/quiz-submissions?trainerProfileId=...&onlyPending=true
export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { searchParams } = new URL(req.url);
    const onlyPending = searchParams.get('onlyPending') === 'true';

    const catalogScope = await requireCatalogScope(session, req);
    if (isErrorResponse(catalogScope)) return catalogScope;

    // Only trainees of the caller's organization (the super admin sees every
    // one) and, with a chosen occupation (x-catalog), of that occupation. The
    // trainees of the caller's courses are not added: a course can hold
    // trainees of other organizations, and every trainee inside the scope is
    // already part of the organization list.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

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
      .where(
        and(
          traineeIdInScope(quizSubmissions.traineeId, traineeScope.condition),
          catalogCondition(quizzes.trainingCatalogId, catalogScope),
          onlyPending ? eq(quizSubmissions.isReviewed, false as any) : undefined
        )
      )
      .orderBy(desc(quizSubmissions.submittedAt))
      .limit(200);

    return NextResponse.json({ submissions: rows });
  } catch (e) {
    console.error('Trainer quiz submissions GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
