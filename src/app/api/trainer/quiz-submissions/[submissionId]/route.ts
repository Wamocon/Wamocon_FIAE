import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { quizSubmissions, notifications } from '@/db/migrations/schemas/schema';
import { verifyTrainer } from '@/lib/auth-helpers';

// PATCH /api/trainer/quiz-submissions/[submissionId]
// Body: { is_reviewed: boolean, trainer_feedback?: string, reviewer_id?: string }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  try {
    const { submissionId } = await ctx.params;
    if (!submissionId) return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 });
    const body = await req.json();
    const is_reviewed = body?.is_reviewed !== undefined ? Boolean(body.is_reviewed) : undefined;
    const trainer_feedback = (body?.trainer_feedback || body?.trainerFeedback || '').trim();
    const reviewer_id = body?.reviewer_id || body?.reviewerId || undefined;

    if (is_reviewed === undefined && !trainer_feedback) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Verify caller is a trainer
    if (reviewer_id) {
      if (!(await verifyTrainer(reviewer_id))) {
        return NextResponse.json({ error: 'Forbidden - not a trainer' }, { status: 403 });
      }
    }

    const update: any = {};
    if (is_reviewed !== undefined) {
      update.isReviewed = is_reviewed;
      if (is_reviewed) {
        update.reviewedAt = new Date();
        if (reviewer_id) update.reviewedById = reviewer_id;
      }
    }
    if (trainer_feedback) {
      update.trainerFeedback = trainer_feedback;
      update.reviewedAt = new Date();
      if (reviewer_id) update.reviewedById = reviewer_id;
    }

    const [sub] = await db
      .update(quizSubmissions)
      .set(update)
      .where(eq(quizSubmissions.id, submissionId as any))
      .returning();

    if (!sub) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    // Only notify trainee when marking as reviewed (not when unmarking)
    if (is_reviewed) {
      try {
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
      } catch (notifyErr) {
        console.warn('Failed to notify trainee for quiz review', notifyErr);
      }
    }

    return NextResponse.json({ ok: true, submission: sub });
  } catch (e) {
    console.error('Trainer quiz submission PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
