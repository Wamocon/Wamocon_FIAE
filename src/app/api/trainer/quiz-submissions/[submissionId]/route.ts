import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  enablerQuizLinks,
  enablers,
  notifications,
  options,
  profiles,
  questions,
  quizSubmissionAnswers,
  quizSubmissions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { apiCache } from '@/lib/api-cache';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { ensureContentInScope, requireCatalogScope } from '@/lib/catalog/scope';

// GET /api/trainer/quiz-submissions/[submissionId]
// The review of one submission: the questions with the marker of the correct
// option, the expected answer of a text question and the answers of the
// trainee. The review page of the trainer reads it from here. It used to read
// the tables on the server without a session, which handed the answer key to
// every visitor who knew the id, so the key now sits behind the trainer guard,
// inside the organization and the occupation of the caller.
export async function GET(req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { submissionId } = await ctx.params;
    const notFound = () => NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    if (!submissionId) return notFound();

    const [sub] = await db
      .select({
        id: quizSubmissions.id,
        traineeId: quizSubmissions.traineeId,
        quizId: quizSubmissions.quizId,
        score: quizSubmissions.score,
        isReviewed: quizSubmissions.isReviewed,
      })
      .from(quizSubmissions)
      .where(eq(quizSubmissions.id, submissionId as any))
      .limit(1);
    if (!sub) return notFound();

    // Same answer for a foreign submission as for a missing one: the trainee
    // belongs to the organization (and chosen occupation) of the caller and the
    // quiz lies inside the catalogs of the caller
    const access = await requireTraineeAccess(session, String(sub.traineeId), req);
    if (isErrorResponse(access)) return access.status === 404 ? notFound() : access;
    const catalogScope = await requireCatalogScope(session, req);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const deniedQuiz = await ensureContentInScope(catalogScope, 'quiz', String(sub.quizId));
    if (deniedQuiz) return notFound();

    const [quiz] = await db
      .select({ title: quizzes.title, quizType: quizzes.quizType })
      .from(quizzes)
      .where(eq(quizzes.id, sub.quizId as any))
      .limit(1);
    const [trainee] = await db
      .select({ fullName: profiles.fullName, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.id, sub.traineeId as any))
      .limit(1);

    // Lesson context (difficulty and title of the enabler), if the quiz has one
    const [link] = await db
      .select({ enablerId: enablerQuizLinks.enablerId, difficulty: enablerQuizLinks.difficulty })
      .from(enablerQuizLinks)
      .where(eq(enablerQuizLinks.quizId, sub.quizId as any))
      .limit(1);
    const [enabler] = link
      ? await db
          .select({ title: enablers.title })
          .from(enablers)
          .where(eq(enablers.id, link.enablerId as any))
          .limit(1)
      : [];

    const qs = await db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        questionType: questions.questionType,
        expectedAnswer: questions.expectedAnswer,
      })
      .from(questions)
      .where(eq(questions.quizId, sub.quizId as any))
      .orderBy(asc(questions.orderIndex));
    const qIds = qs.map(q => q.id);
    const allOpts = qIds.length
      ? await db
          .select({
            id: options.id,
            questionId: options.questionId,
            optionText: options.optionText,
            isCorrect: options.isCorrect,
          })
          .from(options)
          .where(inArray(options.questionId, qIds as any))
      : [];
    const answers = await db
      .select({
        questionId: quizSubmissionAnswers.questionId,
        selectedOptionId: quizSubmissionAnswers.selectedOptionId,
        textAnswer: quizSubmissionAnswers.textAnswer,
      })
      .from(quizSubmissionAnswers)
      .where(eq(quizSubmissionAnswers.submissionId, sub.id as any));
    const answerByQuestion = new Map(answers.map(a => [String(a.questionId), a] as const));

    return NextResponse.json({
      submission: sub,
      quiz: quiz ? { title: quiz.title, quizType: quiz.quizType } : null,
      trainee: trainee ? { fullName: trainee.fullName, email: trainee.email } : null,
      lesson: link ? { difficulty: link.difficulty, enablerTitle: enabler?.title ?? null } : null,
      questions: qs.map(q => {
        const answer = answerByQuestion.get(String(q.id));
        return {
          id: q.id,
          text: q.questionText,
          questionType: q.questionType || 'MCQ',
          expectedAnswer: q.expectedAnswer || null,
          options: allOpts
            .filter(o => String(o.questionId) === String(q.id))
            .map(o => ({ id: o.id, optionText: o.optionText, isCorrect: !!o.isCorrect })),
          selectedOptionId: answer?.selectedOptionId ?? null,
          textAnswer: answer?.textAnswer || null,
        };
      }),
    });
  } catch (e) {
    console.error('Trainer quiz submission GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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
