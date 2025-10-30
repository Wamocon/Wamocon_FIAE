import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  enablers,
  enablerQuizzes,
  options,
  questions,
  quizzes,
  courses,
  courseMembers,
  quizSubmissionAnswers,
  quizSubmissions,
} from '@/db/migrations/schemas/schema';

// POST submit answers for enabler quiz
// Body: { traineeId: string, answers: Array<{ questionId: string, selectedOptionId: string }> }
export async function POST(req: NextRequest, { params }: { params: Promise<{ enablerId: string }> }) {
  try {
    const { enablerId } = await params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const answers: Array<{ questionId: string; selectedOptionId: string }> = Array.isArray(body?.answers) ? body.answers : [];
    if (!traineeId || answers.length === 0) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, enablerId as any));
    if (!enabler || !enabler.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, enabler.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [link] = await db.select().from(enablerQuizzes).where(eq(enablerQuizzes.enablerId, enablerId as any));
    if (!link) return NextResponse.json({ error: 'No quiz' }, { status: 400 });
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, link.quizId));
    if (!quiz) return NextResponse.json({ error: 'No quiz' }, { status: 400 });

    // Validate answers and compute score
    const qs = await db.select().from(questions).where(eq(questions.quizId, quiz.id));
    const qMap = new Map(qs.map((q) => [String(q.id), q]));
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
          answers.map((a) => ({ submissionId: sub.id, questionId: a.questionId as any, selectedOptionId: a.selectedOptionId as any }))
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

    return NextResponse.json({ submissionId: sub.id, score, feedback });
  } catch (e) {
    console.error('Trainee submit enabler quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
