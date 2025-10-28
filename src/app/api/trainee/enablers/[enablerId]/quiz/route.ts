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
} from '@/db/migrations/schemas/schema';

// GET trainee-facing enabler quiz (requires membership and enabler active)
// query: traineeId
export async function GET(req: NextRequest, { params }: { params: { enablerId: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    const { enablerId } = params;
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, enablerId as any));
    if (!enabler || !enabler.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Membership check: trainee must be member of the course
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, enabler.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [link] = await db.select().from(enablerQuizzes).where(eq(enablerQuizzes.enablerId, enablerId as any));
    if (!link) return NextResponse.json({ quiz: null });
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, link.quizId));
    if (!quiz) return NextResponse.json({ quiz: null });
    const qs = await db.select().from(questions).where(eq(questions.quizId, quiz.id)).orderBy(questions.orderIndex);
    const qIds = qs.map((q) => q.id);
    const opts = qIds.length ? await db.select().from(options).where(inArray(options.questionId, qIds)) : [];
    const out = {
      id: quiz.id,
      title: quiz.title,
      questions: qs.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: opts.filter((o) => o.questionId === q.id).map((o) => ({ id: o.id, optionText: o.optionText })),
      })),
    };
    return NextResponse.json({ quiz: out });
  } catch (e) {
    console.error('Trainee enabler quiz GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
