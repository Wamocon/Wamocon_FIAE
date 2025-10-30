import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { profiles, quizzes, quizSubmissions } from '@/db/migrations/schemas/schema';

// GET /api/trainer/quiz-submissions?trainerProfileId=...&onlyPending=true
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerProfileId = searchParams.get('trainerProfileId');
    const onlyPending = searchParams.get('onlyPending') === 'true';
    if (!trainerProfileId) return NextResponse.json({ error: 'Missing trainerProfileId' }, { status: 400 });

    // Find trainees assigned to trainer
    const traineeRows = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.role, 'TRAINEE' as any), eq(profiles.assignedTrainerId, trainerProfileId as any)));
    const traineeIds = traineeRows.map(t => t.id);

    if (traineeIds.length === 0) return NextResponse.json({ submissions: [] });

    const rows = await db
      .select({
        id: quizSubmissions.id,
        traineeId: quizSubmissions.traineeId,
        quizId: quizSubmissions.quizId,
        score: quizSubmissions.score,
        isReviewed: quizSubmissions.isReviewed,
        submittedAt: quizSubmissions.submittedAt,
        traineeName: profiles.fullName,
        quizTitle: quizzes.title,
        quizType: quizzes.quizType,
      })
      .from(quizSubmissions)
      .innerJoin(profiles, eq(quizSubmissions.traineeId, profiles.id))
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .where(and(inArray(quizSubmissions.traineeId, traineeIds as any), onlyPending ? eq(quizSubmissions.isReviewed, false as any) : eq(quizSubmissions.isReviewed, quizSubmissions.isReviewed)))
      .orderBy(desc(quizSubmissions.submittedAt))
      .limit(200);

    return NextResponse.json({ submissions: rows });
  } catch (e) {
    console.error('Trainer quiz submissions GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
