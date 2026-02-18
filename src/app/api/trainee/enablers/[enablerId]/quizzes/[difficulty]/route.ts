import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  courseMembers,
  enablers,
  enablerQuizLinks,
  options,
  questions,
  quizzes,
} from '@/db/migrations/schemas/schema';

// GET: quiz content for a specific difficulty if unlocked and active
// query: traineeId
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string; difficulty: string }> }
) {
  try {
    const { enablerId, difficulty } = await params;
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    if (!traineeId)
      return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [enabler] = await db
      .select({
        id: enablers.id,
        isActive: enablers.isActive,
        courseId: enablers.courseId,
      })
      .from(enablers)
      .where(eq(enablers.id, enablerId));
    if (!enabler || !enabler.isActive)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

    const [link] = await db
      .select()
      .from(enablerQuizLinks)
      .where(
        and(
          eq(enablerQuizLinks.enablerId, enablerId),
          eq(enablerQuizLinks.difficulty, difficulty as any)
        )
      );
    if (!link)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [quiz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, link.quizId));
    if (!quiz || !quiz.isActive)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.quizId, quiz.id))
      .orderBy(questions.orderIndex);
    const qIds = qs.map(q => q.id);
    const opts = qIds.length
      ? await db.select().from(options).where(inArray(options.questionId, qIds))
      : [];
    return NextResponse.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        difficulty: link.difficulty,
        questions: qs.map(q => ({
          id: q.id,
          questionText: q.questionText,
          questionType: (q as any).questionType || 'MCQ',
          options: opts
            .filter(o => String(o.questionId) === String(q.id))
            .map(o => ({
              id: o.id,
              optionText: o.optionText,
              explanation: o.explanation ?? null,
            })),
        })),
      },
    });
  } catch (e) {
    console.error('Get trainee enabler difficulty quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
