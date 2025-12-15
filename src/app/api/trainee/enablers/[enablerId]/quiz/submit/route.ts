import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import { enablers, enablerQuizzes, options, questions, quizzes, courseMembers, quizSubmissionAnswers, quizSubmissions, notifications, courses } from '@/db/migrations/schemas/schema';

// POST submit answers for enabler quiz
// Body: { traineeId: string, answers: Array<{ questionId: string, selectedOptionId: string }> }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { enablerId } = await params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const answers: Array<{ questionId: string; selectedOptionId: string }> = Array.isArray(body?.answers) ? body.answers : [];
    if (!traineeId || answers.length === 0) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, enablerId));
    if (!enabler || !enabler.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, enabler.courseId), eq(courseMembers.userId, traineeId)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [link] = await db.select().from(enablerQuizzes).where(eq(enablerQuizzes.enablerId, enablerId));
    if (!link) return NextResponse.json({ error: 'No quiz' }, { status: 400 });
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, link.quizId));
    if (!quiz) return NextResponse.json({ error: 'No quiz' }, { status: 400 });

    // Validate answers and compute score
    const qs = await db.select().from(questions).where(eq(questions.quizId, quiz.id));
    const optRows = await db.select().from(options).where(inArray(options.questionId, qs.map((q) => q.id)));
    const optMap = new Map(optRows.map((o) => [String(o.id), o]));

    let correctCount = 0;
    for (const a of answers) {
      const opt = optMap.get(String(a.selectedOptionId));
      if (opt && opt.isCorrect) correctCount += 1;
    }
    const score = Math.round((correctCount / Math.max(1, qs.length)) * 100);

    const sub = await db.transaction(async (tx) => {
      const [sub] = await tx
        .insert(quizSubmissions)
        .values({ traineeId, quizId: quiz.id, score, isReviewed: false })
        .returning();
      if (answers.length) {
        await tx.insert(quizSubmissionAnswers).values(
          answers.map((a) => ({ submissionId: sub.id, questionId: a.questionId, selectedOptionId: a.selectedOptionId }))
        );
      }
      return sub;
    });

    // Return per-question correctness for feedback
    const feedback = qs.map((q) => {
      const chosen = answers.find((a) => String(a.questionId) === String(q.id));
      const chosenOpt = chosen ? optMap.get(String(chosen.selectedOptionId)) : undefined;
      const correctOpt = optRows.find((o) => String(o.questionId) === String(q.id) && o.isCorrect);
      return {
        questionId: q.id,
        correct: !!chosenOpt?.isCorrect,
        correctOptionId: correctOpt?.id,
      };
    });

    // Notify trainers about quiz submission
    try {
      const [courseRow] = await db.select().from(courses).where(eq(courses.id, enabler.courseId));
      const trainerMemberRows = await db
        .select({ userId: courseMembers.userId })
        .from(courseMembers)
        .where(and(eq(courseMembers.courseId, enabler.courseId), eq(courseMembers.role, 'TRAINER')));
      const trainerIds = new Set<string>();
      if (courseRow?.createdById) trainerIds.add(String(courseRow.createdById));
      trainerMemberRows.forEach((m) => trainerIds.add(String(m.userId)));
      if (trainerIds.size) {
        const values = Array.from(trainerIds).map((uid) => ({
          userId: uid,
          actorId: traineeId,
          type: 'ENABLER_QUIZ_SUBMITTED',
          title: 'Mini-Quiz eingereicht',
          message: `Ein Trainee hat ein Mini-Quiz abgegeben: ${enabler.title}`,
          linkUrl: '/trainer/quiz-management',
          context: { enablerId, quizId: quiz.id, submissionId: sub.id },
        }));
        await db.insert(notifications).values(values);
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainers for enabler quiz submission', notifyErr);
    }

    return NextResponse.json({ submissionId: sub.id, score, feedback });
  } catch (e) {
    console.error('Trainee submit enabler quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
