import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { quizSubmissions, notifications } from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { apiCache } from '@/lib/api-cache';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { ensureContentInScope, requireCatalogScope } from '@/lib/catalog/scope';

// PATCH /api/trainer/quiz-submissions/[submissionId]
// Body: { is_reviewed: boolean, trainer_feedback?: string, reviewer_id?: string }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { submissionId } = await ctx.params;
    if (!submissionId) return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 });
    const body = await req.json();
    const is_reviewed = body?.is_reviewed !== undefined ? Boolean(body.is_reviewed) : undefined;
    const trainer_feedback = (body?.trainer_feedback || body?.trainerFeedback || '').trim();
    const reviewer_id = session.id;

    if (is_reviewed === undefined && !trainer_feedback) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // The submission has to belong to a trainee the caller is responsible for
    // (own organization, chosen occupation). A foreign one answers like a
    // missing one, so nothing is leaked and nothing is changed.
    const [existing] = await db
      .select({ id: quizSubmissions.id, traineeId: quizSubmissions.traineeId, quizId: quizSubmissions.quizId })
      .from(quizSubmissions)
      .where(eq(quizSubmissions.id, submissionId as any))
      .limit(1);
    const notFound = () => NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    if (!existing) return notFound();

    const access = await requireTraineeAccess(session, String(existing.traineeId), req);
    if (isErrorResponse(access)) return access.status === 404 ? notFound() : access;

    // The reviewed quiz must lie inside the caller's catalogs
    const catalogScope = await requireCatalogScope(session, req);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const deniedQuiz = await ensureContentInScope(catalogScope, 'quiz', String(existing.quizId));
    if (deniedQuiz) return notFound();

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
      .where(and(eq(quizSubmissions.id, submissionId as any), eq(quizSubmissions.traineeId, access.traineeId as any)))
      .returning();

    if (!sub) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    // Only notify trainee when marking as reviewed (not when unmarking)
    if (is_reviewed) {
      try {
        const actorId = reviewer_id || null;
        const organizationId = await getUserOrgId(String(sub.traineeId));
        await db.insert(notifications).values({
          userId: String(sub.traineeId),
          actorId: actorId ? String(actorId) : null,
          type: 'QUIZ_REVIEWED',
          title: 'Quiz bewertet',
          message: trainer_feedback ? 'Dein Quiz wurde bewertet. Trainer-Feedback ist verfügbar.' : 'Dein Quiz wurde bewertet.',
          linkUrl: '/trainee/quizzes',
          context: { submissionId },
          organizationId,
        });
      } catch (notifyErr) {
        console.warn('Failed to notify trainee for quiz review', notifyErr);
      }
    }

    apiCache.invalidate('trainer_reviews');
    apiCache.invalidate('trainee_quizzes');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({ ok: true, submission: sub });
  } catch (e) {
    console.error('Trainer quiz submission PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
