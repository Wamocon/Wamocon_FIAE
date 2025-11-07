import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { quizSubmissions, notifications, profiles } from '@/db/migrations/schemas/schema';

// PATCH /api/trainer/quiz-submissions/[submissionId]
// Body: { is_reviewed: boolean, trainer_feedback?: string, reviewer_id?: string }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  try {
    const { submissionId } = await ctx.params;
    if (!submissionId) return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 });
    const body = await req.json();
    const is_reviewed = Boolean(body?.is_reviewed);
    const trainer_feedback = (body?.trainer_feedback || body?.trainerFeedback || '').trim();
    const reviewer_id = body?.reviewer_id || body?.reviewerId || undefined;

    const update: any = { isReviewed: is_reviewed };
    if (trainer_feedback) {
      update.trainerFeedback = trainer_feedback;
      update.reviewedAt = new Date();
    }
    if (reviewer_id) update.reviewedById = reviewer_id;

    const [sub] = await db
      .update(quizSubmissions)
      .set(update)
      .where(eq(quizSubmissions.id, submissionId as any))
      .returning();

    // Notify trainee that quiz submission was reviewed
    try {
      if (sub?.traineeId) {
        const actorId = reviewer_id || null;
        await db.insert(notifications).values({
          userId: String(sub.traineeId),
          actorId: actorId ? String(actorId) : null,
          type: 'QUIZ_REVIEWED',
          title: 'Quiz bewertet',
          message: trainer_feedback ? 'Dein Quiz wurde bewertet. Trainer-Feedback ist verfügbar.' : 'Dein Quiz wurde bewertet.',
          linkUrl: '/trainee/quizzes',
          context: { submissionId },
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainee for quiz review', notifyErr);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Trainer quiz submission PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
