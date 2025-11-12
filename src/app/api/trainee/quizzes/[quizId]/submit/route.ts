import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  enablerQuizLinks,
  options,
  questions,
  quizSubmissionAnswers,
  quizSubmissions,
  quizzes,
  courseMembers,
  enablers,
  courses,
  notifications,
} from '@/db/migrations/schemas/schema';

// POST: submit answers for a quiz attempt
// Body: { traineeId: string, answers: [{ questionId, selectedOptionId }] }
export async function POST(req: NextRequest, { params }: { params: { quizId: string } }) {
  try {
    const { quizId } = params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const answers: Array<{ questionId: string; selectedOptionId: string }> = Array.isArray(body?.answers) ? body.answers : [];
    if (!traineeId || answers.length === 0) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
    if (!quiz || !quiz.isActive) return NextResponse.json({ error: 'Quiz unavailable' }, { status: 404 });

    // Ensure quiz belongs to an enabler (lesson) for membership gating
    const [link] = await db.select().from(enablerQuizLinks).where(eq(enablerQuizLinks.quizId, quizId));
    if (!link) return NextResponse.json({ error: 'Quiz detached' }, { status: 400 });
    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, link.enablerId));
    if (!enabler || !enabler.isActive) return NextResponse.json({ error: 'Enabler inactive' }, { status: 404 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, enabler.courseId), eq(courseMembers.userId, traineeId)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const qs = await db.select().from(questions).where(eq(questions.quizId, quizId));
    const qIds = qs.map((q) => q.id);
    const optRows = qIds.length ? await db.select().from(options).where(inArray(options.questionId, qIds)) : [];
    const optMap = new Map(optRows.map((o) => [String(o.id), o]));

    // Check for existing submission (single-attempt enforcement)
    const existingSubmission = await db
      .select()
      .from(quizSubmissions)
      .where(and(eq(quizSubmissions.quizId, quizId), eq(quizSubmissions.traineeId, traineeId)));
    if (existingSubmission.length) {
      // Build feedback from stored answers for review-only mode
      const [sub] = existingSubmission;
      const storedAnswers = await db
        .select()
        .from(quizSubmissionAnswers)
        .where(eq(quizSubmissionAnswers.submissionId, sub.id));
      const answerMap = new Map(storedAnswers.map((sa) => [String(sa.questionId), sa.selectedOptionId]));
      const feedback = qs.map((q) => {
        const chosenOptId = answerMap.get(String(q.id));
        const chosenOpt = chosenOptId ? optMap.get(String(chosenOptId)) : undefined;
        const correctOpt = optRows.find((o) => String(o.questionId) === String(q.id) && o.isCorrect);
        return {
          questionId: q.id,
          correct: !!chosenOpt?.isCorrect,
          correctOptionId: correctOpt?.id,
          explanation: correctOpt?.explanation || null,
        };
      });
      return NextResponse.json({ submissionId: sub.id, score: sub.score, feedback, locked: true });
    }

    let correctCount = 0;
    for (const a of answers) {
      const opt = optMap.get(String(a.selectedOptionId));
      if (opt?.isCorrect) correctCount++;
    }
    const score = Math.round((correctCount / Math.max(1, qs.length)) * 100);

    const submission = await db.transaction(async (tx) => {
      // attempt number auto-increment
      const previousSubs = await tx
        .select({ id: quizSubmissions.id })
        .from(quizSubmissions)
        .where(and(eq(quizSubmissions.quizId, quizId), eq(quizSubmissions.traineeId, traineeId)));
      const attemptNumber = previousSubs.length + 1;
      const [sub] = await tx
        .insert(quizSubmissions)
        .values({ traineeId, quizId, score, isReviewed: false, attemptNumber })
        .returning();
      await tx.insert(quizSubmissionAnswers).values(
        answers.map((a) => ({ submissionId: sub.id, questionId: a.questionId, selectedOptionId: a.selectedOptionId }))
      );
      return sub;
    });

    // Build per-question feedback with explanation for correct option
    const feedback = qs.map((q) => {
      const chosen = answers.find((a) => String(a.questionId) === String(q.id));
      const chosenOpt = chosen ? optMap.get(String(chosen.selectedOptionId)) : undefined;
      const correctOpt = optRows.find((o) => String(o.questionId) === String(q.id) && o.isCorrect);
      return {
        questionId: q.id,
        correct: !!chosenOpt?.isCorrect,
        correctOptionId: correctOpt?.id,
        explanation: correctOpt?.explanation || null,
      };
    });

    // Notify trainers (reuse existing pattern)
    try {
      const [courseRow] = await db.select().from(courses).where(eq(courses.id, enabler.courseId));
      const trainerRows = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(eq(courseMembers.courseId, enabler.courseId), eq(courseMembers.role, 'TRAINER')));
      const trainerIds = new Set<string>();
      if (courseRow?.createdById) trainerIds.add(String(courseRow.createdById));
      trainerRows.forEach((r) => trainerIds.add(String(r.userId)));
      if (trainerIds.size) {
        await db.insert(notifications).values(
          Array.from(trainerIds).map((uid) => ({
            userId: uid,
            actorId: traineeId,
            type: 'LESSON_QUIZ_SUBMITTED',
            title: 'Lesson-Quiz eingereicht',
            message: `Trainee hat ein ${link.difficulty}-Quiz abgegeben: ${enabler.title}`,
            linkUrl: '/trainer/reviews?view=quizzes&onlyPending=true',
            context: { submissionId: submission.id, quizId, enablerId: enabler.id, difficulty: link.difficulty },
          }))
        );
      }
    } catch (notifyErr) {
      console.warn('Notify trainers lesson quiz failed', notifyErr);
    }

    return NextResponse.json({ submissionId: submission.id, score, feedback, locked: false });
  } catch (e) {
    console.error('Submit quiz attempt error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// GET: fetch latest submission with per-question feedback for review
export async function GET(req: NextRequest, { params }: { params: { quizId: string } }) {
  try {
    const { quizId } = params;
    const traineeId = String(new URL(req.url).searchParams.get('traineeId') || '');
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
    if (!quiz) return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });

    const qs = await db.select().from(questions).where(eq(questions.quizId, quizId));
    const qIds = qs.map((q) => q.id);
    const optRows = qIds.length ? await db.select().from(options).where(inArray(options.questionId, qIds)) : [];
    const optMap = new Map(optRows.map((o) => [String(o.id), o]));

    const subs = await db
      .select()
      .from(quizSubmissions)
      .where(and(eq(quizSubmissions.quizId, quizId), eq(quizSubmissions.traineeId, traineeId)));
    if (!subs.length) return NextResponse.json({ error: 'No submission' }, { status: 404 });
    // Use the most recent by id as a proxy (schema may have timestamp); adjust if submittedAt exists
    const latest = subs[subs.length - 1];
    const storedAnswers = await db
      .select()
      .from(quizSubmissionAnswers)
      .where(eq(quizSubmissionAnswers.submissionId, latest.id));
    const answerMap = new Map(storedAnswers.map((sa) => [String(sa.questionId), sa.selectedOptionId]));

    const feedback = qs.map((q) => {
      const chosenOptId = answerMap.get(String(q.id));
      const chosenOpt = chosenOptId ? optMap.get(String(chosenOptId)) : undefined;
      const correctOpt = optRows.find((o) => String(o.questionId) === String(q.id) && o.isCorrect);
      return {
        questionId: q.id,
        correct: !!chosenOpt?.isCorrect,
        correctOptionId: correctOpt?.id,
        explanation: correctOpt?.explanation || null,
        selectedOptionId: chosenOptId || null,
      };
    });

    return NextResponse.json({ submissionId: latest.id, score: latest.score, feedback });
  } catch (e) {
    console.error('Get quiz latest submission error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
