import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  enablerQuizLinks,
  options,
  questions,
  quizSubmissionAnswers,
  quizSubmissions,
  quizAssignments,
  quizzes,
  courseMembers,
  enablers,
  courses,
  notifications,
} from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';

// POST: submit answers for a quiz attempt
// Body: { traineeId: string, answers: [{ questionId, selectedOptionId? , textAnswer? }] }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quizId: string }> }
) {
  try {
    const { quizId } = await params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const answers: Array<any> = Array.isArray(body?.answers)
      ? body.answers
      : [];
    if (!traineeId || answers.length === 0)
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const [quiz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, quizId));
    if (!quiz || !quiz.isActive)
      return NextResponse.json({ error: 'Quiz unavailable' }, { status: 404 });

    const isGlobal = String((quiz as any).quizType || '').toUpperCase() === 'GLOBAL';

    // For GLOBAL quizzes, ensure the trainee is assigned to this quiz.
    // For lesson quizzes, keep the original membership gating via enabler/course.
    let link: any = null;
    let enabler: any = null;
    if (isGlobal) {
      const [assignment] = await db
        .select()
        .from(quizAssignments)
        .where(
          and(
            eq(quizAssignments.quizId, quizId as any),
            eq(quizAssignments.traineeId, traineeId as any)
          )
        );
      if (!assignment)
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else {
      // Ensure quiz belongs to an enabler (lesson) for membership gating
      const [l] = await db
        .select()
        .from(enablerQuizLinks)
        .where(eq(enablerQuizLinks.quizId, quizId));
      if (!l)
        return NextResponse.json({ error: 'Quiz detached' }, { status: 400 });
      link = l;

      const [e] = await db
        .select({
          id: enablers.id,
          isActive: enablers.isActive,
          courseId: enablers.courseId,
          title: enablers.title,
        })
        .from(enablers)
        .where(eq(enablers.id, link.enablerId));
      if (!e || !e.isActive)
        return NextResponse.json({ error: 'Enabler inactive' }, { status: 404 });
      enabler = e;

      const [member] = await db
        .select()
        .from(courseMembers)
        .where(
          and(
            eq(courseMembers.courseId, enabler.courseId),
            eq(courseMembers.userId, traineeId)
          )
        );
      if (!member)
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.quizId, quizId));
    const qIds = qs.map(q => q.id);
    const optRows = qIds.length
      ? await db.select().from(options).where(inArray(options.questionId, qIds))
      : [];
    const optMap = new Map(optRows.map(o => [String(o.id), o]));

    const allowMultipleAttempts = isGlobal;

    // Check for existing submission (single-attempt enforcement for non-global quizzes)
    const existingSubmission = await db
      .select()
      .from(quizSubmissions)
      .where(
        and(
          eq(quizSubmissions.quizId, quizId),
          eq(quizSubmissions.traineeId, traineeId)
        )
      );
    if (!allowMultipleAttempts && existingSubmission.length) {
      // Build feedback from stored answers for review-only mode
      const [sub] = existingSubmission;
      const storedAnswers = await db
        .select()
        .from(quizSubmissionAnswers)
        .where(eq(quizSubmissionAnswers.submissionId, sub.id));
      const answerMapOpt = new Map(
        storedAnswers.map(sa => [String(sa.questionId), sa.selectedOptionId])
      );
      const answerMapText = new Map(
        storedAnswers.map(sa => [String(sa.questionId), (sa as any).textAnswer])
      );
      const feedback = qs.map(q => {
        const qType = (q as any).questionType || 'MCQ';
        if (qType === 'TEXT') {
          const given = (answerMapText.get(String(q.id)) || '') as string;
          const expected = ((q as any).expectedAnswer || '') as string;
          const correct = expected
            ? given.trim().toLowerCase() === expected.trim().toLowerCase()
            : false;
          return {
            questionId: q.id,
            correct,
            correctOptionId: null,
            explanation: null,
            selectedOptionId: null,
            selectedText: given,
            correctAnswerText: expected || null,
          };
        } else {
          const chosenOptId = answerMapOpt.get(String(q.id));
          const chosenOpt = chosenOptId
            ? optMap.get(String(chosenOptId))
            : undefined;
          const correctOpt = optRows.find(
            o => String(o.questionId) === String(q.id) && o.isCorrect
          );
          return {
            questionId: q.id,
            correct: !!chosenOpt?.isCorrect,
            correctOptionId: correctOpt?.id,
            explanation: correctOpt?.explanation || null,
            selectedOptionId: chosenOptId || null,
            selectedText: null,
            correctAnswerText: null,
          };
        }
      });
      return NextResponse.json({
        submissionId: sub.id,
        score: sub.score,
        feedback,
        locked: true,
      });
    }

    // Normalize answers and compute score.
    const normalized = answers.map(a => {
      const q = qs.find(qq => String(qq.id) === String(a.questionId));
      const qType = (q as any)?.questionType || 'MCQ';
      if (qType === 'TEXT') {
        const text =
          (a as any).textAnswer ??
          (typeof a.selectedOptionId === 'string' ? a.selectedOptionId : '');
        return { questionId: a.questionId, textAnswer: String(text || '') };
      }
      return { questionId: a.questionId, selectedOptionId: a.selectedOptionId };
    });

    // Require an answer for every question (MCQ must have selectedOptionId, TEXT must have non-empty textAnswer)
    const answerByQuestionId = new Map<string, any>(
      normalized.map(a => [String(a.questionId), a])
    );
    const missing = qs.filter(q => {
      const a = answerByQuestionId.get(String(q.id));
      const qType = (q as any)?.questionType || 'MCQ';
      if (!a) return true;
      if (qType === 'TEXT') {
        const text = String((a as any).textAnswer || '').trim();
        return text.length === 0;
      }
      return !String((a as any).selectedOptionId || '').trim();
    });
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing answers (${missing.length})`, missingCount: missing.length },
        { status: 400 }
      );
    }

    let correctCount = 0;
    for (const a of normalized) {
      const q = qs.find(qq => String(qq.id) === String(a.questionId));
      const qType = (q as any)?.questionType || 'MCQ';
      if (qType === 'TEXT') {
        const given = (a as any).textAnswer
          ? String((a as any).textAnswer).trim()
          : '';
        const expected = ((q as any)?.expectedAnswer || '') as string;
        // If expectedAnswer exists, compare case-insensitively; otherwise non-empty = correct (free-text for manual review)
        if (expected) {
          if (given.toLowerCase() === expected.trim().toLowerCase()) correctCount++;
        } else {
          if (given.length > 0) correctCount++;
        }
      } else {
        const opt = a.selectedOptionId
          ? optMap.get(String(a.selectedOptionId))
          : undefined;
        if (opt?.isCorrect) correctCount++;
      }
    }
    const score = Math.round((correctCount / Math.max(1, qs.length)) * 100);

    const submission = await db.transaction(async tx => {
      // attempt number auto-increment
      const previousSubs = await tx
        .select({ id: quizSubmissions.id })
        .from(quizSubmissions)
        .where(
          and(
            eq(quizSubmissions.quizId, quizId),
            eq(quizSubmissions.traineeId, traineeId)
          )
        );
      const attemptNumber = previousSubs.length + 1;
      const [sub] = await tx
        .insert(quizSubmissions)
        .values({ traineeId, quizId, score, isReviewed: false, attemptNumber })
        .returning();
      await tx.insert(quizSubmissionAnswers).values(
        normalized.map(a => ({
          submissionId: sub.id,
          questionId: a.questionId,
          selectedOptionId: (a as any).selectedOptionId ?? null,
          textAnswer: (a as any).textAnswer ?? null,
        }))
      );
      return sub;
    });

    // Build per-question feedback with explanation for correct option
    const feedback = qs.map(q => {
      const qType = (q as any).questionType || 'MCQ';
      if (qType === 'TEXT') {
        const chosen = normalized.find(
          a => String(a.questionId) === String(q.id)
        );
        const given =
          chosen && (chosen as any).textAnswer
            ? String((chosen as any).textAnswer)
            : '';
        const expected = ((q as any).expectedAnswer || '') as string;
        const correct = expected
          ? given.trim().toLowerCase() === expected.trim().toLowerCase()
          : given.trim().length > 0;
        return {
          questionId: q.id,
          correct,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: given,
          correctAnswerText: ((q as any).expectedAnswer || null) as any,
        };
      } else {
        const chosen = normalized.find(
          a => String(a.questionId) === String(q.id)
        );
        const chosenOpt = chosen?.selectedOptionId
          ? optMap.get(String(chosen.selectedOptionId))
          : undefined;
        const correctOpt = optRows.find(
          o => String(o.questionId) === String(q.id) && o.isCorrect
        );
        return {
          questionId: q.id,
          correct: !!chosenOpt?.isCorrect,
          correctOptionId: correctOpt?.id,
          explanation: correctOpt?.explanation || null,
          selectedOptionId: chosen?.selectedOptionId || null,
          selectedText: null,
          correctAnswerText: null,
        };
      }
    });

    // Notify trainers (reuse existing pattern)
    try {
      if (isGlobal) {
        // No trainer notification for global quizzes (trainee can attempt multiple times)
        apiCache.invalidate('trainee_quizzes');
        apiCache.invalidate('trainer_reviews');
        apiCache.invalidate('trainer_dashboard');
        return NextResponse.json({
          submissionId: submission.id,
          score,
          feedback,
          locked: false,
        });
      }
      const [courseRow] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, enabler.courseId));
      const trainerRows = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(
          and(
            eq(courseMembers.courseId, enabler.courseId),
            eq(courseMembers.role, 'TRAINER')
          )
        );
      const trainerIds = new Set<string>();
      if (courseRow?.createdById) trainerIds.add(String(courseRow.createdById));
      trainerRows.forEach(r => trainerIds.add(String(r.userId)));
      if (trainerIds.size) {
        await db.insert(notifications).values(
          Array.from(trainerIds).map(uid => ({
            userId: uid,
            actorId: traineeId,
            type: 'LESSON_QUIZ_SUBMITTED',
            title: 'Lesson-Quiz eingereicht',
            message: `Trainee hat ein ${link.difficulty}-Quiz abgegeben: ${enabler.title}`,
            linkUrl: '/trainer/reviews?view=quizzes&onlyPending=true',
            context: {
              submissionId: submission.id,
              quizId,
              enablerId: enabler.id,
              difficulty: link.difficulty,
            },
          }))
        );
      }
    } catch (notifyErr) {
      console.warn('Notify trainers lesson quiz failed', notifyErr);
    }

    apiCache.invalidate('trainee_quizzes');
    apiCache.invalidate('trainer_reviews');
    apiCache.invalidate('trainer_dashboard');

    return NextResponse.json({
      submissionId: submission.id,
      score,
      feedback,
      locked: false,
    });
  } catch (e) {
    console.error('Submit quiz attempt error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// GET: fetch latest submission with per-question feedback for review
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quizId: string }> }
) {
  try {
    const { quizId } = await params;
    const traineeId = String(
      new URL(req.url).searchParams.get('traineeId') || ''
    );
    if (!traineeId)
      return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [quiz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, quizId));
    if (!quiz)
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });

    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.quizId, quizId));
    const qIds = qs.map(q => q.id);
    const optRows = qIds.length
      ? await db.select().from(options).where(inArray(options.questionId, qIds))
      : [];
    const optMap = new Map(optRows.map(o => [String(o.id), o]));

    const subs = await db
      .select()
      .from(quizSubmissions)
      .where(
        and(
          eq(quizSubmissions.quizId, quizId),
          eq(quizSubmissions.traineeId, traineeId)
        )
      );
    if (!subs.length)
      return NextResponse.json({ error: 'No submission' }, { status: 404 });
    // Use the most recent by id as a proxy (schema may have timestamp); adjust if submittedAt exists
    const latest = subs[subs.length - 1];
    const storedAnswers = await db
      .select()
      .from(quizSubmissionAnswers)
      .where(eq(quizSubmissionAnswers.submissionId, latest.id));
    const answerMap = new Map(
      storedAnswers.map(sa => [String(sa.questionId), sa.selectedOptionId])
    );

    const storedAnswerMapText = new Map(
      storedAnswers.map(sa => [String(sa.questionId), (sa as any).textAnswer])
    );
    const feedback = qs.map(q => {
      const qType = (q as any).questionType || 'MCQ';
      if (qType === 'TEXT') {
        const given = (storedAnswerMapText.get(String(q.id)) || '') as string;
        const expected = ((q as any).expectedAnswer || '') as string;
        return {
          questionId: q.id,
          correct: expected
            ? given.trim().toLowerCase() === expected.trim().toLowerCase()
            : given.trim().length > 0,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: given,
          correctAnswerText: ((q as any).expectedAnswer || null) as any,
        };
      }
      const chosenOptId = answerMap.get(String(q.id));
      const chosenOpt = chosenOptId
        ? optMap.get(String(chosenOptId))
        : undefined;
      const correctOpt = optRows.find(
        o => String(o.questionId) === String(q.id) && o.isCorrect
      );
      return {
        questionId: q.id,
        correct: !!chosenOpt?.isCorrect,
        correctOptionId: correctOpt?.id,
        explanation: correctOpt?.explanation || null,
        selectedOptionId: chosenOptId || null,
        selectedText: null,
        correctAnswerText: null,
      };
    });

    return NextResponse.json({
      submissionId: latest.id,
      score: latest.score,
      feedback,
    });
  } catch (e) {
    console.error('Get quiz latest submission error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
